# API Keys, OpenAPI & MCP Server — Design Spec

**Date:** 2026-03-25
**Status:** Draft
**Scope:** API key management, bearer auth, OpenAPI improvements, built-in MCP server, Account Settings page

## Overview

Enable AI agents to interact with Kryton's API by adding:
1. API key creation and revocation via a new Account Settings page
2. Bearer token authentication alongside existing session-based auth
3. Complete OpenAPI documentation with security schemes
4. A built-in MCP server for Claude Code / Cursor-style agents

## 1. Data Model

### New `ApiKey` Prisma model

```prisma
model ApiKey {
  id          String    @id @default(uuid())
  userId      String
  name        String
  keyHash     String    @unique
  keyPrefix   String
  scope       String    @default("read-only")
  expiresAt   DateTime?
  lastUsedAt  DateTime?
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([keyHash])
}
```

Add `apiKeys ApiKey[]` relation to the `User` model.

**Fields:**
- `name` — user-chosen label (e.g. "Claude Code", "My Script")
- `keyHash` — SHA-256 hash of the full API key (the raw key is never stored)
- `keyPrefix` — `kryton_` + first 8 hex chars, displayed in the UI for identification
- `scope` — `"read-only"` or `"read-write"`
- `expiresAt` — optional; null means never expires
- `lastUsedAt` — updated on each authenticated request for usage tracking

**Key format:** `kryton_<64 random hex chars>` (total length: 70 chars). Generated server-side using `crypto.randomBytes(32).toString('hex')` (256 bits of entropy). The full key is returned exactly once at creation time.

**No update endpoint.** To change scope or expiration, revoke and create a new key.

## 2. Authentication Middleware

### Bearer token support

Extend `authMiddleware` in `packages/server/src/middleware/auth.ts`:

```
Request arrives
  → Has "Authorization: Bearer kryton_..." header?
    → YES: SHA-256 hash the token, look up ApiKey by keyHash (DB WHERE clause)
      → Found:
        → Check expiresAt (if set and in the past → 401)
        → Fetch User via ApiKey.userId relation, check user.disabled → 403 if disabled
        → Populate req.user = { id, email, name, role }
        → Attach req.apiKey = { id, scope }
        → Update lastUsedAt (fire-and-forget, don't block the request)
      → Not found → 401
    → NO: fall through to existing session check (unchanged)
```

**Timing safety note:** The keyHash lookup is performed via a database query (`WHERE keyHash = ?`), which is not vulnerable to timing attacks. Do NOT add an additional in-memory comparison of the hash. If one is ever needed, use `crypto.timingSafeEqual`.

### New types on Request

```typescript
declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string; name: string; role: string };
    apiKey?: { id: string; scope: string };
  }
}
```

### Scope enforcement

New helper `requireScope(req, scope: 'read-only' | 'read-write')`:
- If `req.apiKey` is set and `req.apiKey.scope` doesn't meet the required level → 403 "Insufficient API key scope"
- If `req.apiKey` is not set (session auth) → always passes (sessions have full access)
- `read-write` satisfies both `read-only` and `read-write` requirements

Applied to mutating route handlers (POST/PUT/DELETE on notes, folders, canvas, templates, shares, etc.). Read-only endpoints (GET) require only `read-only` scope.

### Session-only guard

New helper `requireSession(req)`:
- If `req.apiKey` is set → 403 "This endpoint requires browser session authentication"
- Used on: `/api/api-keys/*`, `/api/admin/*`, auth management endpoints

### Rate limiting

Separate rate limiter for API key requests:
- 300 requests per 15-minute window (vs 100 for session-based)
- Keyed by API key ID (not IP), so different keys get independent limits
- **Rationale:** MCP tools and AI agents make many small, rapid requests per interaction (e.g. listing notes, reading several, searching). The higher limit accommodates this automated usage pattern while still capping abuse. The per-key-ID keying ensures one key can't exhaust another's budget.

## 3. API Key Management Routes

New router at `/api/api-keys`, guarded by `authMiddleware` + `requireSession`.

### `POST /api/api-keys` — Create API key

**Request body (Zod-validated):**
```json
{
  "name": "Claude Code",
  "scope": "read-only",
  "expiresAt": "2026-06-25T00:00:00Z"
}
```

**Validation:**
- `name`: string, 1-100 chars, trimmed
- `scope`: enum `"read-only" | "read-write"`
- `expiresAt`: optional ISO 8601 datetime, must be in the future

**Response (201):**
```json
{
  "id": "uuid",
  "name": "Claude Code",
  "key": "kryton_a1b2c3d4e5f6...",
  "keyPrefix": "kryton_a1b2c3d4",
  "scope": "read-only",
  "expiresAt": "2026-06-25T00:00:00.000Z",
  "createdAt": "2026-03-25T12:00:00.000Z"
}
```

The `key` field is returned **only in this response**. It is never stored or retrievable again.

**Limit:** Maximum 10 active API keys per user. Returns 400 if exceeded.

### `GET /api/api-keys` — List API keys

**Response (200):**
```json
[
  {
    "id": "uuid",
    "name": "Claude Code",
    "keyPrefix": "kryton_a1b2c3d4",
    "scope": "read-only",
    "expiresAt": "2026-06-25T00:00:00.000Z",
    "lastUsedAt": "2026-03-25T10:30:00.000Z",
    "createdAt": "2026-03-25T12:00:00.000Z"
  }
]
```

### `DELETE /api/api-keys/:id` — Revoke API key

- Verifies the key belongs to `req.user.id` before deleting
- Returns 204 on success, 404 if not found or not owned
- Hard delete (no soft delete / audit trail — acceptable for v1; can add `revokedAt` later if incident investigation needs arise)

## 4. OpenAPI Improvements

### Add `securitySchemes` to `swagger.ts`

```javascript
components: {
  securitySchemes: {
    cookieAuth: {
      type: 'apiKey',
      in: 'cookie',
      name: 'better-auth.session_token',
    },
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      description: 'API key with kryton_ prefix',
    },
  },
},
security: [
  { cookieAuth: [] },
  { bearerAuth: [] },
],
```

**Session-only override:** Endpoints that require browser sessions (`/api/api-keys/*`, `/api/admin/*`) must specify `security: [{ cookieAuth: [] }]` at the operation level to override the global security and exclude `bearerAuth`.

### Complete route annotations

Add `@swagger` JSDoc annotations to all routes currently missing them:
- `search.ts` — `GET /search`
- `graph.ts` — `GET /graph`
- `backlinks.ts` — `GET /backlinks/:path`
- `tags.ts` — `GET /tags`, `GET /tags/:tag/notes`
- `daily.ts` — `GET /daily`, `POST /daily`
- `templates.ts` — `GET /templates`, `GET /templates/:name`, `POST /templates`
- `canvas.ts` — all CRUD endpoints
- `folders.ts` — all CRUD endpoints
- `folders-rename.ts` — `POST /folders-rename`
- `notes-rename.ts` — `POST /notes-rename`
- `access-requests.ts` — all endpoints
- `api-keys.ts` — all new endpoints

Each annotation includes: summary, tags, parameters, request body schema, response schemas, and security requirements.

## 5. MCP Server

### Endpoint

`POST /api/mcp` and `GET /api/mcp` and `DELETE /api/mcp` — Streamable HTTP transport, served from the same Express server under the `/api` prefix (inherits the existing rate limiter and URL conventions).

- `POST /api/mcp` — primary transport: client sends JSON-RPC requests, server responds with SSE (Server-Sent Events) for streaming results
- `GET /api/mcp` — opens an SSE stream for server-initiated notifications (if needed)
- `DELETE /api/mcp` — terminates an MCP session

### Session management

**Stateless mode.** Each MCP request is independently authenticated via the bearer token. No server-side MCP session state is maintained. The `Mcp-Session-Id` header is not used. This keeps the implementation simple and horizontally scalable. If stateful features are needed later (e.g. subscriptions), session support can be added.

### Authentication

Same bearer token mechanism as the REST API. The MCP client sends `Authorization: Bearer kryton_...` in the HTTP headers. The MCP handler authenticates via the same API key lookup and populates a user context.

**CORS note:** MCP clients (Claude Code, Cursor) are not browsers, so CORS is irrelevant for them. The existing CORS config (allowing only `APP_URL`) is sufficient and correctly restrictive for any browser-based access attempts.

### Dependencies

`@modelcontextprotocol/sdk` — the official MCP TypeScript SDK.

### Architecture — Two-tier tool system

The MCP server exposes tools via two mechanisms:

**1. Core tools (static):** 14 hardcoded tools for the main knowledge base operations. These call the service layer / Prisma queries directly — no HTTP overhead. The tool handlers are thin adapters that validate input, call service functions, and return structured results.

**2. Dynamic tools (OpenAPI-discovered):** At request time, the MCP server reads the current `swaggerSpec` object and generates MCP tools for any OpenAPI path NOT already covered by a core tool. This means plugin routes that have `@swagger` annotations automatically become MCP tools.

Dynamic tool handlers make a local HTTP fetch (`http://localhost:${PORT}/api/...`) with the user's bearer token forwarded. This is the only viable approach for plugin routes since their service functions are unknown at compile time. Localhost-only, so latency is negligible.

**Tool naming for dynamic tools:** Derived from the OpenAPI `operationId` if present, otherwise from `method_path` (e.g. `POST /plugins/my-plugin/summarize` → `post_plugins_my_plugin_summarize`).

**Scope inference for dynamic tools:** If the HTTP method is GET → `read-only`. If POST/PUT/DELETE → `read-write`.

**Exclusions:** Dynamic discovery skips:
- Paths already covered by core tools
- `/auth/*` paths (not useful for agents)
- `/admin/*` paths (session-only)
- `/api-keys/*` paths (session-only)
- `/mcp` itself (recursive)
- `/docs*` and `/health` (meta endpoints)

### Core Tools

| Tool | Scope Required | Description |
|------|---------------|-------------|
| `list_notes` | read-only | List all notes (returns paths and titles) |
| `read_note` | read-only | Read a note's content by path |
| `create_note` | read-write | Create a new note with title and content |
| `update_note` | read-write | Update a note's content by path (full replacement) |
| `delete_note` | read-write | Delete a note by path |
| `search` | read-only | Full-text search across notes |
| `list_tags` | read-only | List all tags with counts |
| `get_backlinks` | read-only | Get notes that link to a given path |
| `get_graph` | read-only | Get the full link graph (nodes + edges) |
| `list_folders` | read-only | List folder structure |
| `create_folder` | read-write | Create a new folder |
| `get_daily_note` | read-only | Get or check today's daily note |
| `list_templates` | read-only | List available note templates |
| `create_note_from_template` | read-write | Create a note from a template |

**Note on `update_note`:** This performs a full content replacement, not a partial/append update. AI agents should read the note first, modify the content, then write it back.

### Dynamic Tools (Plugin-contributed)

Any plugin that registers routes with `@swagger` JSDoc annotations via the `PluginRouter` will automatically have those routes exposed as MCP tools. No plugin code changes needed — the standard OpenAPI annotation is sufficient.

Example: A "summarize" plugin that exposes `POST /api/plugins/summarize/run` with a `@swagger` annotation will appear as an MCP tool named `post_plugins_summarize_run` (or the `operationId` if set).

### Resources

| Resource URI | Description |
|-------------|-------------|
| `kryton://notes` | The full note tree structure (JSON) |

### Tool input/output schemas

Each tool defines its parameters using JSON Schema (via the MCP SDK's tool definition). Outputs are structured JSON matching the existing API response shapes. For example:

```typescript
// read_note tool
{
  name: "read_note",
  description: "Read a note's markdown content by its path",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Note path (e.g. 'folder/my-note.md')" }
    },
    required: ["path"]
  }
}
// Returns: { path, title, content, modifiedAt }
```

## 6. Account Settings Page (Frontend)

### New UI component

A full-screen modal (same pattern as `AdminPage`) managed by `showAccountSettings` state in `useUIStore`.

### Tabs

1. **Profile** — Change password form (moved from UserMenu inline modal)
2. **Passkeys** — Existing `PasskeyManager` component, adapted as a tab panel
3. **API Keys** — New `ApiKeyManager` component

### API Keys tab

**Key list:** Each row shows:
- Name (bold)
- Scope badge: "Read Only" (gray) or "Read Write" (violet)
- Prefix: `kryton_a1b2c3d4...` in monospace
- Last used: relative time ("2 hours ago") or "Never"
- Expires: date or "Never"
- Revoke button → confirm step (same pattern as PasskeyManager delete)

**Create flow:**
1. User clicks "Create API Key"
2. Inline form appears: name input, scope dropdown (read-only / read-write), expiration dropdown (30 days / 90 days / 1 year / Never)
3. On submit → POST to `/api/api-keys`
4. Success state: full key displayed in a highlighted box with copy-to-clipboard button
5. Warning text: "Copy this key now. It won't be shown again."
6. User dismisses → key disappears, list refreshes showing the new key with its prefix

### UserMenu changes

Replace "Change Password" and "Manage Passkeys" entries with a single:
- "Account Settings" (icon: `Settings` from lucide-react) → sets `showAccountSettings = true`

Admin Panel and Access Requests entries remain unchanged in the dropdown.

### Client API additions

New functions in `packages/client/src/lib/api.ts`:

```typescript
export const apiKeyApi = {
  list: (): Promise<ApiKeyInfo[]> => ...,
  create: (data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> => ...,
  revoke: (id: string): Promise<void> => ...,
};
```

## 7. Testing Strategy

- **API key CRUD:** Unit tests for create, list, revoke. Test key hash verification, expiration, ownership checks, 10-key limit.
- **Auth middleware:** Test bearer token path, expired key rejection, disabled user rejection, scope enforcement.
- **Scope enforcement:** Test that read-only keys can GET but not POST/PUT/DELETE on protected routes.
- **Session-only guard:** Test that API keys cannot access `/api/api-keys/*` or `/api/admin/*`.
- **MCP server:** Integration tests for tool calls with valid/invalid auth, scope enforcement, and correct response shapes.
- **Rate limiting:** Verify API key requests use separate limits keyed by key ID.

## 8. Migration Notes

- New Prisma migration for the `ApiKey` model
- No breaking changes to existing auth — session-based auth is untouched
- No data migration needed — this is purely additive

## 9. Security Considerations

- **Key storage:** Only SHA-256 hashes are stored; raw keys are never persisted
- **Key entropy:** 256 bits (32 random bytes), exceeding the industry standard minimum
- **Timing safety:** Auth lookup uses a DB WHERE clause, not in-memory comparison; no timing side-channel
- **Key display:** Full key shown exactly once at creation, never retrievable
- **Self-management prevention:** API keys cannot manage other API keys (session-only guard)
- **Admin isolation:** Admin routes remain session-only
- **Cascade delete:** Deleting a user cascades to all their API keys
- **Expiration:** Expired keys are rejected at auth time (not garbage-collected, but could add cleanup later)
- **Prefix identification:** `kryton_` prefix allows key scanning tools (like GitHub's secret scanning) to identify leaked keys
