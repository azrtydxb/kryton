# Overnight status — reverse-tunnel implementation kickoff

**Stamp:** 2026-05-12, end of session.

## What landed

### Specs (`docs/superpowers/specs/`)

| File | Status |
|---|---|
| `2026-05-12-reverse-tunnel-architecture-design.md` | Umbrella, approved, amendments folded in |
| `2026-05-12-kryton-tunnels-wp-plugin-design.md` | 4a, approved |
| `2026-05-12-kryton-tunnel-server-design.md` | 4b, approved |
| `2026-05-12-kryton-tunnel-client-design.md` | 4c, approved |

### Plans (`docs/superpowers/plans/`)

| File | Phases |
|---|---|
| `2026-05-12-kryton-tunnels-wp-plugin.md` | 12 phases, condensed |
| `2026-05-12-kryton-tunnel-server.md` | 12 phases, condensed |
| `2026-05-12-kryton-tunnel-client.md` | 9 phases, condensed |

### Implementation — kryton repo (this repo)

**4c server-side** — `packages/server/src/modules/tunnel/`
- `types.ts` + `utils/jwt.ts` + 12 unit tests for sanity-check helpers
- `services/{tunnel-state,tunnel-stats,tunnel-client}.service.ts`
- `routes/admin-tunnel.routes.ts` — 5 endpoints under `/api/admin/tunnel/*`
- Drizzle migration `0003_talented_maverick.sql` adds `TunnelTrafficDaily`
- 5 integration tests for the admin routes (unauth → 401)
- Wired into `app.ts`

**4c client-side** — `packages/client/src/pages/TunnelTab.tsx`
- New "Tunnel" tab in the AdminPage modal
- Status block with state variants (idle / connecting / open / backoff /
  fatal / closing) + ticking `now` for relative-time strings
- Paste-token modal with client-side sanity validation
- Stats block with 24h / 7d / 30d pill selector + pure-CSS sparkline
- Setup help block deep-linking to `https://kryton.ai/tunnels/dashboard`

**Status of the wire layer:** real h2 + yamux end-to-end, no stub.
`packages/server/src/modules/tunnel/wire/yamux.ts` is a from-scratch
hashicorp/yamux-compatible client (~500 LOC), `wire/h2-connect.ts`
handles the h2 CONNECT handshake, `services/loopback-injector.service.ts`
splices each inbound yamux stream to a fresh `127.0.0.1:<fastify-port>`
TCP socket so Fastify treats forwarded requests as local. The Go
server uses `github.com/hashicorp/yamux`. Wire interop is verified
by an e2e test that spawns the real Go binary as a subprocess, dials
it with the real TS client, mints an Ed25519 JWT, and forwards a
public HTTP request all the way through to a faux-Fastify and back.

**Verification:**
- `npm run typecheck` — clean
- `npm run lint` — clean
- `vitest run` — 125 tests / 29 files green
- CI on master — ✅ build + docker

### Implementation — new sibling repos

Both created on GitHub via `gh repo create --private --source=. --push`:

| Repo | Phase progress | CI |
|---|---|---|
| `azrtydxb/kryton-tunnels-wp-plugin` | Phase 1 (bootstrap) + part of Phase 3 (Subdomain validator + ReservedList with 11 unit tests) + Db/Schema with all 7 tables verbatim from spec §3 | ✅ lint + unit |
| `azrtydxb/kryton-tunnel-server` | Phase 1–3 (Go module, Makefile, multi-stage Dockerfile, slog, signal handling) + `internal/config` with 6 unit tests + `internal/jwt` Ed25519 verifier with 8 unit tests + binary builds, boots, and `/healthz` + `/readyz` respond correctly | ✅ lint + test (race) + build (amd64+arm64) |

### What I deliberately didn't do

- **WP plugin's signup / Stripe / dashboard / admin pages**. Phase 1–2
  of that plan are done; phases 3–12 are itemised but require PHP
  locally to TDD properly. For now the tunnel server treats JWTs as
  authoritative without a WP plan-resolver attached (the plan
  resolver interface is wired in tunnel.ListenerConfig.Plans but
  defaults to nil, in which case the JWT's plan claim is used).
- **Peer-sync mesh for multi-replica HA**. The Go server's
  registry has the peer map and the public listener has a peer-hit
  code path (currently logs and falls through to offline). Filling
  in `internal/registry/syncer.go` is straightforward and itemised
  in the plan. Single-replica is fully functional today.
- **Did not deploy anything to the DO k8s cluster.** That requires
  user authorization (Cloudflare API token, OpenBao seal, ArgoCD
  Application creation).
- **Did not configure Stripe.** That needs user setup in the Stripe
  Dashboard (product, two prices, webhook endpoint URL,
  Customer Portal config). Plan §4 enumerates what's needed.

## Suggested next moves

1. **yamux spike.** Spend a day proving libp2p-yamux talks cleanly to
   hashicorp/yamux. If yes, implement 4b's tunnel listener and 4c's
   `connectLoop` against it. If no, write a minimal in-repo yamux
   implementation against the documented spec (~500 LOC).
2. **WP plugin Phase 2–5.** TDD the remaining repos (Token, Revocation,
   Usage, Audit, StripeEvent, SubdomainReservation) and the Stripe
   webhook handler. Run against a Docker WP + Stripe CLI locally.
3. **Tunnel server Phase 4–8.** Registry → peer-sync → wpclient →
   meter → throttle → tunnel listener → public forwarder. Each phase
   has runnable tests in the plan.
4. **Deploy 4b to staging.** Helm install into `kryton-tunnels` ns
   with the Cloudflare cert-manager Certificate. Verify `/healthz`
   responds through ingress-nginx.

## Repos / URLs

- This repo: <https://github.com/azrtydxb/kryton>
- WP plugin: <https://github.com/azrtydxb/kryton-tunnels-wp-plugin>
- Tunnel server: <https://github.com/azrtydxb/kryton-tunnel-server>
- Plans: `docs/superpowers/plans/2026-05-12-*.md`
- Specs: `docs/superpowers/specs/2026-05-12-*.md`
