# Spec: WebSocket control transport (ALB-compatible)

Status: APPROVED — implement. Date: 2026-06-12.

## Motivation

The tunnel control connection currently uses **HTTP/2 `CONNECT`** (agent opens an h2
`CONNECT`, server hijacks the bidirectional stream and runs a `yamux` session over it).
AWS **ALB does not proxy the `CONNECT` method**, so on AWS the agent's TLS+ALPN(h2) succeeds
but the `CONNECT` fails. We are migrating off DigitalOcean (nginx ssl-passthrough, which did
allow it) to AWS behind an ALB.

ALB fully supports **WebSockets** (HTTP/1.1 `Upgrade`, long-lived, bidirectional). We own
both the server (Go, `kryton-tunnel-server`) and the agent (TS, `kryton` →
`packages/server/src/modules/tunnel`), so we switch the control transport to WebSocket and
keep everything else (yamux, JWT auth, registry, public path) unchanged.

## The new handshake

Agent → `GET wss://tunnel.kryton.ai/control` with an HTTP/1.1 WebSocket `Upgrade` and headers:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <ed25519 jwt>` (unchanged) |
| `x-kryton-instance-id` | instance UUID (unchanged, required) |
| `x-kryton-version` | reported version (unchanged, optional) |

Server performs the **same checks as today, before completing the upgrade**:
JWT verify → revocation → plan (suspended/canceled/purged) → duplicate-instance. On failure
it responds to the WS handshake with the existing HTTP status + `x-reason` header and does
**not** upgrade (the agent reads status + `x-reason` exactly as it reads them from the
CONNECT response today). On success it completes the upgrade (HTTP 101) with response header
`x-tunnel-session-id: <uuid>`, then runs `yamux.Server` over the WebSocket.

Subprotocol: none required. Messages are **binary**; the WebSocket carries the raw yamux
byte stream (server wraps the conn as a `net.Conn`; agent wraps as a duplex).

## Server changes (`kryton-tunnel-server`, Go)

`internal/tunnel/listener.go`:
- Replace the `CONNECT`-method handler with a WebSocket upgrade handler (lib:
  `github.com/coder/websocket`). Keep the auth/plan/instance/registry logic **verbatim**;
  only the transport framing changes.
- Reject path: write status + `x-reason` header and return without upgrading (use the
  upgrade's pre-accept response, or `http.Error` semantics).
- Success path: `c.Accept(...)` with `ResponseHeader{ "x-tunnel-session-id": sessionID }`,
  then `netConn := websocket.NetConn(ctx, c, websocket.MessageBinary)` and
  `yamux.Server(netConn, cfg.YamuxConfig)` — the existing registry/duplicate logic is
  unchanged.
- The control listener becomes a **plain HTTP/1.1** server (no h2c, no in-pod TLS): it sits
  behind the ALB which terminates TLS and forwards HTTP/1.1. Drop the `h2c`/`http2`/TLS
  wiring on the control path. Route on path `/control` (and accept `/` for compat).
- **Back-compat:** keep the old `CONNECT` handler working in parallel for one release so the
  server can be deployed before the agent. Remove it once all agents are on WS.

## Agent changes (`kryton`, TS — `packages/server/src/modules/tunnel`)

- Add `wire/ws-connect.ts` (lib: `ws`) replacing `wire/h2-connect.ts`'s role: open
  `wss://<serverUrl host>/control` with the three headers; on `unexpected-response` read
  `statusCode` + `x-reason` and throw `TunnelHandshakeError` with the mapped reason; on
  `upgrade`/`open` read `x-tunnel-session-id` and hand the socket (as a duplex) to
  `YamuxSession`.
- `services/tunnel-client.service.ts`: swap the `h2connectTunnel` call + the `open` state's
  `h2`/`stream` fields for the WS equivalents. State machine, backoff, and the
  `FATAL_X_REASONS` mapping are unchanged.
- `wire/yamux.ts` is unchanged (it already runs over a duplex byte stream).

## Infra changes (`kryton-infra`)

- Tunnel **control** target group: `protocol_version = "HTTP1"` (was HTTP2); the ALB passes
  the WebSocket `Upgrade` through. Health check `/healthz`-style still on a 200-ish path.
- The existing ALB HTTPS host rule `tunnel.kryton.ai` → control TG is unchanged.
- **Remove** the abandoned NLB/`kryton/tunnel-tls` plan — not needed; ALB terminates TLS
  with the ACM cert. (`kryton/tunnel-tls` secret can be deleted.)

## Cutover (forward-only; only `watteel` connected)

1. Server: deploy WS-capable image (still accepts CONNECT too). 2. Agent: deploy WS client
to `watteel-kryton`. 3. Agent reconnects over WS through the ALB → control connection
accepted → `watteel.my.kryton.ai` serves. 4. Later: drop the CONNECT path from the server.

## Acceptance

- `watteel` agent reaches `state: open` against AWS; `control connection accepted` in the
  tunnel logs; `https://watteel.my.kryton.ai/` serves the live Kryton (not the offline page).
