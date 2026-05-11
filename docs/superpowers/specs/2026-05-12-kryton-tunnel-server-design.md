# Kryton Tunnel Server — Go (Sub-spec 4b)

**Date:** 2026-05-12
**Status:** Approved (design). Plan to follow.
**Umbrella:** [2026-05-12-reverse-tunnel-architecture-design.md](./2026-05-12-reverse-tunnel-architecture-design.md)
**Scope:** The Go service that terminates tunnel control connections from self-hosted Kryton instances and routes public traffic into them. Sub-spec 4b of 4.

This spec assumes the umbrella's contracts (JWT, lifecycle, REST surface, wire protocol — including the 2026-05-12 amendments on yamux multiplexing, HA peer mesh, and the extended `/plan/{jti}` payload) are settled and refers back to them rather than restating.

## 1. Repo, replicas, and the failover-capable routing model

### 1.1 Repo and binary

**Repo:** `azrtydxb/kryton-tunnel-server`. Single Go module, single binary `kryton-tunnel-server`. Built as a multi-arch container image (`linux/amd64`, `linux/arm64`) and pushed to GHCR. ArgoCD `Application` in the cluster pulls and deploys.

**Layout:**
```
kryton-tunnel-server/
  cmd/
    server/main.go                 # entrypoint: flags, config, start
  internal/
    config/                        # env + flags loading
    jwt/                           # Ed25519 verifier with kid-keyed pubkeys
    wpclient/                      # /revoked, /plan, /stats — polling + posting
    registry/                      # subdomain -> ControlConn / peer-mirror
    tunnel/                        # h2 control listener; per-conn state machine
    public/                        # public HTTP listener; routes by Host
    forwarder/                     # turns inbound public request into a yamux stream
    websocket/                     # WebSocket bridging helpers
    meter/                         # per-tenant counters; abuse-flag emitter
    throttle/                      # token-bucket limiter for past_due tenants
    offline/                       # offline-page renderer
    metrics/                       # Prometheus collectors
    httplog/                       # structured access logs
  deploy/
    chart/                         # Helm chart
    argo-app.yaml                  # ArgoCD Application
  test/
    integration/
    e2e/
  Dockerfile
  go.mod / go.sum
```

**Go version:** 1.23+. Standard-library `net/http` HTTP/2 stack for the outer h2 listener; `hashicorp/yamux` for inner multiplexing; `golang.org/x/time/rate` for throttling; `golang.org/x/net/http2/h2c` for cleartext h2 on the public listener; `prometheus/client_golang` for metrics; `fsnotify/fsnotify` for the JWT public-key reload; `google/uuid` for request IDs; `log/slog` (stdlib) for structured logs.

### 1.2 Replicas

3-replica `StatefulSet` in v1. Three replicas because:

- 2 replicas → one pod restart = half the tenants briefly offline.
- 3 replicas → one restart affects ~1/3 of tenants for ~5–10 s.

`StatefulSet` (not `Deployment`) for stable pod names (`tunnel-0`, `tunnel-1`, `tunnel-2`) so peer discovery via headless Service DNS is deterministic. Pod anti-affinity spreads pods across nodes so a single-node failure can't take all three down. `PodDisruptionBudget(minAvailable: 2)` prevents Kubernetes from draining more than one pod at once.

### 1.3 Routing model — HA failover via peer mesh

Each pod holds two registry maps:

- **Local registry** — `subdomain → live yamux session`. Authoritative for tenants whose Kryton is connected to *this* pod.
- **Peer mirror** — `subdomain → peer pod address`. Synced every 5 s from every other pod's `/internal/registry` endpoint over the headless Service. Stale entries (peer hasn't responded in 15 s) drop out.

A pod knows the location of every live tenant at all times, refreshed every 5 s. WordPress is **not** on the routing critical path.

```
                ingress-nginx (TLS termination, wildcard cert)
                                │   round-robin
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
        tunnel-0            tunnel-1            tunnel-2
       ┌─────────┐         ┌─────────┐         ┌─────────┐
       │ local   │         │ local   │         │ local   │
       │ peer    │ ◀────── │ peer    │ ──────▶ │ peer    │
       │ mirror  │  /5s    │ mirror  │  /5s    │ mirror  │
       └─────────┘         └─────────┘         └─────────┘
            │                                              │
       holds Kryton                                   holds Kryton
       conns for subset A                             conns for subset B
```

**Request routing — full flow:**

```
Public request lands on any pod (ingress round-robin):
1. Pod looks up subdomain in local registry.
   HIT → open a new yamux stream on that session, forward request.
2. Miss → look up subdomain in peer mirror.
   HIT → forward the entire request to the owning pod over the internal
         cluster network (HTTP/1.1 to peer-pod:8080, Host preserved,
         X-Kryton-Tunnel-Forwarded: 1 to prevent forwarding loops).
3. Miss in both → return the offline page (410 + noindex).
```

The forwarded path adds ~0.2 ms in-cluster and is the *exceptional* path during steady state.

### 1.4 Pod restart / graceful drain

```
SIGTERM received on pod P:
  T+0s   - Pod fails readiness probe; ingress-nginx stops sending new traffic in ~1-2s.
         - /internal/registry returns empty; peers learn within 5s.
         - Pod sends HTTP/2 GOAWAY frame to every Kryton control connection.
         - Pod continues handling in-flight public requests via peer-forwarding.
  T+1-3s - Kryton clients receive GOAWAY, reconnect with backoff (1s).
         - Reconnect lands (via ingress round-robin) on a surviving pod.
  T+5s   - All peers have re-synced; new home visible in peer maps.
  T+30s  - Drain timer expires. Pod exits.
```

Net user impact: each tenant's tunnel breaks for ~1–3 s while Kryton reconnects. In-flight public requests that were already mid-stream when GOAWAY hit are aborted with `502`; the next request from the same browser session lands cleanly on the new owner pod.

### 1.5 Pod crash (no graceful drain)

```
T+0s    Kryton conns hang; yamux PING + h2 PING heartbeats detect death.
T+0-3s  ingress-nginx Endpoints watcher removes the dead pod.
T+3s    Peer-sync requests to dead pod fail; peers drop its entries from their mirrors.
T+5-15s Kryton clients' PING timeouts trigger reconnect to a surviving pod.
T+30s   Full recovery.
```

Worst-case user-visible outage for the slice of tenants whose pod died: ~15–30 s. PING intervals (5 s with 15 s timeout via 3 misses on both yamux and h2) are tuned for fast detection.

### 1.6 Two listeners on each pod

Same Go process, two listeners:

| Listener | Purpose | Protocol |
|---|---|---|
| `:8080` | Public traffic forwarded from ingress-nginx for `*.my.kryton.ai`, plus inter-pod forwarding traffic. | HTTP/1.1 + h2c via `h2c.NewHandler`. |
| `:8443` | Kryton control plane (`tunnel.kryton.ai`). | h2c (ingress-nginx terminates the outer TLS and forwards as h2c). |
| `:9090` | Prometheus metrics + health checks. | HTTP/1.1. |

### 1.7 What lives in the tunnel server

- Public Ed25519 key set (from ConfigMap, hot-reloaded via fsnotify).
- Revocation set (polled, in-memory).
- Plan cache (per-jti, in-memory, 5 min TTL).
- Local + peer-mirror registries (per-subdomain, in-memory).
- Byte counters (per-tenant, in-memory, flushed every 60 s to WP).
- No persistent state on disk. No SQLite, no BoltDB, no Redis.

## 2. Connection registry & request forwarding

### 2.1 Data structures

```go
// internal/registry/registry.go

type ControlConn struct {
    JTI            string
    Subdomain      string
    Plan           string                // cached from /plan/{jti}
    PlanFetchedAt  time.Time
    Throttle       *throttle.Limiter     // nil unless past_due
    YamuxSession   *yamux.Session        // multiplexer over the CONNECT body
    InstanceID     string                // x-kryton-instance-id from handshake
    KrytonVersion  string
    EstablishedAt  time.Time
    LastPingOK     atomic.Int64          // unix ns of last successful PING ack
    ByteCounter    *meter.Counter
}

type PeerEntry struct {
    Subdomain string
    PodID     string                     // e.g. "tunnel-1"
    PodAddr   string                     // "tunnel-1.tunnel-headless.kryton-tunnels.svc.cluster.local:8080"
    JTI       string
    SeenAt    time.Time
}

type Registry struct {
    mu     sync.RWMutex
    local  map[string]*ControlConn
    peers  map[string]*PeerEntry
    selfID string
}
```

`local` is authoritative for tenants on this pod. `peers` is the eventually-consistent mirror of every other pod's `local`. Lookups are local-first; entries in `local` take precedence over any peer claim.

Reads (the hot path for every public request) use `RLock`; mutations use `Lock`. Single `sync.RWMutex` over a sharded map for v1 simplicity.

### 2.2 Lookup API

```go
type LookupResult struct {
    Local *ControlConn   // non-nil if local hit
    Peer  *PeerEntry     // non-nil if peer hit
    // Both nil = miss; serve offline page.
}

func (r *Registry) Lookup(subdomain string) LookupResult
```

Total, non-blocking, no I/O.

### 2.3 Internal peer-sync endpoint

Each pod exposes `GET /internal/registry` on `:8080`, routed by path and gated by a strict in-cluster CIDR check on `RemoteAddr`.

```json
{
  "pod_id": "tunnel-0",
  "pod_addr": "tunnel-0.tunnel-headless.kryton-tunnels.svc.cluster.local:8080",
  "as_of": 1747011234.123,
  "subdomains": [
    { "subdomain": "xyz", "jti": "tok_abc", "established_at": 1747010000 },
    { "subdomain": "abc", "jti": "tok_def", "established_at": 1747010500 }
  ]
}
```

Small JSON (~80 KB at 1000 tenants), gzip-able, `Cache-Control: no-store`.

### 2.4 Peer discovery and sync loop

```go
type PeerSyncer struct {
    reg          *Registry
    httpClient   *http.Client
    selfPodID    string
    headlessFQDN string
    tickEvery    time.Duration   // 5s
    staleAfter   time.Duration   // 15s
    httpTimeout  time.Duration   // 2s per peer
}

func (s *PeerSyncer) Run(ctx context.Context) error {
    t := time.NewTicker(s.tickEvery)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            s.syncOnce(ctx)
        }
    }
}
```

`syncOnce` resolves peers via DNS lookup on the headless Service, fans out concurrent GETs, aggregates the results, and atomically swaps the new peer map into the registry. Stale entries (`seenAt < now - staleAfter`) drop out.

**Failure handling:**
- Per-peer request timeout 2 s.
- Peer down → drop its entries from the mirror after `staleAfter`.
- DNS lookup failure → log + retry next tick; use last-known peer list during the gap.
- All peer requests failing simultaneously (partition) → fall back to local registry only; serve offline page for non-local subdomains. Don't crash.

### 2.5 Inter-pod forwarding

```go
type PeerForwarder struct {
    client  *http.Client
    timeout time.Duration         // 30s for HTTP; no timeout for WS bridge
}

func (pf *PeerForwarder) Forward(w http.ResponseWriter, r *http.Request, peer *PeerEntry) error
```

Behavior:
- Loop guard: if `X-Kryton-Tunnel-Forwarded == "1"` already → 502 (topology inconsistency; better to fail than amplify).
- Rewrite scheme to `http://`, target `peer.PodAddr`.
- Strip hop-by-hop headers; preserve original `Host`; set `X-Kryton-Tunnel-Forwarded: 1`; append client IP to `X-Forwarded-For`.
- Stream request body straight through; no buffering.
- Copy response status + headers; stream body.
- For WebSocket upgrades: hijack both sides, splice the connections.

`httputil.NewSingleHostReverseProxy` handles 90% of this; we wrap it for the loop guard and WS bridging.

### 2.6 Registering and unregistering

```go
func (r *Registry) RegisterLocal(cc *ControlConn) (replaced *ControlConn) {
    r.mu.Lock()
    defer r.mu.Unlock()
    prior := r.local[cc.Subdomain]
    r.local[cc.Subdomain] = cc
    delete(r.peers, cc.Subdomain)  // we are authoritative now
    return prior
}

func (r *Registry) UnregisterLocal(subdomain string, cc *ControlConn) {
    r.mu.Lock()
    defer r.mu.Unlock()
    if r.local[subdomain] == cc {
        delete(r.local, subdomain)
    }
}
```

`RegisterLocal` returns any prior connection so the caller can close it cleanly — handles "same tenant reconnects while old conn lingers" without a separate code path.

### 2.7 What ends up in WP

The stats POST every 60 s (§3.4) carries:

```
POST /wp-json/kryton-tunnels/v1/stats
{
  "pod_id": "tunnel-1",
  "pod_addr": "tunnel-1.tunnel-headless.kryton-tunnels.svc.cluster.local:8080",
  "active_jtis": ["tok_abc","tok_def"],
  "samples": [ ... usage rows ... ]
}
```

WP updates `tenants.last_seen_at` / `first_connected_at` for active jtis, and writes usage rows. `pod_id`/`pod_addr` are recorded only for diagnostics in the WP admin tenant view — they do **not** participate in routing.

### 2.8 Concurrency model

- One goroutine per Kryton control connection.
- One goroutine per inbound public request (HTTP server default).
- One goroutine per yamux stream Read/Write loop.
- One goroutine per WS bridging direction.
- One goroutine for peer-sync ticker; one for revocation-list ticker; one for plan refresh; one for stats poster.
- All long-lived goroutines take a `context.Context` derived from a single root tied to SIGTERM. Drain cancels the root; all goroutines exit cleanly.
- `Registry.mu` is `sync.RWMutex`; reads RLock, mutations Lock. Atomic-swap of the peers map keeps lock windows in the nanosecond range.

## 3. JWT verification & WP polling clients

### 3.1 Public-key set

Loaded from a Kubernetes ConfigMap mounted at `/etc/kryton-tunnels/keys/<kid>.pub`. Each file is the base64-encoded 32-byte Ed25519 public key.

```go
type KeySet struct {
    mu   sync.RWMutex
    keys map[string]ed25519.PublicKey   // kid -> pubkey
}

func (ks *KeySet) Verify(token string) (*Claims, error)
```

Verification steps: parse JWT → look up `kid` → `ed25519.Verify` → unmarshal payload → standard claim checks (`iss == "https://kryton.ai"`, `exp > now`, `iat <= now+30s`).

**Hot reload** via `fsnotify` on `/etc/kryton-tunnels/keys/`. External-secrets rotating the ConfigMap → kubelet writes the new file → tunnel server picks it up in <1 s with no restart.

Ed25519 verify is ~50 µs/call; lookup is sub-µs. Handshake JWT verification is dominated by network RTT.

### 3.2 Revocation set

```go
type Revoked struct {
    set             sync.Map         // jti -> struct{}, entries still revoked & unexpired
    lastSyncedAt    atomic.Int64
    asOfFromWP      atomic.Int64
    wpClient        *Client
    pollEvery       time.Duration    // 30s
    onNewRevocation func(jti string) // hook called per new jti for force-close
}

func (rv *Revoked) Run(ctx context.Context)
func (rv *Revoked) IsRevoked(jti string) bool
```

Polls `/revoked?since=<asOfFromWP>` every 30 s. Re-pulls immediately when WP reports `truncated: true`. For each new jti, calls `onNewRevocation`; the hook (wired in `main.go`) looks the jti up in the local registry and force-closes any matching `ControlConn`.

Internal GC every 60 s removes set entries whose token exp has passed.

**Resilience to WP outage:**
- Poll failure → log + back off (next attempt in 30 s, no exponential).
- Set is monotonic between successes; routing keeps working with stale data.
- `tunnel_wp_revoked_age_seconds` exposed for alerting; readiness stays Ready until staleness > `revoked_max_staleness` (default 5 min).

### 3.3 Plan cache

```go
type Plan struct {
    Plan         string  // trialing|active|past_due|...
    Subdomain    string
    ThrottleKbps *int    // nil except past_due
    PeriodStart  time.Time
    PeriodEnd    time.Time
    AbuseThresholdBytes uint64
    AsOf         int64
}

type PlanCache struct {
    mu       sync.Mutex
    entries  map[string]*planEntry   // jti -> {plan, fetchedAt}
    wpClient *Client
    ttl      time.Duration            // 5 min
    sf       singleflight.Group
}

func (pc *PlanCache) Get(ctx context.Context, jti string) (*Plan, error)
func (pc *PlanCache) RefreshLoop(ctx context.Context, getJTIs func() []string)
```

Consumers:

1. **Handshake time:** blocking call (~10–50 ms with WP in-cluster).
2. **Periodic refresh:** every 5 min for every active connection (async). On plan change, swap `cc.Throttle` atomically; existing in-flight requests finish under the old limiter, subsequent ones see the new one.

**Coalescing:** multiple concurrent misses for the same jti collapse to one WP call via `singleflight.Group`.

**Behavior on WP outage during refresh:** keep stale entry; routing continues.

**Behavior on WP outage at handshake:** accept the connection with `plan = "active"`, no throttle, `fetchedAt = epoch` so the next refresh tick re-tries. Fail open here is deliberate — we are a routing service, not a billing enforcer. Suspension via revocation is monotonic and resilient.

### 3.4 Stats poster

Batches per-minute usage samples (§5) plus active-jti list, POSTs to `/stats` every 60 s.

```go
type StatsPoster struct {
    wpClient   *Client
    meter      *meter.Aggregator
    registry   *registry.Registry
    podID      string
    podAddr    string
    flushEvery time.Duration   // 60s
}
```

5 s timeout, 1 retry on transient (5xx / network). Final failure → re-enqueue into meter for next attempt (bounded buffer; oldest drop on overflow).

WP `/stats` upserts on `(tenant_id, period_start)`, so re-POSTs are idempotent.

### 3.5 Shared HTTP client

```go
type Client struct {
    base       string
    bearer     string
    httpClient *http.Client
    breaker    *circuitbreaker.Breaker
}
```

- Circuit breaker opens after 5 consecutive failures, half-open after 30 s. Separate breaker state per endpoint family.
- Bearer read from env on each request → secret rotation via OpenBao/external-secrets takes effect without restart.
- TLS: in-cluster URL `http://kryton-wordpress.kryton-website.svc.cluster.local`, no TLS for normal calls. Fallback `https://kryton.azrty.com` for partition scenarios.

### 3.6 Handshake integration

Order of operations when a Kryton dials `:8443`:

```
1. ingress-nginx terminates TLS; pod sees plain h2c on :8443.
2. tunnel.go reads :authority, :method=CONNECT, authorization header.
3. JWT verify via KeySet.Verify(token).
   → 401 + x-reason: invalid-jwt on failure.
4. revoked.IsRevoked(claims.JTI)?
   → 401 + x-reason: revoked-jwt.
5. planCache.Get(claims.JTI) — blocking, ≤5s.
   → On WP outage: assume "active", no throttle.
6. If plan ∈ {suspended, canceled, purged} → 401 + x-reason: subscription-inactive.
7. registry.RegisterLocal(cc); if prior exists with same instance-id → close prior, accept new.
   If prior exists with different instance-id → 409 + x-reason: duplicate-instance.
8. Respond HTTP/2 200 + x-tunnel-session-id: <uuid>.
9. Start yamux session on the CONNECT body (yamux client role for the tunnel server).
10. Start PING tickers — yamux (5s / 15s timeout) and h2 (5s / 15s timeout).
11. Connection lives until: yamux/h2 timeout, revocation force-close, drain GOAWAY,
    or any I/O error.
```

## 4. Public traffic handling

### 4.1 Wire-protocol clarification

Per the umbrella amendment (§5.3): each tunneled request is a **yamux stream inside the persistent h2 CONNECT body**, carrying plain HTTP/1.1 framing. h2 does not allow server-initiated streams, so the original umbrella's "new h2 stream on the tenant's connection" wording was wrong; yamux gives us the bidirectional multiplexing we need.

```
Kryton ─TLS+h2─▶ ingress-nginx ─h2c─▶ tunnel-pod:8443
                                            │
   ┌─── one persistent h2 CONNECT stream ───┴───┐
   │                                            │
   │       yamux session inside CONNECT body    │
   │  ┌────────┬────────┬────────┬────────┐    │
   │  │ stream1│ stream2│ stream3│ stream4│ …  │
   │  │HTTP req│HTTP req│WS frame│HTTP req│    │
   │  └────────┴────────┴────────┴────────┘    │
   └────────────────────────────────────────────┘
```

### 4.2 The forwarding goroutine

```go
func (f *LocalForwarder) Forward(w http.ResponseWriter, r *http.Request, cc *registry.ControlConn) {
    stream, err := cc.YamuxSession.OpenStream()
    if err != nil {
        // tunnel dead; drop from registry, return 502.
        return
    }
    defer stream.Close()

    if isWebSocketUpgrade(r) {
        f.bridgeWebSocket(w, r, stream, cc)
        return
    }

    // Plain HTTP path:
    // 1. Rewrite headers (strip hop-by-hop + inbound X-Forwarded-*/X-Real-IP/X-Kryton-Tunnel-*).
    // 2. Inject X-Forwarded-For (chain), X-Forwarded-Proto: https, X-Real-IP,
    //    X-Forwarded-Host, X-Kryton-Tunnel-Request-Id.
    // 3. r.Write(stream) — produces byte-perfect HTTP/1.1 on the wire.
    // 4. resp, _ := http.ReadResponse(bufio.NewReader(stream), r).
    // 5. Copy status + headers to w; io.Copy(w, resp.Body) wrapped for metering and throttling.
    // 6. cc.ByteCounter.Add(bytesIn, bytesOut, 1).
    // 7. On any error mid-stream, return 502; log with X-Kryton-Tunnel-Request-Id.
}
```

`Request.Write(stream)` produces a byte-perfect HTTP/1.1 representation; Kryton's Fastify reads it with its standard HTTP/1.1 parser.

**Stream timeouts:** none default. Long-running requests (file uploads, SSE, hung clients) are bounded by yamux keepalive + public-client idle timeout. We set a `MaxStreamLifetime` of 24 h as a sanity cap.

### 4.3 WebSocket bridging

Once both ends agree to upgrade, the yamux stream is just raw bytes.

```go
func (f *LocalForwarder) bridgeWebSocket(w http.ResponseWriter, r *http.Request, stream *yamux.Stream, cc *registry.ControlConn) {
    // 1. Hijack the inbound client connection.
    // 2. Write the original HTTP/1.1 Upgrade request to the yamux stream
    //    (same header rewriting as §4.2).
    // 3. Read response from Kryton.
    //    - 101 → forward 101 + headers to client, flush, then bridge bytes.
    //    - Otherwise → forward response, close stream, return.
    // 4. go io.Copy(stream, clientConn)      // browser → Kryton
    //    io.Copy(clientConn, stream)         // Kryton → browser
    //    Wrap both with meter + throttle. First to return cancels the other.
}
```

Covers `/ws/yjs/:docId` (Yjs collab), MCP streaming endpoints (`Transfer-Encoding: chunked`, handled by the plain-HTTP path), and any future WS endpoints.

### 4.4 Inter-pod forwarding integration

```go
switch result := registry.Lookup(subdomain); {
case result.Local != nil:
    localForwarder.Forward(w, r, result.Local)
case result.Peer != nil:
    peerForwarder.Forward(w, r, result.Peer)
default:
    offline.Render(w, subdomain, requestID)
}
```

`PeerForwarder` preserves the original `Host` (the owning pod uses it for local lookup) and sets `X-Kryton-Tunnel-Forwarded: 1` to detect loop amplification.

### 4.5 Public listener

```go
server := &http.Server{
    Addr:              ":8080",
    Handler:           h2c.NewHandler(s.handler, s.h2Server),
    ReadHeaderTimeout: 10 * time.Second,
    ReadTimeout:       0,
    WriteTimeout:      0,
    IdleTimeout:       60 * time.Second,
}
```

`h2c.NewHandler` lets the same listener serve HTTP/1.1 (peer-to-peer forwarded requests) and h2c (ingress-nginx-forwarded public traffic). Graceful shutdown via `server.Shutdown(ctx)` with a 30 s deadline.

### 4.6 Public error responses

| Condition | Response |
|---|---|
| Local hit, request succeeded | 1:1 from Kryton |
| Local hit, Kryton returned 5xx | 1:1 from Kryton |
| Local hit, yamux stream open failed | 502 Bad Gateway + offline page |
| Local hit, Kryton I/O failure mid-response | 502 if headers not yet sent; stream truncated otherwise |
| Peer hit, peer reachable, succeeded | 1:1 from peer's response |
| Peer hit, peer unreachable | 502 + offline page |
| Both miss | 410 Gone + offline page |
| Loop-amplification (`X-Kryton-Tunnel-Forwarded` already set) | 502 plain text |
| WS upgrade attempted, no tunnel | 410 Gone (browsers fail the WS) |

## 5. Bandwidth metering & abuse flag

Per the umbrella's "hidden 10 GB/month, manual triage" framing — we count, post, and flag, but **do not enforce** in v1. No automatic disconnect, no automatic throttle, no user-visible feedback.

### 5.1 Counters

One `Counter` per `ControlConn`, atomic-only on the hot path:

```go
type Counter struct {
    bytesIn   atomic.Uint64
    bytesOut  atomic.Uint64
    requests  atomic.Uint64
    abuseFlag atomic.Bool
}

func (c *Counter) Add(in, out int64, requestDelta uint64)
```

Forwarder calls `Add` after each HTTP request and periodically (~every 64 KB) during WS byte streams.

### 5.2 Sample buckets

```go
type Sample struct {
    JTI          string
    PodID        string
    PeriodStart  time.Time   // minute-aligned
    BytesIn      uint64
    BytesOut     uint64
    Requests     uint64
    AbuseFlagged bool
}

type Aggregator struct {
    mu     sync.Mutex
    prev   map[string]struct{ in, out, req uint64 }
    buffer []Sample           // bounded ring; oldest dropped on overflow
    cap    int
}

func (a *Aggregator) FlushNow(registry *registry.Registry) []Sample
```

Counters are cumulative; flush diffs against the previous tick's snapshot to produce one bucket per active tenant per minute. Empty buckets (all zero) are skipped — no WP row written for an idle minute.

### 5.3 Abuse-flag computation

Tunnel server uses the extended `/plan/{jti}` payload (`current_period_start`, `current_period_end`, `abuse_threshold_bytes`) to compute the flag locally:

```go
func (a *Aggregator) computeAbuseFlag(cc *registry.ControlConn, snapshot Sample) bool {
    plan := cc.CachedPlan
    if plan == nil || plan.AbuseThresholdBytes == 0 { return false }
    periodTotal := cc.PeriodTotalAt(snapshot.PeriodStart)
    return (periodTotal.BytesIn + periodTotal.BytesOut) >= plan.AbuseThresholdBytes
}
```

Once tripped during a period, every subsequent sample carries `abuse_flagged: true` until the period rolls.

### 5.4 Pod-local vs cluster-wide

Each pod meters only the traffic it forwards. WP's `usage` table (upsert on `(tenant_id, period_start)`) aggregates across pods. The **authoritative cluster-wide flag** is computed by WP's daily reconcile cron summing all pod samples for the tenant in the period; the per-sample bit is a fast-but-best-effort signal.

The dashboard reads from `tenants.abuse_flagged` (WP-owned), not from individual sample bits.

### 5.5 Bounded buffer

If WP is unavailable for a flush, samples re-enqueue. Buffer capped at ~120 minutes × max-active-tenants-per-pod. On overflow, oldest sample drops and `tunnel_meter_buckets_dropped_total` increments.

### 5.6 Future v1.x (NOT in v1)

- In-process mid-stream throttling on abuse trip.
- Per-tenant rate limits (requests/sec cap).
- Inbound vs outbound bandwidth split in user-facing dashboard.
- Per-request size cap.

## 6. Throttling for `past_due` tenants

256 kbps per direction, applied via a token-bucket limiter on each yamux stream copy. Visibly degraded but not surgically so — the goal is to prompt the user to update their payment method.

### 6.1 Limiter

```go
import "golang.org/x/time/rate"

type Limiter struct {
    inner *rate.Limiter   // nil = no throttle
}

func New(kbps int) *Limiter {
    if kbps <= 0 { return nil }
    bytesPerSec := rate.Limit(kbps * 1024 / 8)
    burst := int(bytesPerSec)   // 1s of burst
    return &Limiter{inner: rate.NewLimiter(bytesPerSec, burst)}
}

func (l *Limiter) Wait(ctx context.Context, n int) error
```

One `*Limiter` per `ControlConn`, attached from the cached plan at connection setup. When the plan refresh loop observes `active → past_due` or back, it atomically swaps `cc.Throttle`. In-flight requests finish under the old limiter; subsequent requests see the new one.

### 6.2 Applying the limiter

```go
type throttledReader struct {
    r     io.Reader
    limit *Limiter
    ctx   context.Context
}

func (tr *throttledReader) Read(p []byte) (int, error) {
    if len(p) > 4096 { p = p[:4096] }
    n, err := tr.r.Read(p)
    if n > 0 && tr.limit != nil {
        if werr := tr.limit.Wait(tr.ctx, n); werr != nil {
            return n, werr
        }
    }
    return n, err
}

func Wrap(r io.Reader, l *Limiter, ctx context.Context) io.Reader {
    if l == nil { return r }
    return &throttledReader{r: r, limit: l, ctx: ctx}
}
```

Both directions are wrapped (HTTP path and both WS bridge halves). 256 kbps cap is **per-direction**, not aggregate. `Wrap` is a no-op when `l == nil` — zero overhead on the hot path for trial/active tenants.

### 6.3 Edge cases

- `active → canceling_at_period` → throttle stays off; user paid for this period.
- `past_due → suspended` → revocation catches in ≤30 s, connection drops.
- Plan change mid-large-upload → in-flight transfer continues at the previous rate; the plan refresh runs every 5 min and doesn't retroactively re-rate active readers. Acceptable.
- Limiter doesn't account for h2/yamux framing overhead — small inaccuracy. Cap is rough by design.

## 7. Offline page

Single template, rendered for both "tenant exists but disconnected" and "subdomain never claimed" (the tunnel server can't distinguish them, and SEO treatment should be the same).

```go
var tmpl = template.Must(template.New("offline").Parse(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>{{.Subdomain}}.my.kryton.ai — offline</title>
  <style>...minimal CSS, ~30 lines, dark/light via prefers-color-scheme...</style>
</head>
<body>
  <main>
    <h1>This Kryton is offline</h1>
    <p>The owner's Kryton server isn't currently connected to
       <code>{{.Subdomain}}.my.kryton.ai</code>.</p>
    <p>If you're the owner: check that your Kryton is running and that
       the tunnel token is pasted into Admin → Tunnel.
       See <a href="https://kryton.ai/tunnels/help">help</a>.</p>
    <p><small>Request ID: {{.RequestID}}</small></p>
  </main>
</body>
</html>
`))

func Render(w http.ResponseWriter, subdomain, requestID string) {
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    w.Header().Set("Cache-Control", "no-store")
    w.Header().Set("X-Robots-Tag", "noindex, nofollow")
    w.WriteHeader(http.StatusGone) // 410
    tmpl.Execute(w, struct{ Subdomain, RequestID string }{subdomain, requestID})
}
```

Subdomain pre-validated against `[a-z0-9-]{3,30}` regex before render; invalid host → generic page. Health endpoints (`/healthz`, `/readyz`) are gated before the routing dispatch and never produce the offline page.

`410 Gone` always — search engines drop the URL. Page text reads "offline" to communicate state. We deliberately don't return 503 (which would suggest temporary) because we can't distinguish "tenant exists but disconnected" from "subdomain unclaimed."

## 8. Observability

### 8.1 Prometheus metrics

Exposed on `:9090/metrics`. Cardinality is bounded — no per-tenant labels.

```
# Connection lifecycle
tunnel_control_connections_active{pod_id}                  gauge
tunnel_control_connections_total{pod_id, outcome}          counter
tunnel_control_connections_duration_seconds{pod_id}        histogram

# Public request handling
tunnel_public_requests_total{pod_id, route, status_class, dispatch}  counter
tunnel_public_request_duration_seconds{pod_id, dispatch}    histogram
tunnel_public_bytes_total{pod_id, direction, dispatch}      counter

# Peer mesh health
tunnel_peer_sync_duration_seconds{pod_id}                   histogram
tunnel_peer_sync_errors_total{pod_id, peer_id}              counter
tunnel_peer_registry_size{pod_id}                           gauge
tunnel_local_registry_size{pod_id}                          gauge

# WP client health
tunnel_wp_request_duration_seconds{endpoint}                histogram
tunnel_wp_request_errors_total{endpoint, kind}              counter
tunnel_wp_revoked_age_seconds                               gauge
tunnel_wp_plan_cache_hit_ratio                              gauge

# Meter & stats
tunnel_meter_buckets_emitted_total{pod_id}                  counter
tunnel_meter_buckets_dropped_total{pod_id}                  counter
tunnel_meter_abuse_flags_set_total{pod_id}                  counter

# Throttle
tunnel_throttle_active_tenants{pod_id}                      gauge

# Process
go_*                                                        runtime
process_*                                                   process
```

`outcome` labels: `accepted | rejected_jwt | rejected_revoked | rejected_plan | rejected_duplicate`.
`dispatch` labels: `local | peer | offline`.
`kind` labels (WP errors): `timeout | 5xx | breaker_open`.

### 8.2 Structured logs

JSON via `log/slog`, one record per line. Every log carries `ts`, `level`, `pod_id`, and where applicable `request_id`, `subdomain`, `jti`. Never the full JWT.

Sample lines:
```
{"ts":"...","level":"INFO","pod_id":"tunnel-1","event":"control_connect","subdomain":"xyz","jti":"tok_abc","kryton_version":"0.1.0","instance_id":"1a2b…"}
{"ts":"...","level":"INFO","pod_id":"tunnel-1","event":"request_forwarded","request_id":"r_xyz123","subdomain":"xyz","dispatch":"local","method":"POST","path":"/api/notes","status":201,"duration_ms":47,"bytes_in":340,"bytes_out":89}
{"ts":"...","level":"WARN","pod_id":"tunnel-1","event":"wp_request_failed","endpoint":"plan","jti":"tok_def","err":"context deadline exceeded","retry_in_s":5}
{"ts":"...","level":"INFO","pod_id":"tunnel-1","event":"control_disconnect","subdomain":"xyz","jti":"tok_abc","duration_s":3601,"reason":"goaway_drain"}
```

Shipped to the existing `logging` namespace (Loki/Promtail or equivalent); no app-side log forwarding code.

### 8.3 Tracing

Out of scope for v1. Request IDs give us cross-component correlation, which is sufficient at our scale. Add OpenTelemetry if/when distributed tracing across WP + tunnel + Kryton becomes useful.

### 8.4 Health endpoints

- `GET /healthz` → 200 if process is up.
- `GET /readyz` → 200 if:
  - JWT KeySet loaded (at least one valid kid).
  - Initial peer-sync completed (or only one pod expected).
  - Revocation list staleness ≤ `revoked_max_staleness` (default 5 min) OR initial pull completed.
  - Returns 503 with JSON body listing failed conditions otherwise.

SIGTERM flips readiness to 503 immediately (start of the §1.4 drain) so ingress-nginx stops sending new traffic.

## 9. Kubernetes deployment

Helm chart under `deploy/chart/`, deployed via an ArgoCD `Application`.

### 9.1 Chart contents

```
deploy/chart/
  Chart.yaml
  values.yaml
  templates/
    statefulset.yaml
    service-tunnel.yaml         # ClusterIP, used by ingresses
    service-headless.yaml       # ClusterIP: None, for peer discovery DNS
    service-metrics.yaml
    ingress-public.yaml         # *.my.kryton.ai → tunnel Service :8080
    ingress-control.yaml        # tunnel.kryton.ai → tunnel Service :8443 (h2c)
    certificate-wildcard.yaml   # *.my.kryton.ai + my.kryton.ai
    certificate-control.yaml    # tunnel.kryton.ai (single name)
    configmap-pubkeys.yaml      # JWT public keys, one entry per kid
    externalsecret-bearer.yaml  # KRYTON_TUNNELS_SERVER_BEARER from OpenBao
    configmap-config.yaml
    pdb.yaml                    # minAvailable: 2
    servicemonitor.yaml         # Prometheus Operator CR
```

### 9.2 StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: tunnel
  namespace: kryton-tunnels
spec:
  replicas: 3
  serviceName: tunnel-headless
  podManagementPolicy: OrderedReady
  updateStrategy:
    type: RollingUpdate
  template:
    spec:
      terminationGracePeriodSeconds: 35
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels: { app: tunnel }
                topologyKey: kubernetes.io/hostname
      containers:
        - name: tunnel
          image: ghcr.io/azrtydxb/kryton-tunnel-server:<tag>
          ports:
            - { name: public,  containerPort: 8080 }
            - { name: control, containerPort: 8443 }
            - { name: metrics, containerPort: 9090 }
          env:
            - name: POD_ID
              valueFrom: { fieldRef: { fieldPath: metadata.name } }
            - name: POD_ADDR
              value: $(POD_ID).tunnel-headless.kryton-tunnels.svc.cluster.local:8080
            - name: KRYTON_TUNNELS_SERVER_BEARER
              valueFrom: { secretKeyRef: { name: tunnel-server-bearer, key: value } }
            - name: WP_BASE_URL
              value: http://kryton-wordpress.kryton-website.svc.cluster.local
          volumeMounts:
            - { name: pubkeys, mountPath: /etc/kryton-tunnels/keys, readOnly: true }
            - { name: config,  mountPath: /etc/kryton-tunnels/config, readOnly: true }
          readinessProbe:
            httpGet: { path: /readyz, port: 9090 }
            initialDelaySeconds: 2
            periodSeconds: 3
            failureThreshold: 2
          livenessProbe:
            httpGet: { path: /healthz, port: 9090 }
            periodSeconds: 10
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "kill -SIGTERM 1; sleep 30"]
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 1000m, memory: 512Mi }
      volumes:
        - name: pubkeys
          configMap: { name: tunnel-jwt-pubkeys }
        - name: config
          configMap: { name: tunnel-config }
```

### 9.3 Ingresses

```yaml
# templates/ingress-public.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tunnel-public
  namespace: kryton-tunnels
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-cloudflare
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    nginx.ingress.kubernetes.io/upstream-keepalive-timeout: "60"
spec:
  ingressClassName: nginx
  tls:
    - hosts: ["*.my.kryton.ai", "my.kryton.ai"]
      secretName: my-kryton-ai-wildcard-tls
  rules:
    - host: "*.my.kryton.ai"
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: tunnel, port: { number: 8080 } }
```

```yaml
# templates/ingress-control.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tunnel-control
  namespace: kryton-tunnels
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-cloudflare
    nginx.ingress.kubernetes.io/backend-protocol: "HTTP2"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "86400"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "86400"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
spec:
  ingressClassName: nginx
  tls:
    - hosts: ["tunnel.kryton.ai"]
      secretName: tunnel-kryton-ai-tls
  rules:
    - host: tunnel.kryton.ai
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: tunnel, port: { number: 8443 } }
```

`tunnel.kryton.ai` is a separate Certificate (single-name), not part of the wildcard SAN — the wildcard cert covers only `*.my.kryton.ai`.

### 9.4 PodDisruptionBudget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: tunnel
  namespace: kryton-tunnels
spec:
  minAvailable: 2
  selector:
    matchLabels: { app: tunnel }
```

Allows node drain to take down one pod at a time but never two.

### 9.5 ArgoCD

A separate `Application` manifest in the platform repo points to `deploy/chart/`. Auto-sync prune off; explicit approval required. Image tag pinned via manual commits to `values.yaml` (or image-updater later).

## 10. Testing

### 10.1 Unit (`go test ./...`)

- `internal/jwt`: round-trip with multiple keys, kid mismatch, expired, invalid signature, malformed.
- `internal/registry`: register/unregister local, peer map merge with stale TTL, concurrent reader/writer correctness via `-race`.
- `internal/throttle`: limiter rate accuracy with a fake clock; nil-limiter no-op fast path.
- `internal/meter`: counter atomics, sample diff math, bounded buffer drop-oldest, period rollover.
- `internal/offline`: template renders, robots header set, subdomain sanitisation against host-header injection.
- `internal/wpclient`: each endpoint via `httptest.Server`, circuit breaker state transitions, retry on 5xx, no retry on 4xx, response parsing.

### 10.2 Integration (`go test ./test/integration -tags=integration`)

Run against a fake WP (`httptest`) and a real yamux peer:

- Handshake matrix: valid JWT, expired, revoked, unknown kid, mismatched subdomain, duplicate instance, WP-down-treat-as-active.
- Request forwarding (HTTP): GET, POST with body, large response streaming, abrupt client/Kryton disconnect mid-response.
- WebSocket bridging: upgrade, bidirectional bytes, server-initiated close, client-initiated close.
- Peer forwarding: request lands on pod B, peer map says owner is pod A, traffic round-trips via internal HTTP, loop guard rejects double-forward.
- Drain: SIGTERM mid-traffic — in-flight requests complete, new connects get GOAWAY, registry update propagates within 5 s.

### 10.3 E2E (`test/e2e`)

Spin up a kind cluster, deploy the Helm chart with 3 replicas + a fake WP, run a tiny Go h2-CONNECT client simulating Kryton, run a Go HTTP client against a public hostname:

1. Connect, accept JWT, route a GET, expected response body.
2. Open a WS, send 100 messages each way, all echoed.
3. Cordon one pod — Kryton reconnects, traffic continues.
4. Hard-kill one pod — ≤30 s recovery window, traffic resumes.
5. Revoke the JWT in fake WP — connection torn within 35 s.

CI runs unit + integration on every PR; e2e is `-tags=e2e`, runs nightly + pre-release.

### 10.4 Load / soak (NOT in v1)

Documented as future work: k6 or vegeta at v1 expected load (10 rps × 50 tenants) for 24 h, watching for goroutine/memory leaks, peer-mesh stability, WP-poll backpressure under partial outage. Add once we have a real beta-tenant fleet.

## 11. Open items deferred to plan

- Exact circuit-breaker library (`sony/gobreaker` is the obvious choice; confirm at planning time).
- Whether to use Helm or raw manifests under `deploy/k8s/` (this spec assumes Helm; revisit if it adds friction).
- Image-tag pinning: Argo image-updater vs manual commits.
- Exact Prometheus scrape interval (cluster default is fine; verify).
- DigitalOcean LB external IP for the static DNS record (filled in at infra setup time).

## 12. Out of scope (v1, deferred)

- Multi-region tunnel deployments.
- In-process mid-stream throttling on abuse trip.
- Per-tenant rate limits (requests/sec cap).
- BYO custom domains (`notes.mycompany.com`).
- TCP/UDP tunneling (HTTP + WS is enough).
- Self-hosted tunnel server for enterprise customers.
- Tunnel server admin CLI.
- OpenTelemetry distributed tracing.
- Redis or other shared registry store (peer mesh is sufficient at v1 scale).
