---
title: API keys and MCP
description: How Kryton API keys work — minting, scopes, hashing — and how MCP clients authenticate over Streamable HTTP.
---

Kryton exposes a single API-key model used by every programmatic caller:
shell scripts hitting the REST API, MCP clients like Claude Desktop, and
agent integrations. Keys are minted from the web UI, never recoverable
after creation, and scoped read-only or read-write.

## The key itself

Implemented in
`packages/server/src/modules/identity/services/api-key.service.ts`.

- Prefix: `kryton_` (constant `KEY_PREFIX`).
- Entropy: 32 random bytes = 256 bits, hex-encoded — so a full key looks
  like `kryton_` + 64 hex chars = 71 characters total.
- Storage: only the SHA-256 hash is persisted in the `apiKey.keyHash`
  column. The plaintext is returned exactly once at creation and never
  again.
- A short prefix (`kryton_` + first 8 hex chars) is stored separately
  in `apiKey.keyPrefix` so the UI can show "ends in …" without holding
  the secret.
- Per-user cap: 10 keys (`MAX_KEYS_PER_USER`).
- Optional `expiresAt` — keys past their expiry are rejected during
  validation.
- Optional `agentId` — when bound, edits made by this key are attributed
  to that agent in vault events and Yjs presence.

## Minting and revocation

Routes are mounted under `/api/api-keys` in
`packages/server/src/modules/identity/routes/api-keys.routes.ts`. **All
three endpoints require a browser session** (the `requireSession` guard
rejects calls authenticated with another API key):

| Method | Path                | Purpose                       |
|--------|---------------------|-------------------------------|
| POST   | `/api/api-keys`     | Create a key — returns the plaintext once |
| GET    | `/api/api-keys`     | List the caller's keys (no secrets) |
| DELETE | `/api/api-keys/:id` | Revoke a key by id            |

In the UI: **Account Settings → API Keys**.

## Scopes

The `scope` enum is `read-only` or `read-write`
(`identity/schemas/api-key.schemas.ts`).

- `read-only` keys can call any REST endpoint that doesn't require
  session auth and that hasn't been marked write-scope.
- `read-write` keys additionally pass the `requireWriteScope` guard,
  which is enforced inside MCP tools (`build-server.ts`) and on every
  REST mutation.

Admin-only endpoints (user management, settings, invites) require a
browser session and **are not reachable via API key** —
`requireSession` rejects API-key bearers outright
(`packages/server/src/plugins/auth.ts`).

## Validation and `lastUsedAt`

`ApiKeyService.validate` hashes the incoming key, looks up the row,
rejects expired keys, and fires a non-awaited `lastUsedAt` update. The
field is visible in the UI key list and in `GET /api/api-keys`.

Kryton does not record an audit trail of individual API-key requests —
`lastUsedAt` is the only built-in visibility into key activity.

## Rate limiting

Global rate limit applies to every request including API-key calls.
Defaults from `config/env.ts`:

- `RATE_LIMIT_MAX` — `1000` requests
- `RATE_LIMIT_WINDOW` — `1 minute`

Wired in `packages/server/src/plugins/rate-limit.ts`. The identity routes
(login, signup, password reset) apply a stricter `10 / minute` preset.

## MCP endpoint

Mounted at `/api/mcp` in
`packages/server/src/modules/agents/index.ts` — Streamable HTTP and SSE
share the prefix.

- Transport: **Streamable HTTP** per the 2025-03-26 spec
  (`mcp/streamable.ts`). The legacy SSE transport (`GET /sse`,
  `POST /messages`) is also mounted under `/api/mcp` for older clients.
- Auth: `Authorization: Bearer kryton_…` — see
  `mcp/auth.ts → authenticateMcpRequest`. Sessions, OAuth, and the
  Better Auth catch-all are not accepted here.
- Sessions are **per-bearer** and stateful. Each `initialize` call mints
  an `Mcp-Session-Id`; the per-user cap is 10 concurrent sessions
  (`MAX_SESSIONS_PER_USER`) and the idle reaper closes anything quiet
  for 30 minutes (`IDLE_TIMEOUT_MS`).
- Sessions survive server restarts: every session is persisted to the
  `McpSession` table and rehydrated transparently when the bearer
  reconnects with the same `Mcp-Session-Id`.

### Example: connecting Claude Desktop

```json
{
  "mcpServers": {
    "kryton": {
      "url": "https://your-kryton-host/api/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer kryton_..."
      }
    }
  }
}
```

The set of MCP tools exposed includes the core tools defined in
`mcp/tools.ts` plus a dynamic tool generated for every OpenAPI operation
not already covered by a core tool. Tools tagged `read-write` refuse to
run when the bound key is `read-only`. See
[MCP tools](/kryton/advanced/api/mcp-tools/) for the full list.

## Operational notes

- Treat the `kryton_` prefix as a secret-scanning marker — push it into
  your scanner's allow-list so leaked keys get flagged.
- Revocation is immediate: `DELETE /api/api-keys/:id` removes the row;
  the next `validate()` call returns null.
- Lost a key? You can't recover it — revoke the row and mint a new one.
