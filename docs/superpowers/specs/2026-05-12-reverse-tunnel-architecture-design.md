# Reverse Tunnel Infrastructure — Umbrella Architecture

**Date:** 2026-05-12
**Status:** Approved (umbrella). Sub-specs to follow per subsystem.
**Scope:** Cross-cutting design for "your self-hosted Kryton at `xyz.my.kryton.ai`" — signup, billing, subdomain provisioning, DNS+cert, tunnel transport, and Kryton admin integration.

> **Decomposition.** This umbrella describes the system as a whole and locks down
> the cross-cutting contracts (JWT, wire protocol, REST contracts, lifecycle). It
> is **not** an implementation plan. The actual work is split into four
> independently-shipped sub-projects, each of which gets its own
> `YYYY-MM-DD-...-design.md` spec and its own plan. See §4.

## 1. Goal

Let any user who runs a self-hosted Kryton instance on their own hardware reach it from the public internet at a personalised subdomain (`xyz.my.kryton.ai`) without opening inbound ports on their firewall and without us holding a copy of their data. Concretely:

1. User signs up on `kryton.ai` (currently `kryton.azrty.com` during pre-launch).
2. User chooses a subdomain `xyz` (charset `[a-z0-9-]{3,30}`, no leading/trailing dash, case-insensitive, not in the reserved list).
3. User enters credit card via Stripe Checkout; 14-day trial begins, card authorised but not charged.
4. Wildcard DNS record + wildcard TLS cert already cover `*.my.kryton.ai`; no per-tenant cert work.
5. User receives a JWT (the "tunnel token") in their dashboard.
6. User pastes JWT into Kryton's Admin → Tunnel panel.
7. Kryton server dials `tunnel.kryton.ai:443` outbound (TLS+h2), presents JWT, holds the connection open.
8. Public traffic to `xyz.my.kryton.ai` is routed through that h2 connection to the user's Kryton, transparently — including the Yjs collab WebSocket and MCP SSE streams.

## 2. Topology

```
                                Cloudflare DNS
                                      │
                ┌─────────────────────┼─────────────────────┐
                │                     │                     │
       kryton.azrty.com    *.my.kryton.ai          tunnel.kryton.ai
       (WP control plane)     (public tenant         (Kryton servers
                              URLs)                   dial here)
                │                     │                     │
                └─────────────────────┼─────────────────────┘
                                      ▼
                          ┌────────────────────────┐
                          │ ingress-nginx          │
                          │ + cert-manager         │
                          │ - wildcard *.my.kryton │
                          │   via Cloudflare       │
                          │   DNS-01 solver        │
                          └────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
       ┌────────────┐         ┌────────────────┐       ┌────────────────┐
       │ WordPress  │         │ Tunnel Server  │       │ Tunnel Server  │
       │ (PHP-FPM)  │         │ public ingress │       │ control ingress│
       │ kryton-    │         │ :8080          │       │ :8443 (h2c)    │
       │ website ns │         │                │       │                │
       └────────────┘         └────────────────┘       └────────────────┘
                                      │                       ▲
                                      │ in-process lookup     │ persistent h2
                                      │ by Host header        │ from Kryton boxes
                                      ▼                       │
                          ┌────────────────────────┐          │
                          │ Tunnel Server pod(s)   │──────────┘
                          │ - Go binary            │
                          │ - holds N persistent   │
                          │   h2 conns from Kryton │
                          │ - routes public reqs   │
                          │   to matching conn     │
                          │ namespace:             │
                          │   kryton-tunnels       │
                          └────────────────────────┘
```

**Deployment target:** existing DigitalOcean Kubernetes cluster (`do-blr1-azrty`), with `ingress-nginx`, `cert-manager`, `external-secrets` + OpenBao, and ArgoCD already in place. The tunnel server is added as a new namespace `kryton-tunnels` shipped through ArgoCD.

**Key invariants:**

- All TLS termination happens at ingress-nginx using wildcard certificates issued by cert-manager via Cloudflare DNS-01. The Go binary handles only plain HTTP(S) traffic from ingress-nginx and HTTP/2 backend connections. No certmagic or ACME client in the Go binary.
- Same Go binary serves both public traffic (`*.my.kryton.ai`) and the Kryton control plane (`tunnel.kryton.ai`); they are distinguished by listening port + Ingress rule.
- Public requests carry `X-Forwarded-For` / `X-Real-IP` injected by the tunnel server before being forwarded; Kryton trusts those headers only when the request entered via tunnel.
- Tunnel server is stateless w.r.t. WordPress for the common path (connection already open, no plan change): JWT verification is offline using a public Ed25519 key. WordPress is consulted only on new connections and via the revocation/stats polling loops.

## 3. Tenant lifecycle

```
   signup + subdomain claim + Stripe Checkout (card collected)
                            │
                            ▼
                  ┌──────────────────────┐
                  │      trialing        │   tunnel works, no charges
                  │  (14 days, Stripe    │   JWT plan="trialing"
                  │   manages the timer) │
                  └──────────────────────┘
                       │           │
       subscription    │           │   user cancels in dashboard
       activates       │           │   (Stripe customer_portal)
       (day 15)        │           │
                       ▼           ▼
              ┌──────────────┐  ┌──────────────┐
              │   active     │  │   canceled   │
              │ (paid)       │  │ (tunnel off  │
              │ JWT plan=    │  │  immediately)│
              │  "active"    │  │              │
              └──────────────┘  └──────────────┘
                  │     │
   payment fails  │     │  user clicks "cancel
   (final retry)  │     │  at period end"
                  ▼     ▼
          ┌──────────┐  ┌──────────────────────┐
          │past_due  │  │ canceling_at_period  │
          │(grace 7d,│  │ (tunnel keeps        │
          │ tunnel   │  │  working until       │
          │ throttled│  │  current_period_end) │
          │ to       │  │                      │
          │ 256kbps) │  │                      │
          └──────────┘  └──────────────────────┘
                │
                ▼ retries all fail
         ┌──────────────┐
         │  suspended   │   jti added to revocation list
         │ (tunnel off) │   data preserved 30d, then purged
         └──────────────┘
                │
                ▼ 30 days
         ┌──────────────┐
         │   purged     │   subdomain freed, returned to pool
         └──────────────┘
```

**Authority and propagation.** WordPress is the source of truth for state. State transitions land in `wp_kryton_tunnels_tenants`. The tunnel server learns of them through three channels:

| Transition | Propagation |
|---|---|
| `trialing → active`, `active → past_due`, etc. (plan changes) | Tunnel server picks up new plan on next connect (cached 5 min via `GET /plan/{jti}`); existing connections continue with previous plan until reconnect or until forced via revocation. |
| Any → `canceled` / `suspended` | WP adds `jti` to the revocation list; tunnel server fetches list every 30s and force-closes matching connections. |
| `active → past_due` throttling | Tunnel server enforces 256 kbps cap on next connect; existing connections continue at full speed until reconnect (acceptable lag — users will eventually reconnect). |

**Stripe is the trial timer.** We do not run our own day counter. Stripe Checkout is invoked with `subscription_data.trial_period_days: 14` and `payment_method_collection: 'always'`. We listen for `customer.subscription.trial_will_end` (3-day reminder email) and `customer.subscription.updated` (status flip).

**Abuse fuse — 10 GB/month, hidden.** Per-tenant byte counter inside tunnel server, flushed every 60s to WP. Soft limit: when a tenant crosses 10 GB in the current Stripe billing period, the tunnel server sets `abuse_flagged = true` in its stats post; WP shows the flag only in the admin view of the user. The user's own dashboard does **not** show this counter. No automatic action; we triage manually.

## 4. Subsystem decomposition

The umbrella above is the contract. Implementation splits into four independently-built sub-projects:

### 4a. `kryton-tunnels-wp-plugin` (new repo, PHP)

- **Repo:** `azrtydxb/kryton-tunnels-wp-plugin`
- **Deploys as:** WP plugin mounted into the existing `kryton-website` namespace's WordPress container at build time (image bake).
- **Responsibilities:** signup, subdomain claim (validation + uniqueness + reserved list), Stripe Checkout + customer portal integration, webhook handler for `customer.subscription.*` events, JWT issuance (Ed25519, key in OpenBao), Cloudflare API client for DNS record provisioning (and de-provisioning on subdomain release), customer dashboard (token, status, traffic stats, "rotate token", "manage subscription"), admin views (per-user abuse flag, manual suspend, free-token override).
- **Tables:** `wp_kryton_tunnels_tenants`, `wp_kryton_tunnels_tokens`, `wp_kryton_tunnels_revoked`, `wp_kryton_tunnels_usage`.
- **REST surface:** `/wp-json/kryton-tunnels/v1/revoked`, `.../plan/{jti}`, `.../stats`, plus the dashboard endpoints fronting the same tables.

### 4b. `kryton-tunnel-server` (new repo, Go)

- **Repo:** `azrtydxb/kryton-tunnel-server`
- **Deploys as:** container image, Argo `Application` in a new `kryton-tunnels` namespace. Deployment + 2 Services (`public`, `control`) + 2 Ingresses + `Certificate` resource for `*.my.kryton.ai` + ConfigMap with WP JWT public key + Secret with WP shared bearer secret (managed by external-secrets from OpenBao).
- **Responsibilities:** TLS-less HTTP listener `:8080` for public traffic, h2c listener `:8443` for control plane, JWT verification, in-memory connection registry keyed by subdomain, request forwarder (regular HTTP + WS via Extended CONNECT), polling clients for `/revoked` (30 s) and `/plan` (per-connect, 5 min cache), batched stats poster (60 s), per-tenant bandwidth counter + 10 GB fuse, throttling for `past_due` tenants.
- **Observability:** Prometheus metrics (`tunnel_connections_active`, `tunnel_requests_total{tenant, method, status}`, `tunnel_bytes_total{tenant, direction}`, `tunnel_revocation_check_age_seconds`); structured JSON logs at INFO with per-tenant + per-request correlation IDs.

### 4c. Kryton tunnel client + admin UI (existing `kryton` repo)

- **Server module:** `packages/server/src/modules/tunnel/` — Fastify plugin that, on app start, reads JWT from the Settings table; if present, opens persistent h2 connection to `tunnel.kryton.ai:443`. Inbound streams are fed into a virtual request pipeline that hands off to Fastify exactly as if the request had arrived on the local listener. Handles reconnect/backoff (1s, 2s, 4s, … cap 60s, jitter), heartbeat (PING /30 s, 3-miss timeout), trust-proxy header configuration.
- **Client UI:** new admin route `/admin/tunnel` — single text field (paste JWT), status badge (`Disconnected / Connecting / Trial / Active / Past_due (throttled) / Canceling / Suspended / Error: ...`), traffic stats card (requests/24h, bytes in/out — fetched from WP via the JWT). "Rotate token" button deep-links to the user's dashboard on `kryton.ai`.
- **Tests:** unit tests for reconnect/backoff; integration test against a stub tunnel server fixture.

### 4d. DNS + cert operations

Folded into 4a + 4b — no separate repo. WP plugin owns DNS CRUD on subdomain claim/release via Cloudflare API. Tunnel server's namespace owns the single wildcard `Certificate` for `*.my.kryton.ai` managed by cert-manager with the Cloudflare DNS-01 solver. The Cloudflare API token is one shared external-secret consumed by both.

### Dependency order

```
4a (WP plugin) ──┬──▶ 4b (tunnel server) ──┐
                 │                          │
                 │                          ▼
                 └──────────────────────▶  4c (Kryton tunnel client)
```

4a must land first because it issues the JWTs and exposes the REST contracts that 4b depends on. 4b can be built in parallel against a mocked WP, but full end-to-end testing requires 4a deployed. 4c needs both 4b and a real JWT to exercise end-to-end. 4d threads through the infra setup of 4a and 4b.

## 5. Cross-cutting contracts

### 5.1 JWT

```json
{
  "iss": "https://kryton.ai",
  "sub": "tenant_a1b2c3",
  "subdomain": "xyz",
  "plan": "trialing" | "active" | "past_due" | "canceling_at_period",
  "iat": 1747000000,
  "exp": 1754800000,
  "jti": "tok_7f9c..."
}
```

- **Algorithm:** EdDSA (Ed25519).
- **Lifetime:** 90 days. Not a refresh token. Single token suffices; user can rotate from dashboard.
- **Private key:** WordPress only; stored in OpenBao, surfaced to WP via external-secrets.
- **Public key:** distributed to tunnel server as a ConfigMap.
- **Revocation:** by `jti`, via pull list every 30 s. Tunnel server keeps an in-memory Set of revoked `jti`s with TTL = original token exp.

### 5.2 WordPress ↔ tunnel server REST

All three endpoints require `Authorization: Bearer <shared-secret>`. The shared secret rotates via external-secrets; both sides re-read on rotation.

```
GET  /wp-json/kryton-tunnels/v1/revoked?since=<unix>
     → { "revoked": ["jti1", "jti2", ...], "as_of": <unix> }

GET  /wp-json/kryton-tunnels/v1/plan/{jti}
     → { "plan": "active",
         "subdomain": "xyz",
         "throttle_kbps": null,
         "as_of": <unix> }

POST /wp-json/kryton-tunnels/v1/stats
     { "samples": [
         { "jti": "...", "period": "2026-05",
           "bytes_in": 12345, "bytes_out": 67890,
           "requests": 42, "abuse_flagged": false }
       ] }
     → 204
```

### 5.3 Wire protocol (Kryton ↔ tunnel server)

**Transport:** single TLS+HTTP/2 connection per Kryton instance, hostname `tunnel.kryton.ai`, port 443.

**Handshake:**
```
Kryton →  CONNECT tunnel.kryton.ai HTTP/2
          authorization: Bearer <JWT>
          x-kryton-version: 0.1.0
          x-kryton-instance-id: <stable uuid>
Tunnel →  HTTP/2 200
          x-tunnel-session-id: <uuid>
```

Tunnel server verifies signature, checks `jti` against in-memory revocation set, calls `/plan/{jti}` (cached 5 min) for current state. Duplicate-instance collision for the same subdomain: existing connection wins, new one receives `409` + `x-reason: duplicate-instance`.

**Forwarding (HTTP):** each inbound public request becomes one h2 stream on the tenant's persistent connection. Headers passed through verbatim, plus `X-Forwarded-For`, `X-Forwarded-Proto: https`, `X-Real-IP` set by tunnel server.

**Forwarding (WebSocket):** Extended CONNECT (RFC 8441) — `:method CONNECT, :protocol websocket`. Kryton's Fastify WS handler treats it as a normal upgrade. Used for `/ws/yjs/:docId` and MCP SSE.

**Heartbeat:** h2 PING frames every 30 s, tunnel server initiates. Three missed → connection torn down.

**Reconnect:** Kryton-side exponential backoff with jitter (1 s, 2 s, 4 s, … cap 60 s). If the JWT is rejected (revoked/exp/suspended), client surfaces specific reason in admin UI and stops retrying until user action.

### 5.4 Headers reserved by the tunnel

Tunnel server strips any incoming `X-Forwarded-*`, `X-Real-IP`, `X-Kryton-Tunnel-*` headers from the public request before injecting its own, so clients cannot spoof them. Kryton's Fastify `trustProxy` is configured to honour `X-Forwarded-For` only when the request entered via the tunnel module.

## 6. Subdomain rules

- Charset: `[a-z0-9-]{3,30}`.
- No leading or trailing dash.
- Case-insensitive (normalised to lowercase at claim time).
- Uniqueness: enforced on `wp_kryton_tunnels_tenants.subdomain` with a unique index.
- **Reserved list** (cannot be claimed): `www`, `api`, `admin`, `app`, `mail`, `status`, `blog`, `docs`, `kryton`, `tunnel`, `auth`, `id`, `account`, `accounts`, `billing`, `support`, `help`, `static`, `cdn`, `assets`, `img`, `m`, `dev`, `staging`, `test`, plus a profanity list (curated in the plugin).
- On release (subscription `canceled` + 30 d purge): subdomain is returned to the pool but with a 30-day quarantine before reclaim, to prevent immediate impersonation of recently-shut-down tenants.

## 7. Stripe integration

- **Mode:** Stripe Checkout (hosted) for initial signup, Stripe Customer Portal for cancellation / payment method updates.
- **Trial:** `subscription_data.trial_period_days: 14`, `payment_method_collection: 'always'`. Card authorised, not charged.
- **Webhooks consumed:**
  - `customer.subscription.created` → create tenant row, mint JWT.
  - `customer.subscription.trial_will_end` → reminder email.
  - `customer.subscription.updated` → flip plan state in tenants table.
  - `customer.subscription.deleted` → revoke `jti`, schedule 30-day purge.
  - `invoice.payment_failed` → flip to `past_due`, schedule grace expiry.
- **Product / price:** one product, two prices (`monthly`, `annual`). Pricing chosen later; not part of this spec.

## 8. Security

- **JWT signing key** lives only in OpenBao + WP. Compromise scenario: rotate signing key, mass-issue new tokens, push old `jti`s onto revocation list. (Acceptable downtime: tens of seconds.)
- **Tunnel server can read public key only**, plus a shared bearer secret to talk back to WP. Compromise scenario: rotate shared secret in OpenBao; old tunnel server pod loses stats access only — public-facing routing keeps working.
- **End-user data does not pass through WP.** WP knows tenant identity + traffic byte counts + abuse flag. Nothing more.
- **Defense in depth on the tenant side:** Kryton's existing auth (better-auth, sessions, API keys, 2FA, passkeys) handles all access control. The tunnel does not authenticate end users; it just routes bytes.
- **Tunnel server abuse handling for the *tunnel* itself (e.g. someone using the tunnel to proxy general internet traffic) is out of scope** — JWT presence is sufficient authorisation; the 10 GB fuse catches the worst cases.

## 9. Observability

- **Tunnel server:** Prometheus scrape via existing cluster Prometheus; logs to existing `logging` namespace (Loki/Promtail or equivalent).
- **WordPress:** existing access logs; plugin emits structured PHP error_log entries for webhook events tagged with `[kryton-tunnels]`.
- **Per-tenant traceability:** every public request carries an internal `x-kryton-tunnel-request-id` UUID into Kryton, enabling end-to-end log correlation across the three components.

## 10. Out of scope (deferred)

- Multi-region tunnel deployments (single DO cluster for v1).
- BYO custom domains (`notes.mycompany.com` as a CNAME).
- TCP/UDP tunneling — HTTP/WS only is enough for Kryton's full surface.
- Affiliate / referral program.
- Self-hosted tunnel server for enterprise customers.
- Tunnel server admin CLI (only Prometheus + WP admin views in v1).

## 11. Sub-spec workflow

Each subsystem now needs its own spec → plan → implementation cycle. Order:

1. `2026-05-12-kryton-tunnels-wp-plugin-design.md` (4a)
2. `2026-05-12-kryton-tunnel-server-design.md` (4b)
3. `2026-05-12-kryton-tunnel-client-design.md` (4c)

4d's bits are picked up inside 4a and 4b's specs. After all four ship, this umbrella stays as the cross-cutting reference; only the contracts in §5 are load-bearing for future work.
