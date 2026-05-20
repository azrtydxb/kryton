---
title: Yjs WebSocket
description: The collaborative-editing WebSocket — endpoint, authentication, and framing.
---

Kryton's collaborative editor uses [Yjs](https://yjs.dev) over a single
WebSocket route. The handler lives in
`packages/server/src/modules/collab/ws/yjs.handler.ts` and is mounted on
the main Fastify instance — no separate WS server.

## Endpoint

```
GET /ws/yjs/:docId
```

`:docId` is the note path within the connecting user's notes directory
(e.g. `folder/note.md`). The handler refuses to open a doc you can't
read — `authorizeDoc` runs `app.notes.readNote(docId, userId)` on every
connect, so deleted or unauthorised paths immediately close with
code 1008.

## Authentication

Two paths, both resolved in the route's `preValidation` hook:

1. **`Sec-WebSocket-Protocol` bearer** — clients advertise the marker
   `kryton-token` followed by the token as the next subprotocol entry.
   The token is validated by `app.agents.service.validateToken`, so
   currently this path is used by agent integrations:

   ```
   Sec-WebSocket-Protocol: kryton-token, <agent-token>
   ```

   Query-string tokens are deliberately not accepted (see
   `packages/server/src/lib/ws-auth.ts`).

2. **Cookie session** — the standard better-auth session cookie.
   Useful for the in-browser client.

If neither resolves, the handshake returns `401`.

## Per-doc lifecycle

- The Y.Doc is constructed on first connection. If a snapshot exists in
  Postgres it's restored; otherwise the doc is seeded from the canonical
  `.md` file (`Y.Text("content")`).
- Updates from any client are appended to the per-doc update log,
  broadcast to all other connected clients, and scheduled for a
  debounced flush. Debounce is **2 s idle, 30 s max**
  (`DEBOUNCE_IDLE_MS` / `DEBOUNCE_MAX_MS`).
- On flush, the canonical `.md` file is rewritten first, then a Y.Doc
  snapshot is saved. Disk is the source of truth.
- The doc is evicted from memory 60 s after the last client disconnects
  (`EVICT_GRACE_MS`).

## Protocol

Standard Yjs framing — varint message type prefix, then payload.

| Type | Constant | Payload |
|------|----------|---------|
| `0`  | `MSG_SYNC` | `y-protocols/sync` step 1/2/update |
| `1`  | `MSG_AWARENESS` | `y-protocols/awareness` encoded update |

The server sends `writeSyncStep1` immediately after the client connects,
plus the current awareness snapshot if any. Subsequent edits and
awareness changes are relayed to peers.

The wire format matches the
[`y-websocket`](https://github.com/yjs/y-websocket) reference server, so
any Yjs client targeting that protocol can connect — point it at
`ws[s]://<host>/ws/yjs/<path>` with auth attached as above.

## Agent presence

When the server applies an agent-routed edit (`applyServerEdit`), it
publishes a synthetic awareness entry on a stable per-agent client id so
human collaborators see an "AI is editing" indicator. The entry clears
4 s (`AGENT_PRESENCE_TTL_MS`) after the last edit.

## Close codes used by the server

| Code | Reason          | When                          |
|------|-----------------|-------------------------------|
| 1008 | `unauthenticated` | no valid session or token |
| 1008 | `forbidden`     | docId outside user's vault    |
| 1011 | `internal`      | unhandled error in onConnection |
