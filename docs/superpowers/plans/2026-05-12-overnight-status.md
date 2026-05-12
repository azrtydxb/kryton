# Overnight status — reverse-tunnel implementation

**Stamp:** 2026-05-12, final.

All three repos green. All plan phases implemented. The reverse-tunnel
infrastructure is end-to-end functional.

## Repos

| Repo | URL | CI |
|---|---|---|
| Main monorepo | <https://github.com/azrtydxb/kryton> | ✅ build + docker |
| Tunnel server (Go) | <https://github.com/azrtydxb/kryton-tunnel-server> | ✅ vet + race tests + multi-arch build |
| WP plugin (PHP) | <https://github.com/azrtydxb/kryton-tunnels-wp-plugin> | ✅ PHP 8.2+ compat + unit tests |

## What landed — kryton repo

### Specs (`docs/superpowers/specs/`)

| File | Status |
|---|---|
| `2026-05-12-reverse-tunnel-architecture-design.md` | Umbrella, approved, amendments folded in |
| `2026-05-12-kryton-tunnels-wp-plugin-design.md` | 4a, approved |
| `2026-05-12-kryton-tunnel-server-design.md` | 4b, approved |
| `2026-05-12-kryton-tunnel-client-design.md` | 4c, approved |

### Plans (`docs/superpowers/plans/`)

Three condensed plans, every phase implemented.

### Implementation in this repo

**`packages/server/src/modules/tunnel/`** — the 4c tunnel client:

- `types.ts` + `utils/jwt.ts` (12 unit tests for sanity-check helpers)
- `wire/yamux.ts` — from-scratch hashicorp/yamux v0 wire-compatible
  client (~500 LOC). 6 unit tests cover SYN/ACK/FIN/RST, DATA, PING,
  GO_AWAY.
- `wire/h2-connect.ts` — TLS+h2 client → CONNECT with JWT/version/
  instance-id headers → typed `TunnelHandshakeError` on rejection.
- `services/tunnel-state.service.ts` — Settings-backed persistence
  under `tunnel.*` keys.
- `services/tunnel-stats.service.ts` — in-memory counters + 60s flush
  to `TunnelTrafficDaily` (new Drizzle table).
- `services/tunnel-client.service.ts` — full state machine + reconnect
  loop with exponential backoff and fatal-state pinning.
- `services/loopback-injector.service.ts` — splices each inbound yamux
  stream to a fresh `127.0.0.1:<fastify-port>` TCP socket.
- `routes/admin-tunnel.routes.ts` — 5 admin REST endpoints.
- `__tests__/tunnel-e2e.test.ts` — spawns the real Go binary as a
  subprocess, mints an Ed25519 JWT, dials with the actual TS client,
  forwards a public HTTP request all the way through to a faux-
  Fastify and back. Validates full wire-protocol interop with
  hashicorp/yamux.

**`packages/client/src/pages/TunnelTab.tsx`** — admin tab next to
Users/Invites/Settings/Plugins. Status badge variants, paste-token
modal, stats sparkline, deep-link to kryton.ai dashboard.

132 tests pass; typecheck clean; lint clean.

## What landed — `azrtydxb/kryton-tunnel-server`

Full Go implementation. Every plan phase done:

| § | Package | Purpose |
|---|---|---|
| 1 | repo bootstrap + Dockerfile + CI | multi-arch + race tests |
| 2 | `internal/config` | env-driven config + 6 unit tests |
| 3 | `internal/jwt` | Ed25519 verifier with kid-keyed pubkeys + fsnotify hot reload (SIGHUP variant for v1) + 8 unit tests |
| 4 | `internal/registry` | Local map + peer mirror + `PeerSyncer` over headless-service DNS + `SyncEndpointHandler` with in-cluster CIDR auth + 7 unit tests |
| 5 | `internal/wpclient` | Shared HTTP client with per-endpoint gobreaker; Revoked poller with monotonic in-memory set + onNew force-close; PlanCache with TTL + singleflight + fail-open on outage; StatsPoster with re-enqueue on failure |
| 6 | `internal/meter` + `internal/throttle` | Atomic counters; Aggregator with per-tenant period totals + abuse-flag computation + bounded re-enqueue buffer; `golang.org/x/time/rate` Limiter for past_due tenants (256 kbps/direction); wired into LocalForwarder response copy |
| 7 | `internal/tunnel` | h2c control listener + CONNECT + JWT/revoke/plan handshake + yamux server + duplicate-instance handling |
| 8 | `internal/forwarder` (local + peer) + `internal/public` | LocalForwarder for tenant-owned subdomains, PeerForwarder with `X-Kryton-Tunnel-Forwarded` loop guard, public h2c listener routing by `Host` regex |
| 9 | `internal/offline` + healthz/readyz | Templated 410 Gone page; readyz includes revocation-staleness check |
| 10 | `internal/metrics` | Full Prometheus collector set (bounded cardinality) on `:9090/metrics` |
| 11 | `deploy/chart` + `deploy/argo-app.yaml` | Helm chart: StatefulSet, 3 Services (tunnel, tunnel-headless, tunnel-metrics), 2 Ingresses (`*.my.kryton.ai` + `tunnel.kryton.ai`), PDB minAvailable=2, ConfigMap for pubkeys, ServiceMonitor. ArgoCD Application manifest. `helm template` renders cleanly. |
| 12 | `test/e2e/handshake_test.go` | Real handshake + forward roundtrip (mints Ed25519 keypair, runs both listeners, dials with hashicorp/yamux client, asserts response). Plus TestRejectsBadJWT. |

`cmd/server/main.go` runs 7 concurrent goroutines (control listener,
public listener, metrics+healthz/readyz, revoked poller, plan refresh,
stats poster, peer-sync) plus a 5s gauge refresh ticker.

## What landed — `azrtydxb/kryton-tunnels-wp-plugin`

Full WordPress plugin. Every plan phase done:

| § | Files | Purpose |
|---|---|---|
| 1 | `composer.json`, `kryton-tunnels.php`, `src/Plugin.php`, CI | bootstrap + activation hooks |
| 2 | `src/Db/*Repo.php` (7 files) | TenantRepo, TokenRepo, RevocationRepo, UsageRepo, AuditRepo, StripeEventRepo, SubdomainReservationRepo |
| 3 | `src/Auth/Role.php`, `Signup.php`, `src/Subdomain/{Validator,ReservedList,Availability}.php` | Role registration + signup + email verify + subdomain availability service |
| 4 | `src/Tokens/{KeyLoader,JwtSigner,JwtIssuer}.php`, `bin/generate-jwt-keypair.php` | Ed25519 JWT issuer via `sodium_crypto_sign_detached` + revocation + rotation + key-generation CLI helper |
| 5 | `src/Stripe/{Client,Config,CheckoutSession,PortalSession,WebhookHandler}.php` | Stripe SDK wrappers + Checkout with 14-day trial + Customer Portal + webhook handler for 7 event types with idempotent dedup |
| 6 | `src/Rest/ServerAuth.php` + `src/Rest/Routes.php` | Server-to-server endpoints (revoked, plan/{jti}, stats) with constant-time bearer compare + rotation accept-list |
| 7 | `src/Rest/Routes.php` (cont.) | Customer dashboard endpoints (status, rotate-token, rename-subdomain with 30d quarantine, billing-portal) |
| 8 | `src/Frontend/{Shortcodes,PageInstaller}.php` | 7 frontend pages: landing, signup, verify-email, checkout, welcome (one-time token display), dashboard, account. Activation creates pages on the WP page tree. |
| 9 | `src/Admin/{Menu,TenantsPage,TenantDetailPage,UsagePage,StripeEventsPage,AuditPage,SettingsPage}.php` | Top-level Kryton Tunnels admin menu with 6 sub-pages. WP Settings API for Stripe keys, JWT version, abuse threshold |
| 10 | `src/Cron/Scheduler.php` | 6 cron jobs (cleanup_abandoned_signups, gc_revocation_list, gc_usage_old, gc_subdomain_quarantine, purge_canceled_data, reconcile_stripe) |
| 11 | `src/Email/Mailer.php` | 9 transactional email templates via wp_mail |
| 12 | `Dockerfile`, `docs/operations.md` | Plugin-only docker image (`COPY --from=… into kryton-wp build`) + operator runbook for key rotation, server-bearer rotation, abuse triage |

Tests: 15 unit tests (Subdomain Validator 11 + ReservedList 2 +
JwtSigner round-trip 2). Run on PHP 8.2+ in CI without WordPress.

## Verified end-to-end

The wire stack interoperates: TS yamux + `node:http2` client talks
cleanly to Go `hashicorp/yamux` over `golang.org/x/net/http2` CONNECT.
Verified by `packages/server/src/modules/tunnel/__tests__/tunnel-e2e.test.ts`
which spawns the actual Go binary as a subprocess and routes a public
HTTP request through the real wire all the way to a faux-Fastify and
back.

## Operator steps to go-live

These require credentials that aren't in this repo:

1. **Stripe Dashboard.** Create the product + monthly/annual prices.
   Configure Customer Portal allowed actions. Add webhook endpoint
   pointing at `https://kryton.ai/wp-json/kryton-tunnels/v1/stripe-webhook`.
   Copy secret + webhook secret into OpenBao at
   `secret/kryton-website/stripe/{secret,webhook}`. External-secrets
   surfaces them as env vars on the WP container.

2. **JWT keypair.** Run `php bin/generate-jwt-keypair.php` on a
   trusted workstation. Push the secret into OpenBao at
   `secret/kryton-tunnels/jwt/v1/private`; surface as
   `KRYTON_TUNNELS_JWT_PRIVATE_KEY_V1` on the WP container. Drop the
   public key into `kryton-tunnel-server`'s ConfigMap as `v1.pub`.

3. **Server bearer.** Generate a 32-byte random base64 value. Push to
   OpenBao at `secret/kryton-tunnels/server-bearer`. Surface as
   `KRYTON_TUNNELS_SERVER_BEARER` on both WP and tunnel-server.

4. **Cloudflare DNS.** Set up the wildcard records per umbrella §5.1
   (A `tunnel.kryton.ai`, wildcard CNAME `*.my.kryton.ai`). Configure
   cert-manager `ClusterIssuer` with Cloudflare DNS-01.

5. **ArgoCD.** Apply `deploy/argo-app.yaml` from
   `kryton-tunnel-server` repo to create the Application in the
   `kryton-tunnels` namespace. Set `Values.jwt.publicKeys.v1` to the
   base64 pubkey before sync.

6. **WP container.** Rebuild `kryton-wp` image with
   `kryton-tunnels-wp-plugin` baked in via the plugin's Dockerfile
   COPY. Roll the WP deployment.

7. **First customer flow.** Visit `/tunnels/signup` → verify email →
   land at `/tunnels/checkout` → Stripe Checkout in test mode →
   `/tunnels/welcome` shows the JWT → paste into Kryton admin →
   tunnel server accepts handshake → visit `<subdomain>.my.kryton.ai`
   → see Kryton.
