# Kryton Tunnel Client + Admin UI (Sub-spec 4c)

**Date:** 2026-05-12
**Status:** Approved (design). Plan to follow.
**Umbrella:** [2026-05-12-reverse-tunnel-architecture-design.md](./2026-05-12-reverse-tunnel-architecture-design.md)
**Scope:** Server module + admin UI added to the existing `azrtydxb/kryton` repo so a Kryton instance can dial out to `tunnel.kryton.ai`, hold a persistent yamux session open, and route inbound public traffic into its own Fastify app. Sub-spec 4c of 4.

This spec assumes the umbrella's contracts (JWT, wire protocol — including the 2026-05-12 amendments on yamux multiplexing, HA peer mesh, and the extended `/plan/{jti}` payload) and sub-specs 4a + 4b are settled.

## 1. Where things slot in

### 1.1 Server module

New module `packages/server/src/modules/tunnel/`, sibling to existing `agents`, `collab`, `identity`, `knowledge`, `notes`, `platform`, `plugins`.

```
packages/server/src/modules/tunnel/
  index.ts                          # Fastify plugin: registers admin routes + starts the client
  routes/
    admin-tunnel.routes.ts          # /api/admin/tunnel/* (status, set/clear token, stats, reconnect)
  services/
    tunnel-client.service.ts        # holds the persistent yamux session; reconnect logic
    loopback-injector.service.ts    # converts inbound yamux streams into local HTTP requests
    tunnel-state.service.ts         # in-memory state + Settings-table persistence
    tunnel-stats.service.ts         # rolling counters + daily aggregates
  schemas/
    admin-tunnel.schemas.ts         # Zod schemas
  __tests__/
    tunnel-client.test.ts
    loopback-injector.test.ts
    admin-tunnel.routes.test.ts
```

`tunnelModule` is a `FastifyPluginAsync` registered from `packages/server/src/app.ts` alongside the other modules. Its admin routes mount under the existing `/api/admin` prefix (same as `adminUsersRoutes`, `adminInvitesRoutes`, `adminSettingsRoutes`).

The module exposes the client singleton via Fastify decorator: `app.tunnelClient: TunnelClient`. Service classes are not exported outside the module — only the decorator and the admin routes.

### 1.2 Client tab

`AdminPage.tsx` adds one tab:

```tsx
type Tab = 'users' | 'invites' | 'settings' | 'plugins' | 'tunnel';

const TABS = [
  { key: 'users',    label: 'Users',    icon: Users },
  { key: 'invites',  label: 'Invites',  icon: Ticket },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'plugins',  label: 'Plugins',  icon: Package },
  { key: 'tunnel',   label: 'Tunnel',   icon: Globe },
];

{tab === 'tunnel' && <TunnelTab />}
```

`TunnelTab` lives at `packages/client/src/pages/TunnelTab.tsx` (mirroring `PluginsTab.tsx`'s placement). Uses the existing `Section`/`Field` primitives from `settings-kit` for visual consistency. No new design tokens; reuses `--bg-1`, `--accent`, `--fg-3`, etc.

### 1.3 Boot-time lifecycle

```
app.ready() resolves
  │
  ▼
tunnelModule decorates app.tunnelClient
  │
  ▼
app.server.once('listening') fires
  │
  ▼
loopback.setLocalPort(<port from server.address()>)
  │
  ▼
settings.get('tunnel.jwt')
  │
  ├─ null → log "no tunnel JWT configured; skipping"; remain idle
  └─ jwt  → tunnelClient.start(jwt)
              │
              ▼
            connectLoop runs indefinitely (reconnect on disconnect,
            backoff on failure, fatal-pinned on revoked/expired/etc.)
```

Admin pasting/clearing a token via the UI updates Settings and calls `tunnelClient.restart()` or `.stop()`.

### 1.4 Auth on the admin routes

Same pattern as existing admin routes (`adminUsersRoutes` etc.): `requireAdmin` decorator/preHandler. Only users with `role === 'admin'` reach the endpoints. Regular users can't open the admin panel at all, so the tab is naturally invisible to them.

The token itself is a server-wide secret, not per-user. There is only ever one active tunnel JWT per Kryton instance (matches the umbrella's "1 server = 1 subdomain" rule).

### 1.5 Settings storage

Reuses Kryton's existing `Settings` table. New keys under the `tunnel.*` namespace:

| Key | Type | Notes |
|---|---|---|
| `tunnel.jwt` | string | The full JWT, stored as-is. |
| `tunnel.jti` | string | Cached `jti` claim, for diagnostics + audit log. |
| `tunnel.subdomain` | string | Cached `subdomain` claim. |
| `tunnel.exp` | integer (unix) | Cached `exp` claim, for "expires in N days" display. |
| `tunnel.instance_id` | uuid | Persistent across restarts; used in handshake `x-kryton-instance-id`. Generated once on first ever client start. |
| `tunnel.last_connected_at` | datetime | For audit / admin diagnostics. |
| `tunnel.last_error` | string | Last surface-level disconnect reason. |

JWT is stored as-is. Kryton already has a Postgres database with auth secrets in it; the row is one string; encryption-at-rest is a v2 concern handled at the database/infra layer if compliance ever asks.

A new small table `tunnel_traffic_daily` stores aggregated stats (one row per day):

```sql
CREATE TABLE tunnel_traffic_daily (
  day        date              PRIMARY KEY,
  requests   bigint UNSIGNED   NOT NULL DEFAULT 0,
  bytes_in   bigint UNSIGNED   NOT NULL DEFAULT 0,
  bytes_out  bigint UNSIGNED   NOT NULL DEFAULT 0,
  updated_at timestamp         NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP
);
```

Drizzle migration adds it; nothing else in Kryton touches it.

## 2. The tunnel client

### 2.1 Dependencies

- **`node:http2`** — outer h2 client. Mature, built into Node.
- **yamux for Node** — choice deferred to plan after a one-day spike. Top candidate: `@chainsafe/libp2p-yamux` (or `@libp2p/yamux`) with `version: 0` flag to match hashicorp/yamux framing. Fallback: small in-repo implementation against the hashicorp/yamux spec (~500 LOC of well-defined protocol).
- **`pino`** — already in Fastify, reused as `app.log`.
- No other new npm dependencies.

### 2.2 State machine

```
TunnelClient
  state: 'idle' | 'connecting' | 'open' | 'closing' | 'backoff' | 'fatal'
  start(jwt)        — kick off the connect loop
  stop({timeoutMs}) — graceful shutdown
  restart(newJwt)   — stop + start
  getStatus()       — readiness for the admin tab REST surface
  on('open' | 'close' | 'error' | 'state-change' | 'last-error')
```

Singleton, created at app start by the `tunnelModule` plugin. State transitions are explicit. Admin REST routes only mutate via `start/stop/restart` — never poke internal state directly.

### 2.3 Connect flow

```typescript
async function connectOnce(jwt: string, abortSignal: AbortSignal): Promise<TunnelSession> {
  const claims = decodeJwtUnverified(jwt);

  const session = http2.connect('https://tunnel.kryton.ai', {
    settings: { enablePush: false },
  });

  const stream = session.request({
    ':method':                 'CONNECT',
    ':authority':              'tunnel.kryton.ai',
    'authorization':           `Bearer ${jwt}`,
    'x-kryton-version':         krytonVersion,
    'x-kryton-instance-id':     persistentInstanceId,
  });

  const { status, xReason } = await firstHeaders(stream, abortSignal);
  if (status !== 200) {
    session.close();
    throw new TunnelHandshakeError(status, xReason);
  }

  // CONNECT body is a bidirectional bytestream. Start yamux in server role —
  // we accept inbound streams initiated by the tunnel server.
  const yamux = new Yamux(stream, { role: 'server', enableKeepAlive: false });

  startH2PingTicker(session, { intervalMs: 5_000, timeoutMs: 15_000 });

  yamux.on('stream', (yamuxStream) => loopback.handle(yamuxStream));

  return new TunnelSession({ session, stream, yamux, claims });
}
```

`persistentInstanceId` is a UUID generated once on the first ever client start (stored as `tunnel.instance_id` in Settings) and reused across restarts. The tunnel server uses it to distinguish "same Kryton reconnecting" from "someone else stole my token."

### 2.4 Reconnect loop

```typescript
async function connectLoop(jwt: string) {
  let attempt = 0;
  while (state !== 'closing' && state !== 'fatal') {
    state = 'connecting';
    try {
      const session = await connectOnce(jwt, abortController.signal);
      attempt = 0;
      state = 'open';
      lastError = null;
      app.log.info({ subdomain }, 'tunnel connected');
      await session.waitClosed();
      state = 'backoff';
    } catch (err) {
      lastError = err;
      if (err instanceof TunnelHandshakeError) {
        if (['invalid-jwt','revoked-jwt','subscription-inactive','duplicate-instance']
              .includes(err.xReason)) {
          state = 'fatal';
          break;
        }
      }
    }
    const ms = jitter(Math.min(60_000, 1_000 * 2 ** attempt));
    attempt++;
    await delay(ms, abortController.signal);
  }
  state = 'idle';
}
```

**Fatal states** stop retrying — admin sees the reason in the UI and either pastes a new token or clicks "Try again" to re-enter the loop.

**Non-fatal errors** (network drops, server restarts, transient 5xx during handshake, ping timeouts) trigger backoff indefinitely (1 s, 2 s, 4 s, 8 s, 16 s, 32 s, cap 60 s, ±20 % jitter).

### 2.5 Heartbeat

- **h2 PING** every 5 s via `session.ping()` (node:http2 API); three missed → close session.
- **yamux PING** is initiated by the tunnel server (configured `enableKeepAlive: false` on our yamux server role). We only respond.

Outer h2 ping detects frozen TLS state that yamux might miss (proxy / LB glitch).

### 2.6 Graceful shutdown

```typescript
app.addHook('onClose', async () => {
  await app.tunnelClient.stop({ timeoutMs: 5_000 });
});
```

`stop()`:
1. State → `'closing'`.
2. Send yamux `GoAway` to the tunnel server.
3. Stop accepting new yamux streams; cancel any in-flight reconnect attempt.
4. Wait up to `timeoutMs` for in-flight inbound requests to drain.
5. Close yamux session; close h2 session.

The tunnel server removes us from its registry; public traffic gets the offline page until Kryton restarts and reconnects.

### 2.7 Status exposed to the admin tab

```typescript
type TunnelStatus =
  | { state: 'idle';       message: string }
  | { state: 'connecting' }
  | { state: 'open';       subdomain: string; sessionId: string;
                           connectedAt: number; tokenExpiresAt: number }
  | { state: 'backoff';    nextAttemptAt: number; lastError: string }
  | { state: 'fatal';      reason: 'invalid-jwt'|'revoked-jwt'|'subscription-inactive'|'duplicate-instance'|'unknown';
                           message: string }
  | { state: 'closing' };
```

Polled by the admin tab every 2–5 s while visible (faster when not in steady-state).

State transitions also write `tunnel.last_connected_at` / `tunnel.last_error` to Settings for diagnostics across restarts and audit-log entries (see §4.5).

### 2.8 Concurrency

- One `TunnelClient` singleton per Kryton.
- `connectLoop` is one long-lived async function; no thread pool.
- yamux streams come in as Node `Duplex` streams; each handed straight to the loopback injector (§3).
- Backpressure: each yamux stream has its own flow-control window; loopback splices honor Node's stream backpressure end-to-end. No global queue, no global limit.

## 3. Loopback injector

The injector takes each inbound yamux stream and pipes it bidirectionally to a freshly dialed loopback TCP socket targeting Fastify's own listener. Fastify treats it like any other request.

### 3.1 Shape

```
yamux stream ───┐                          ┌─── 127.0.0.1:<kryton port>
   (inbound)    │                          │     (Fastify listener)
                │   ┌──────────────────┐   │
                │   │ LoopbackInjector │   │
                ├──▶│   - net.connect  ├──▶│
                │   │   - pipe both    │   │
                │◀──│     ways         │◀──│
                │   └──────────────────┘   │
```

### 3.2 Implementation

```typescript
import { connect as netConnect } from 'node:net';

export class LoopbackInjector {
  constructor(
    private readonly localPort: number,
    private readonly localHost: string = '127.0.0.1',
    private readonly log: FastifyBaseLogger,
  ) {}

  handle(yamuxStream: Duplex): void {
    const requestId = crypto.randomUUID();
    const socket = netConnect({ host: this.localHost, port: this.localPort });

    socket.once('connect', () => {
      yamuxStream.pipe(socket);
      socket.pipe(yamuxStream);

      const wrapUp = (label: string, err?: Error) => {
        this.log.debug({ requestId, label, err }, 'tunnel loopback ended');
        socket.destroy();
        yamuxStream.destroy();
      };

      yamuxStream.once('end',   () => wrapUp('yamux_end'));
      yamuxStream.once('error', e  => wrapUp('yamux_error', e));
      socket.once('end',         () => wrapUp('socket_end'));
      socket.once('error',       e => wrapUp('socket_error', e));
    });

    socket.once('error', (err) => {
      this.log.warn({ requestId, err: serializeErr(err) },
                    'tunnel loopback dial failed');
      yamuxStream.destroy(err);
    });
  }

  setLocalPort(port: number) { (this as any).localPort = port; }
}
```

~40 lines. The yamux library handles framing; Fastify handles HTTP. The injector sits between them with one dialed TCP socket per request.

### 3.3 No header rewriting on Kryton side

The tunnel server (4b §4.2) already does all the header work:
- Strips inbound `X-Forwarded-*` / `X-Real-IP` / `X-Kryton-Tunnel-*` (defence in depth).
- Injects `X-Forwarded-For`, `X-Forwarded-Proto: https`, `X-Real-IP`, `X-Forwarded-Host`, `X-Kryton-Tunnel-Request-Id`.

The injector pipes those bytes verbatim. Duplicating header logic in two places is anti-defence.

### 3.4 Trust-proxy

Fastify must trust `X-Forwarded-*` from loopback so the request IP propagates correctly to audit logs and rate limiting:

```typescript
const app = Fastify({
  trustProxy: ['127.0.0.1/8', '::1/128', ...existingTrustList],
});
```

If Kryton's `app.ts` already has a `trustProxy` setting (for users running Kryton behind their own Caddy/nginx), we **add** loopback to it — never replace. If it doesn't, we add this default.

**Safety:** an attacker spoofing `X-Forwarded-For` would need access to the local loopback interface; at that point trust-proxy is the least of the operator's problems.

### 3.5 Streaming / WS / SSE

Because we pipe raw bytes, the injector is protocol-agnostic. HTTP/1.1 `Upgrade: websocket` works naturally — Fastify's `@fastify/websocket` handles the upgrade exactly as if a real client dialed in. SSE / chunked transfer-encoding work identically.

### 3.6 Backpressure and limits

- **No connection pool in v1.** Fresh loopback TCP dial per request. Loopback connect is ~10 µs; pooling can be added if metrics show it matters.
- **No per-stream timeouts at this layer.** Fastify's own keep-alive / body-timeout / request-timeout settings apply once bytes hit it. The tunnel server's `MaxStreamLifetime` (24 h) acts as a final cap.

### 3.7 Boot-time race

If `loopback.handle()` fires before Fastify's listener is up (e.g. tunnel module starts before app fully ready), the dial fails with `ECONNREFUSED`. The injector destroys the yamux stream; the tunnel server propagates 502 to the public client. Avoiding the race entirely:

```typescript
app.ready().then(() => {
  app.server.once('listening', () => {
    const port = (app.server.address() as AddressInfo).port;
    loopback.setLocalPort(port);
    tunnelClient.start(jwt);
  });
});
```

## 4. Admin REST API

All endpoints under `/api/admin/tunnel/*`, gated by `requireAdmin`. Zod schemas in `schemas/admin-tunnel.schemas.ts`; auto-published into the OpenAPI snapshot like the rest of the platform's routes.

### 4.1 Endpoints

```
GET    /api/admin/tunnel/status
       → 200 TunnelStatus

POST   /api/admin/tunnel/token
       { token: <JWT string> }
       → 200 TunnelStatus
       → 400 if token fails local sanity check

DELETE /api/admin/tunnel/token
       → 204

GET    /api/admin/tunnel/stats?window=24h|7d|30d
       → 200 {
           window, requests, bytes_in, bytes_out,
           daily: [ { date, requests, bytes_in, bytes_out }, ... ],
           since
         }

POST   /api/admin/tunnel/reconnect
       → 202
```

### 4.2 Zod schemas

```typescript
export const tunnelStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('idle'),       message: z.string() }),
  z.object({ state: z.literal('connecting') }),
  z.object({
    state: z.literal('open'),
    subdomain: z.string(),
    sessionId: z.string(),
    connectedAt: z.number().int(),
    tokenExpiresAt: z.number().int(),
  }),
  z.object({
    state: z.literal('backoff'),
    nextAttemptAt: z.number().int(),
    lastError: z.string(),
  }),
  z.object({
    state: z.literal('fatal'),
    reason: z.enum(['invalid-jwt','revoked-jwt','subscription-inactive','duplicate-instance','unknown']),
    message: z.string(),
  }),
  z.object({ state: z.literal('closing') }),
]);

export const setTokenSchema = z.object({
  token: z.string().regex(/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
});

export const statsQuerySchema = z.object({
  window: z.enum(['24h','7d','30d']).default('24h'),
});

export const tunnelStatsSchema = z.object({
  window: z.enum(['24h','7d','30d']),
  requests: z.number().int().nonnegative(),
  bytes_in: z.number().int().nonnegative(),
  bytes_out: z.number().int().nonnegative(),
  daily: z.array(z.object({
    date: z.string(),
    requests: z.number().int().nonnegative(),
    bytes_in: z.number().int().nonnegative(),
    bytes_out: z.number().int().nonnegative(),
  })),
  since: z.number().int(),
});
```

### 4.3 Local sanity checks on `POST /token`

Before saving, we do cheap fail-fast checks. We don't verify the signature (only the tunnel server's public key can):

- Three base64url segments separated by dots.
- Header: `alg === 'EdDSA'`, `typ === 'JWT'`, `kid` present.
- Payload: required fields (`iss`, `sub`, `subdomain`, `plan`, `iat`, `exp`, `jti`).
- `iss === 'https://kryton.ai'`.
- `exp > now()`.
- `subdomain` matches `[a-z0-9-]{3,30}`.

Failures return 400 with a specific error code (`jwt_expired`, `jwt_malformed`, `jwt_wrong_issuer`, etc.) so the UI can show actionable messages.

After save, `TunnelClient.restart()` runs. The *real* signature check happens at handshake — any rejection there surfaces back into `GET /status` within seconds.

### 4.4 Stats data source

Two sources, both pre-aggregated by `tunnel-stats.service.ts`:

1. **In-memory rolling counters** on the current `TunnelSession` — live "this connection so far" totals. Reset on disconnect.
2. **Persistent daily aggregates** in `tunnel_traffic_daily` — UPSERTed every 60 s from the in-memory counter to the current day's row. Survives restarts.

The `/stats` endpoint reads both:
- `24h` window: intersection of last-24h daily rows + today's running counter.
- `7d` / `30d`: daily-row reads.

**Why we don't call back to WP / the tunnel server for stats:** the tunnel-server-side aggregates exist for the customer-facing kryton.ai dashboard. The Kryton admin tab has its own counter that doesn't depend on round-tripping through the central infrastructure. The two should match closely; each side is authoritative on its own.

### 4.5 Audit log

Every state-mutating endpoint writes to Kryton's existing audit-log infrastructure (same as `adminUsersRoutes`'s suspension actions). Action codes:

| Action | When |
|---|---|
| `tunnel.token.set` | `POST /token` succeeds |
| `tunnel.token.clear` | `DELETE /token` |
| `tunnel.reconnect` | `POST /reconnect` |
| `tunnel.connected` | client state → `open` |
| `tunnel.disconnected` | client state → `backoff` or `fatal` (reason in details) |

The token value itself is never logged. Only the `jti` (also stored separately in `settings.tunnel.jti`).

### 4.6 Error responses

| Code | Meaning |
|---|---|
| 200 | OK |
| 202 | Reconnect accepted; state will change async |
| 204 | No content (DELETE token) |
| 400 | Token failed local sanity check |
| 401 | Caller not authenticated |
| 403 | Caller not admin |
| 409 | Set-token while a different fatal state is mid-resolve (rare; retry idempotent) |
| 500 | Internal error; tunnel state inconsistent |

## 5. TunnelTab UI

Lives at `packages/client/src/pages/TunnelTab.tsx`. Uses `Section`/`Field` primitives from `settings-kit`, button styles from `settings-kit-styles`, lucide icons, fetches via the project's `api` helper. No new design tokens.

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Tunnel                                                      │
│                                                             │
│ Section: Status                                             │
│  ● Connected as xyz.my.kryton.ai                            │
│    Session: 7f9c…  ·  Connected for 3h 42m                  │
│    Token expires in 87 days                                 │
│                                                             │
│ Section: Tunnel token                                       │
│  Paste the token from your kryton.ai dashboard.             │
│  eyJhbGc...XYZ   (truncated)                                │
│  [ Replace token ] [ Clear token ]                          │
│  ↳ Manage subscription on kryton.ai ↗                       │
│                                                             │
│ Section: Traffic                                            │
│  Window: [ 24h ▼ ]                                          │
│  Requests: 1,234   In: 12.5 MB   Out: 8.2 MB                │
│  [sparkline of daily totals]                                │
│                                                             │
│ Section: Setup help                                         │
│  Your Kryton is now reachable at xyz.my.kryton.ai. Public   │
│  traffic is routed through our tunnel server; your own auth │
│  (login, API keys, 2FA) governs who can access your data.   │
│  [Link: How tunneling works ↗]                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Status variants

| state | UI |
|---|---|
| `idle` | Gray dot. "No token configured." `[ Paste token ]` opens modal. |
| `connecting` | Yellow dot. "Connecting to tunnel server…" + spinner. |
| `open` | Green dot. "Connected as `<subdomain>.my.kryton.ai`" + session id + uptime + token-expiry countdown. |
| `backoff` | Orange dot. "Reconnecting… next attempt in N s." Shows `lastError`. |
| `fatal:invalid-jwt` | Red. "Your token is invalid. Paste a fresh one." |
| `fatal:revoked-jwt` | Red. "Your token has been revoked. Get a new one from your kryton.ai dashboard." |
| `fatal:subscription-inactive` | Red. "Your subscription is no longer active." Buttons `[ Manage subscription ↗ ]` `[ Paste new token ]`. |
| `fatal:duplicate-instance` | Red. "Another Kryton is already connected with this token." Buttons `[ Rotate token ↗ ]` `[ Try again ]` `[ Paste new token ]`. |
| `closing` | Gray dot. "Disconnecting…" |

All fatal variants offer `[ Try again ]` → `POST /api/admin/tunnel/reconnect`.

### 5.3 Token paste modal

Native `<dialog>` matching the existing admin modal style. Single textarea (monospace, 4 lines tall), Cancel + Save buttons. Client-side mirror of the server's sanity checks; inline error under the textarea; Save disabled until checks pass.

On submit → `POST /api/admin/tunnel/token` → on 200, close modal, immediately poll status. On 400, surface the server's error message.

### 5.4 Token display

Once saved, never re-shown in full. Status shows `eyJhbGc…<last 6 chars>` plus dates parsed at paste time (cached in Settings).

`[ Replace token ]` reopens the paste modal.
`[ Clear token ]` shows a confirm dialog ("Disconnect tunnel? Your Kryton will no longer be reachable at `<subdomain>.my.kryton.ai`.") then `DELETE /api/admin/tunnel/token`.

### 5.5 Stats section

Window pill group `24h` / `7d` / `30d`. Window change → `GET /api/admin/tunnel/stats?window=X`.

Sparkline is the pure-CSS pattern used elsewhere in the codebase: row of `<div>` bars with computed heights based on the `daily` array. No chart library.

Auto-refresh every 30 s while the tab is visible. Pause when the tab is hidden.

### 5.6 Polling

```typescript
useEffect(() => {
  if (tab !== 'tunnel') return;
  let cancelled = false;
  const tick = async () => {
    if (cancelled) return;
    try {
      const status = await api.get<TunnelStatus>('/admin/tunnel/status');
      if (!cancelled) setStatus(status);
    } catch (err) {
      if (!cancelled) setError(serializeErr(err));
    }
  };
  tick();
  const interval = setInterval(tick, status?.state === 'open' ? 5_000 : 2_000);
  return () => { cancelled = true; clearInterval(interval); };
}, [tab, status?.state]);
```

Faster polling (2 s) during transient states (`connecting` / `backoff`) for snappy UX; 5 s when steady-state `open`; no polling when the tab is hidden.

### 5.7 Loading and error states

- Initial load: skeleton lines matching `settings-kit` skeleton style.
- Kryton API down: "Couldn't reach the server." Reload button.
- Non-admin user somehow opens the tab: 403 → "Admin only," redirect home.

### 5.8 Accessibility

- Status badges use dot + colour + text label + tooltip.
- `<dialog>` modal with native focus trap.
- All buttons have visible `:focus-visible` rings.
- Status wrapped in `<div aria-live="polite">` so screen readers announce changes during polling.
- All inputs have `<label>`.
- WCAG AA contrast in both light and dark themes.

### 5.9 Strings

English only, hardcoded inline. No i18n wrapping (matches existing admin tabs).

## 6. Testing

### 6.1 Unit — server (`vitest`)

- **`tunnel-client.service.ts`** — fake h2 server (node:http2.createServer), assert handshake header construction, state-machine transitions (`idle → connecting → open → backoff → connecting → open`), fatal-state pinning, reconnect backoff with fake clock, GoAway handling, h2 PING timeout triggering close.
- **`loopback-injector.service.ts`** — pair a `Duplex` (mock yamux stream) with a fake loopback TCP server, assert bidirectional bytes flow, error propagation, both ends destroy on either-side close, ECONNREFUSED handled gracefully.
- **`tunnel-state.service.ts`** — persistence round-trips through Settings repo, state transitions emit correct events, `last_connected_at` / `last_error` timestamps update.
- **`tunnel-stats.service.ts`** — counter increments, periodic flush UPSERTs to `tunnel_traffic_daily`, day rollover at midnight UTC, `getStats(window)` math for 24h/7d/30d.
- **JWT local sanity check** — accept valid token; reject each structural failure (bad alg, missing claim, expired, wrong issuer, malformed subdomain).

### 6.2 Unit — client (`vitest` + `@testing-library/react`)

- **`TunnelTab.tsx`** — render each state variant (idle/connecting/open/backoff/all fatal sub-states/closing); status badge text + colour matches; correct buttons present per state.
- **Paste-token modal** — input validation triggers per-field errors; Save disabled until checks pass; submit calls `api.post`; 400 surfaces server message.
- **Stats section** — window switch triggers refetch; sparkline renders with mock daily array.
- **Polling effect** — interval set/cleared on tab visibility; respects state-based cadence.

`api` helper stubbed via `vi.spyOn`; no real network.

### 6.3 Integration — server (`vitest` + Postgres testcontainer)

- **End-to-end loopback** — start a real Fastify with a tiny `/ping` route + the tunnel module + a fake tunnel-server (`node:http2` server that accepts CONNECT and runs yamux). Open a yamux stream from the fake server pointing at `/ping`; assert the response comes back with status 200 and the body Fastify produced.
- **WebSocket through tunnel** — same setup, test route uses `@fastify/websocket` for echo. Send 10 frames, get 10 echoes back.
- **Token rotation** — admin POSTs new token while a session is open; assert prior session closes within 5 s, new session opens.
- **Revocation from tunnel-server side** — fake tunnel-server sends GoAway with `revoked-jwt` reason; assert state → `fatal`, no reconnect attempts within 30 s.
- **Reconnect** — fake tunnel server disconnects; assert backoff (1 s, 2 s, 4 s…) and successful reconnect.

### 6.4 End-to-end — multi-component

Real end-to-end (Kryton + tunnel-server-go + WP) exists in 4b's `test/e2e` kind-cluster harness. The 4c work adds Kryton as the *thing being tested against* — we add a "Kryton-shaped" docker target to that harness rather than building a duplicate harness here. Cross-referenced in the plan.

### 6.5 Manual smoke (pre-release)

1. Fresh Kryton install, no token → admin tab shows "idle".
2. Paste valid token (issued from staging kryton.ai) → status flips to `open` within 5 s.
3. Browse to `<subdomain>.my.kryton.ai` in an unrelated browser → Kryton's login page appears.
4. Log in via the public URL → end-to-end auth works through the tunnel.
5. Open a Yjs-collab note from public URL on two browsers → real-time sync works.
6. MCP endpoint via public URL → AI agent can read/write.
7. Restart Kryton container → tunnel reconnects within 30 s.
8. Rotate token from kryton.ai dashboard → Kryton flips to `fatal:revoked-jwt`; paste new token → resumes.
9. Cancel subscription on kryton.ai → Kryton flips to `fatal:subscription-inactive` within 30 s.

## 7. Open items deferred to plan

- yamux library choice: spike-test `@chainsafe/libp2p-yamux` vs `@libp2p/yamux` vs in-repo impl for hashicorp/yamux wire compatibility.
- Existing `trustProxy` config detection in `app.ts` and additive merge strategy.
- Exact placement of audit-log integration (depends on whether Kryton has a generic audit hook or one per module).
- Whether `tunnel_traffic_daily` should be cluster-aware if Kryton ever runs multi-pod (deferred; single-pod is the only supported topology today).

## 8. Out of scope (v1)

- i18n / translations (English only).
- Encrypted-at-rest JWT storage (Postgres-level encryption can be applied later at infra layer).
- Connection pooling for loopback (fresh dial per request is fast enough).
- Multi-pod Kryton with shared tunnel state.
- Per-tenant rate-limit configuration from this UI.
- Custom domains (`notes.mycompany.com`) — central infra concern, not this module.
- Multiple tunnels per Kryton (one tunnel per server, matching "1 server = 1 subdomain").
