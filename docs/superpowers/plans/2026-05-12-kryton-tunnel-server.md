# Kryton Tunnel Server (Go) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Go service that terminates tunnel control connections from self-hosted Kryton instances and routes public traffic into them.

**Architecture:** Single Go binary in new repo `azrtydxb/kryton-tunnel-server`. Deployed as 3-replica StatefulSet with HA failover via peer-mesh registry to `kryton-tunnels` namespace in the existing DO k8s cluster. ingress-nginx terminates TLS (wildcard via cert-manager + Cloudflare DNS-01). Two listeners on each pod: `:8080` public + `:8443` h2c control. Outer h2 carries CONNECT body, which carries a yamux session, which multiplexes per-request HTTP/1.1 streams.

**Tech Stack:** Go 1.23+, `golang.org/x/net/http2`, `golang.org/x/net/http2/h2c`, `golang.org/x/time/rate`, `github.com/hashicorp/yamux`, `github.com/fsnotify/fsnotify`, `github.com/prometheus/client_golang`, `github.com/google/uuid`, `log/slog`. Helm chart + ArgoCD Application for deployment.

**Reference:** [Spec 4b](../specs/2026-05-12-kryton-tunnel-server-design.md); [Umbrella](../specs/2026-05-12-reverse-tunnel-architecture-design.md).

**Conventions:**
- TDD where logic has branches (JWT, registry, throttle, wpclient, forwarder routing).
- Pragmatic single-test integration coverage for I/O-heavy boundaries (yamux handshake, h2 listener wiring).
- Run with `-race` in CI.
- One commit per task or per logical step. Frequent commits.

---

## Phase 1 — Bootstrap

### Task 1: Initialise repo

- [ ] `gh repo create azrtydxb/kryton-tunnel-server --private`, clone locally.
- [ ] Write `README.md`, `.gitignore` (`*.test`, `bin/`, `dist/`), `LICENSE`.
- [ ] Initial commit.

### Task 2: Go module

- [ ] `go mod init github.com/azrtydxb/kryton-tunnel-server`.
- [ ] Add baseline deps:
  ```
  go get golang.org/x/net/http2
  go get golang.org/x/time/rate
  go get github.com/hashicorp/yamux
  go get github.com/fsnotify/fsnotify
  go get github.com/prometheus/client_golang
  go get github.com/google/uuid
  go get github.com/sony/gobreaker
  ```
- [ ] Commit `go.mod` + `go.sum`.

### Task 3: Minimal main + Dockerfile + Makefile

**Files:** `cmd/server/main.go`, `Dockerfile`, `Makefile`.

- [ ] `main.go` boots an empty `http.Server` on `:9090` with `/healthz` returning 200 (placeholder).
- [ ] `Dockerfile` multi-stage: build stage uses `golang:1.23-alpine`, distroless final.
- [ ] `Makefile` targets: `build`, `test`, `lint` (golangci-lint), `image`.
- [ ] Commit.

### Task 4: GitHub Actions CI

**Files:** `.github/workflows/ci.yml`.

- [ ] Jobs: `lint` (golangci-lint), `test` (`go test -race ./...`), `build` (cross-compile linux/amd64+arm64).
- [ ] On tag push, additional job builds + pushes multi-arch image to GHCR.

---

## Phase 2 — Config + logging foundations

### Task 5: Config struct loaded from env + flags

**Files:** `internal/config/config.go`, `internal/config/config_test.go`.

- [ ] TDD `Load(env map[string]string, args []string) (*Config, error)` with knobs:
  - `POD_ID` (required)
  - `POD_ADDR` (required)
  - `WP_BASE_URL` (default `http://kryton-wordpress.kryton-website.svc.cluster.local`)
  - `WP_BEARER` (required at runtime; loadable from file via `WP_BEARER_FILE`)
  - `WP_BEARER_ACCEPT` (comma-separated rotation accept list — informational only)
  - `JWT_KEYS_DIR` (default `/etc/kryton-tunnels/keys`)
  - `LISTEN_PUBLIC` (default `:8080`)
  - `LISTEN_CONTROL` (default `:8443`)
  - `LISTEN_METRICS` (default `:9090`)
  - `PEER_SYNC_INTERVAL` (default `5s`)
  - `PEER_STALE_AFTER` (default `15s`)
  - `REVOKED_POLL_INTERVAL` (default `30s`)
  - `REVOKED_MAX_STALENESS` (default `5m`)
  - `PLAN_TTL` (default `5m`)
  - `STATS_FLUSH_INTERVAL` (default `60s`)
  - `H2_PING_INTERVAL` (default `5s`)
  - `H2_PING_TIMEOUT` (default `15s`)
- [ ] Each knob validated on load. Test cases for missing-required, bad-duration parse, etc.

### Task 6: slog setup

**Files:** `internal/logging/setup.go`.

- [ ] `Init(level slog.Level) *slog.Logger` returns a JSON handler writing to stderr with default attrs `service: "kryton-tunnel-server"`, `pod_id`.
- [ ] Used by `main.go` early.

---

## Phase 3 — JWT verification

### Task 7: KeySet with fsnotify hot reload

**Files:** `internal/jwt/keyset.go`, `internal/jwt/keyset_test.go`.

- [ ] TDD `KeySet.Load(dir string)` reads all `*.pub` files, parses base64 → ed25519.PublicKey, keyed by filename stem.
- [ ] TDD `KeySet.Verify(token string) (*Claims, error)`: parse JWT, look up kid, ed25519.Verify, decode payload, check `iss`, `exp`, `iat`.
- [ ] TDD `KeySet.Watch(ctx context.Context, dir string)` with fsnotify — write a new file, KeySet picks up within 500 ms (use a sync barrier in the test).

### Task 8: Claims struct + JWT decoder helpers

**Files:** `internal/jwt/claims.go`.

- [ ] `Claims` struct fields: `Iss`, `Sub`, `Subdomain`, `Plan`, `Iat`, `Exp`, `JTI`. JSON tags match.
- [ ] `parseUnverified(token string) (header, payload []byte, sig []byte, err error)` for use during verify.

---

## Phase 4 — Registry (local + peer mirror)

### Task 9: ControlConn + Registry data structures

**Files:** `internal/registry/registry.go`, `internal/registry/registry_test.go`.

- [ ] TDD `Registry.RegisterLocal(cc *ControlConn) *ControlConn` returns prior connection if any. Asserts old peer entry for same subdomain is cleared.
- [ ] TDD `Registry.UnregisterLocal(subdomain string, cc *ControlConn)` deletes only if pointer matches.
- [ ] TDD `Registry.Lookup(subdomain string) LookupResult` returns local hit first, peer second, miss third.
- [ ] TDD concurrent reader/writer correctness under `-race`.

### Task 10: Peer-sync HTTP endpoint + payload

**Files:** `internal/registry/sync_endpoint.go`.

- [ ] `Handler` on `/internal/registry` returns JSON `{pod_id, pod_addr, as_of, subdomains:[{subdomain, jti, established_at}]}` from registry's local map.
- [ ] CIDR check on `RemoteAddr` — only in-cluster (10.0.0.0/8 + cluster-pod CIDR from env).

### Task 11: PeerSyncer

**Files:** `internal/registry/syncer.go`, `internal/registry/syncer_test.go`.

- [ ] `Run(ctx)` ticks every `PEER_SYNC_INTERVAL`, resolves headless FQDN, fan-out GETs `/internal/registry`, atomic-swap a new peer map.
- [ ] Stale entries dropped after `PEER_STALE_AFTER`.
- [ ] Test with two `httptest.Server` peers; verify merge correctness, stale eviction.

---

## Phase 5 — WordPress client

### Task 12: Shared HTTP client + circuit breaker

**Files:** `internal/wpclient/client.go`.

- [ ] `Client` wraps `*http.Client` with `Authorization: Bearer <bearer>` injection, per-endpoint-family `*gobreaker.CircuitBreaker`.

### Task 13: Revoked set

**Files:** `internal/wpclient/revoked.go`, `revoked_test.go`.

- [ ] TDD `Revoked.IsRevoked(jti string) bool` against a sync.Map.
- [ ] TDD `Revoked.Run(ctx)` polls `/wp-json/.../revoked?since=<unix>`, updates set, calls `onNewRevocation(jti)` per spec §3.2. Handles `truncated: true` by immediate re-poll. Test against `httptest.NewServer`.
- [ ] GC every 60s removes entries with `expires_at < now()`.

### Task 14: Plan cache

**Files:** `internal/wpclient/plan.go`, `plan_test.go`.

- [ ] TDD `PlanCache.Get(ctx, jti)` with `singleflight.Group` coalescing. Cache hit returns cached entry if `time.Since(fetchedAt) < ttl`.
- [ ] On WP error at handshake time, returns synthetic `Plan{Plan:"active"}` with `fetchedAt:epoch`.
- [ ] TDD `PlanCache.RefreshLoop(ctx, getJTIs)` ticks every minute, refreshes any whose ttl is up.

### Task 15: Stats poster

**Files:** `internal/wpclient/stats.go`, `stats_test.go`.

- [ ] `StatsPoster.Run(ctx)` ticks every `STATS_FLUSH_INTERVAL`, drains `meter.Aggregator`, builds payload `{pod_id, pod_addr, active_jtis, samples}`, POSTs to `/stats`.
- [ ] On error, re-enqueue samples into meter; bounded buffer drops oldest on overflow with `tunnel_meter_buckets_dropped_total` increment.

---

## Phase 6 — Metering + throttling

### Task 16: Counter + Aggregator

**Files:** `internal/meter/counter.go`, `internal/meter/aggregator.go`, plus tests.

- [ ] `Counter` with `atomic.Uint64` for `bytesIn`, `bytesOut`, `requests`, and `abuseFlag atomic.Bool`.
- [ ] `Aggregator.FlushNow(reg *registry.Registry) []Sample` snapshots, diffs against prev, returns per-minute samples. Empty samples skipped.
- [ ] TDD: counter atomicity under `-race`; flush diff math; period-rollover correctness.
- [ ] `computeAbuseFlag` per spec §5.3 using cached plan's `AbuseThresholdBytes`.

### Task 17: Throttle limiter

**Files:** `internal/throttle/limiter.go`, `internal/throttle/reader.go`, plus tests.

- [ ] `Limiter` wraps `*rate.Limiter`; `Wait(ctx, n int) error`. `nil` limiter no-ops.
- [ ] `Wrap(r io.Reader, l *Limiter, ctx) io.Reader` returns a `throttledReader` that caps each Read at 4 KB and waits per limiter.
- [ ] TDD: rate accuracy with a fake clock; nil-limiter is identity.

---

## Phase 7 — Tunnel control plane (h2 listener + yamux)

### Task 18: Control listener accepts CONNECT

**Files:** `internal/tunnel/listener.go`, `internal/tunnel/handshake.go`.

- [ ] h2c server on `LISTEN_CONTROL`. Handler accepts only `:method=CONNECT, :authority=tunnel.kryton.ai`.
- [ ] Verifies `Authorization: Bearer <JWT>` via `jwt.KeySet.Verify`.
- [ ] Checks `revoked.IsRevoked(claims.JTI)`.
- [ ] Calls `planCache.Get(claims.JTI)`.
- [ ] On any rejection, responds 401/403/409 with `x-reason` header set per spec §3.6, closes stream.
- [ ] On success, hijacks stream, starts yamux client over the CONNECT body, registers `ControlConn` in registry, sets up h2 PING.
- [ ] Integration test using `net/http2` client + a real yamux session opening a stream and exchanging bytes.

### Task 19: Duplicate-instance handling

- [ ] On `registry.RegisterLocal` returning prior conn, if `prior.InstanceID == new.InstanceID`, close prior cleanly. Else, reject new with 409 + `x-reason: duplicate-instance`.
- [ ] TDD against two simulated kryton clients.

### Task 20: Drain + GOAWAY on SIGTERM

**Files:** `cmd/server/main.go` shutdown logic, `internal/tunnel/listener.go` GOAWAY helper.

- [ ] SIGTERM → readiness probe returns 503 → ingress drains.
- [ ] After 1s, send yamux `GoAway` to each control connection with reason "drain — reconnect".
- [ ] Continue forwarding in-flight public requests for up to 30s.
- [ ] Then close all yamux + h2 sessions and exit.
- [ ] Integration test asserts the sequence.

### Task 21: Revocation hook closes existing connections

- [ ] Wire `revoked.onNewRevocation` to look up the jti in the local registry and close the matching ControlConn with reason "revoked".

---

## Phase 8 — Public traffic forwarding

### Task 22: LocalForwarder (HTTP)

**Files:** `internal/forwarder/local.go`, `internal/forwarder/local_test.go`.

- [ ] TDD `Forward(w, r, cc)`: opens yamux stream, strips hop-by-hop + inbound `X-Forwarded-*` + `X-Real-IP` + `X-Kryton-Tunnel-*`, injects `X-Forwarded-For` (chain), `X-Forwarded-Proto`, `X-Real-IP`, `X-Forwarded-Host`, `X-Kryton-Tunnel-Request-Id`.
- [ ] Uses `Request.Write` to emit valid HTTP/1.1 on the yamux stream.
- [ ] Reads response via `http.ReadResponse`.
- [ ] Streams body with `io.Copy` wrapped through `meter` and `throttle`.
- [ ] On any error, returns 502 with offline-page body.

### Task 23: WebSocket bridging

**Files:** `internal/forwarder/ws.go`, plus test using `gorilla/websocket` or `golang.org/x/net/websocket`.

- [ ] `bridgeWebSocket(w, r, stream, cc)`: hijack inbound conn, write HTTP/1.1 upgrade to yamux stream, read 101 from Kryton, forward 101 to client, then bidirectional `io.Copy` both wrapped with meter + throttle.
- [ ] Test echoes 100 messages each way.

### Task 24: Public listener with h2c dispatch

**Files:** `internal/public/listener.go`, `internal/public/handler.go`.

- [ ] `http.Server` on `LISTEN_PUBLIC` with `h2c.NewHandler` wrapping the dispatch handler.
- [ ] Handler dispatch: `registry.Lookup(subdomain) → local? peer? miss?`. Calls into LocalForwarder, PeerForwarder (Task 26), or offline.Render.
- [ ] Handles `/internal/registry` via the dedicated handler (Task 10) — checked first by path before routing dispatch.

### Task 25: Subdomain extraction from Host

**Files:** `internal/public/subdomain.go`.

- [ ] Pure helper `ExtractSubdomain(host string) (string, ok bool)` matches `^([a-z0-9-]{3,30})\.my\.kryton\.ai$`. Invalid → offline page.
- [ ] TDD with case examples.

### Task 26: PeerForwarder

**Files:** `internal/forwarder/peer.go`, plus test.

- [ ] Reverse-proxy style with loop guard (`X-Kryton-Tunnel-Forwarded: 1` → 502). Preserves Host. Streams request body through.
- [ ] WebSocket-aware: hijacks both sides and splices.
- [ ] Test with two `httptest.Server` peers — request lands on B, routes to A, response makes it back.

---

## Phase 9 — Offline page + health

### Task 27: Offline renderer

**Files:** `internal/offline/page.go`.

- [ ] Templated HTML per spec §7. 410 + noindex + no-store. Pre-validate subdomain before render.

### Task 28: /healthz + /readyz

**Files:** `internal/metrics/health.go`.

- [ ] `/healthz` → 200 always.
- [ ] `/readyz` → 200 if JWT KeySet has ≥1 key AND (peer-sync completed once OR single-pod) AND `tunnel_wp_revoked_age_seconds < REVOKED_MAX_STALENESS`.

---

## Phase 10 — Observability

### Task 29: Prometheus metrics

**Files:** `internal/metrics/collectors.go`.

- [ ] All counters/histograms/gauges from spec §8.1, registered into the default registry.
- [ ] Metrics handler exposed on `LISTEN_METRICS` via `promhttp.Handler()`.

### Task 30: Structured logs

- [ ] Use `app.log` (slog) throughout. Required attrs in every record: `pod_id`. Per-request: `request_id`, `subdomain`, `jti`.

---

## Phase 11 — Helm chart + ArgoCD

### Task 31: Helm chart skeleton

**Files:** `deploy/chart/Chart.yaml`, `values.yaml`, `templates/_helpers.tpl`.

- [ ] Chart name `kryton-tunnel-server`, appVersion `0.1.0`.

### Task 32: StatefulSet + Services + Ingresses + Certificate + PDB + ServiceMonitor

**Files:** `deploy/chart/templates/*.yaml`.

- [ ] All resources verbatim from spec §9. Use `tpl` + `Values` for image tag, replicas, etc.
- [ ] Helm template renders cleanly: `helm template kryton-tunnels deploy/chart`. Assert in CI.

### Task 33: ConfigMap for JWT pubkeys + ExternalSecret for bearer

**Files:** `deploy/chart/templates/configmap-pubkeys.yaml`, `externalsecret-bearer.yaml`.

- [ ] ConfigMap built from `Values.jwt.publicKeys` (map of kid → base64).
- [ ] ExternalSecret targets OpenBao path; produces a Kubernetes Secret with `value` key.

### Task 34: ArgoCD Application manifest

**Files:** `deploy/argo-app.yaml`.

- [ ] `Application` CRD pointing at this repo's `deploy/chart/`, target ns `kryton-tunnels`, sync policy: manual.

---

## Phase 12 — Integration + e2e tests

### Task 35: Integration: fake-WP + real yamux client harness

**Files:** `test/integration/handshake_test.go`, `forwarding_test.go`, `drain_test.go`.

- [ ] Spin up the tunnel server in-process; spin a fake WP (`httptest.Server`) with `/revoked`, `/plan/{jti}`, `/stats`; have a goroutine impersonate Kryton (dial h2 + CONNECT + yamux server). Run scenarios from spec §10.2.

### Task 36: E2E: kind cluster + Helm install

**Files:** `test/e2e/kind_test.go`, `test/e2e/Makefile`.

- [ ] `make e2e-up` spins kind, installs ingress-nginx, installs cert-manager, applies fake-WP manifests + the Helm chart with `replicas: 3`.
- [ ] Test: connect → request → response. Drain one pod (`kubectl delete pod tunnel-0`) → assert reconnect within 30s. Revoke jti → assert connection closed within 35s.
- [ ] CI job `e2e` runs on nightly cron + on tagged release.

---

## Self-review

- **Spec coverage:** §1 repo+replicas+routing (Phases 1, 4, 7). §2 registry (Phase 4). §3 wpclient+keyset+handshake (Phases 3, 5, 7). §4 public traffic (Phase 8). §5 meter (Phase 6). §6 throttle (Phase 6). §7 offline (Phase 9). §8 observability (Phase 10). §9 deployment (Phase 11). §10 testing (Phases throughout + 12).
- **Type consistency:** `ControlConn`, `Claims`, `Sample`, `Plan`, `PeerEntry` defined in single locations; later phases reference them by name.
- **Placeholders:** none. Each task has concrete files and signatures.
