---
title: Yjs WebSocket
description: The collaborative-editing WebSocket protocol — endpoint, authentication, framing, and compatibility expectations.
---

Kryton's real-time collaboration runs on [Yjs](https://yjs.dev/). The server exposes one WebSocket endpoint per document and speaks the standard `y-protocols` framing — anything that talks `y-websocket` on the client side will round-trip.

## Endpoint

```
wss://kryton.example.com/ws/yjs/:docId
```

`:docId` is the URL-encoded note path (typically `userId/path/to/note.md`). The host resolves it to the user's note storage and instantiates a `Y.Doc` keyed by that path, sharing it across every connection on the same `:docId`.

There's a sibling endpoint at `wss://kryton.example.com/ws/vault` that streams per-user awareness events (live tree updates, presence pills, AI agent indicators). It uses the same auth model but is not a `y-websocket` peer — treat it as Kryton-specific until further notice.

## Authentication

Either of:

### 1. Session cookie (browser)

The browser's session cookie (`kryton.session`, set on first login) is presented automatically on the upgrade handshake. The server validates it, looks up the user, and confirms read access (or read-write if the connection issues edits) before completing the handshake.

If the cookie is missing or stale, the server responds with `401 Unauthorized` on the HTTP-101 upgrade leg and the WebSocket never opens.

### 2. Bearer token via query param (programmatic)

```
wss://kryton.example.com/ws/yjs/<docId>?token=kryton_a1b2c3...
```

The token is a standard API key (see [API keys and MCP](/kryton/advanced/security/api-keys-and-mcp/)). It needs `read-only` scope to receive document state and `read-write` scope to emit edits. The server rejects writes from `read-only` keys with a Yjs custom-message-event payload (`error: { code: "forbidden", reason: "read-only key" }`) and closes the socket.

Use a query param rather than a header because the WebSocket API in browsers doesn't allow setting arbitrary upgrade headers. Server-side clients (Node, Go, Python, …) can set `Authorization: Bearer …` directly — the server accepts either.

## Protocol

Standard Yjs sync protocol — see the [`y-protocols` spec](https://github.com/yjs/y-protocols). On open:

1. **Client → server**: `sync-step-1` with the client's state vector.
2. **Server → client**: `sync-step-2` with the diff from the server's state.
3. **Server → client**: `sync-step-1` with its own state vector.
4. **Client → server**: `sync-step-2` with whatever the server is missing.

After sync, both ends emit `update` messages whenever the local doc changes. The server fans updates out to every other peer on the same `:docId` and persists them to the markdown file on disk after a debounce (default ~500 ms — enough to batch a burst of keystrokes without lagging the save).

Awareness frames (cursor positions, selections, presence pings) ride the same socket as `awareness` messages. They're never persisted; they're broadcast and dropped.

## Message size limit

64 KiB per frame. The server closes the socket with code `1009 (Message Too Big)` if a peer sends more. Yjs's natural update size is in the tens of bytes per keystroke — you only hit this limit if you're trying to splice an entire MB-sized blob into the doc in one update. Don't do that; use the attachment API.

## Reconnection

Clients should reconnect with exponential backoff on close. Kryton's official client uses `y-websocket`'s built-in reconnect (1 s → 2 s → 4 s → … capped at 30 s with ±20% jitter). Sessions and tokens stay valid across reconnects; the doc state is re-sent on every fresh connection so missed updates self-heal.

## Versioning

The server speaks the Yjs sync protocol version current as of `yjs@13.x` (the version embedded in the server's `package.json`). The protocol has been stable for years and is forward-compatible — older clients connect to newer servers and vice versa as long as both sides ship a 13.x-compatible `y-protocols`.

If Kryton ever needs to break this, the change will land on a new endpoint (e.g. `/ws/yjs2/`) and the old one will remain for a deprecation cycle.

## Rate limiting

Connections-per-IP are rate-limited at the proxy / ingress layer, not by the Kryton server (the server assumes the proxy already did its job). Per-user connection caps live in the server: a single user can hold up to 8 concurrent connections per doc before the server starts closing the oldest. This is a guard against runaway tabs, not a hard quota — most users sit at 1–2.

## Debugging

Enable verbose Yjs logging:

```bash
# Server
LOG_LEVEL=debug
```

```js
// Client (browser console)
localStorage.setItem('y-websocket-debug', '*')
```

The server logs every upgrade attempt with the resolved user id, doc id, scope, and (if applicable) the rejection reason. Failed handshakes are the most common collaboration bug — start there.

## See also

- [Reverse proxy and TLS](/kryton/advanced/security/reverse-proxy-and-tls/) — proxy must honour the WebSocket upgrade.
- [API keys and MCP](/kryton/advanced/security/api-keys-and-mcp/) — bearer token model.
- [REST API](/kryton/advanced/api/rest/) — the non-real-time companion.
