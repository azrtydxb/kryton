---
title: API keys and MCP
description: The full API-key model — minting, scopes, rate limits, secret-scanning prefix, revocation, and the MCP endpoint.
---

Kryton supports programmatic access via API keys and a built-in MCP (Model Context Protocol) server. AI agents like Claude Code, Cursor, and custom scripts read and write your notes through this surface.

## Minting a key

1. Log in to Kryton in your browser.
2. Click your avatar (top-right) → **Account Settings**.
3. Go to the **API Keys** tab.
4. Click **Create API Key**.
5. Fill in:
   - **Name** — a label (e.g. "Claude Code", "Backup script").
   - **Scope** — `read-only` or `read-write`.
   - **Expires** — 30 days, 90 days, 1 year, or never.
6. Click **Create Key**.
7. **Copy the key immediately** — it's shown once and cannot be retrieved later.

The key format is `kryton_a1b2c3d4e5f6...` (70 characters: the `kryton_` prefix plus 64 hex characters of 256-bit entropy).

## Scopes

| Scope | Capabilities |
|---|---|
| `read-only` | List notes, read content, search, view tags / graph / backlinks, list folders / templates / favorites. |
| `read-write` | Everything above, plus create / update / delete notes, create folders, manage shares, mint / revoke favorites, restore from trash, empty trash. |

Admin operations (user management, invites, registration settings, plugin install) are **never** accessible via API keys. They require a session and the `admin` role.

Write tools — `create_note`, `update_note`, `append_to_note`, `rename_note`, `delete_note`, `create_folder`, `create_note_from_template`, `write_daily_note`, `add_favorite`, `remove_favorite`, `restore_from_trash`, `empty_trash`, `rename_folder`, `delete_folder`, `share_note`, `unshare_note` — require a `read-write` scoped key.

## Per-user isolation

An API key inherits the permissions of the user that minted it. Notes outside the user's tree are invisible, even with the right path; shared notes appear with the same shape they do in the UI. Keys cannot escalate privilege.

If the user is disabled or deleted, every key they own is invalidated atomically.

## Rate limits

| Auth method | Limit | Keyed by |
|---|---|---|
| Session (browser) | 100 requests / 15 min | IP address |
| API key (bearer) | 300 requests / 15 min | API key id |

Each API key has its own independent bucket. Hitting the limit returns `429 Too Many Requests` with a `Retry-After` header.

The Helm chart's `env.config.RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW` tune the global window (the per-key 300 figure is on top of this, by key id).

## Storage and secret scanning

- Keys are stored as **SHA-256 hashes**. The raw secret is never persisted.
- The `kryton_` prefix lets secret scanners (GitHub, GitLab, custom CI) detect leaks. If you accidentally commit a key, GitHub will notify Kryton's owner via the [secret scanning partner program](https://docs.github.com/en/code-security/secret-scanning) once registered.
- The minted secret is shown once at creation. Lose it and you have to mint a new one.

## Revoking a key

In **Account Settings → API Keys**, click the trash icon next to any row and confirm. The key is invalidated immediately — the next request bearing it gets `401 Unauthorized`.

Programmatic revocation:

```bash
curl -X DELETE \
  -H "Authorization: Bearer kryton_owner_session_or_key" \
  https://kryton.example.com/api/api-keys/<key-id>
```

Only the user that owns the key (or an admin via session) can revoke it.

## Using the REST API

```bash
curl -H "Authorization: Bearer kryton_..." \
  https://kryton.example.com/api/notes
```

| Method | Path | Scope |
|---|---|---|
| `GET` | `/api/notes` | read-only |
| `GET` | `/api/notes/:path` | read-only |
| `POST` | `/api/notes` | read-write |
| `PUT` | `/api/notes/:path` | read-write |
| `DELETE` | `/api/notes/:path` | read-write |
| `GET` | `/api/search?q=…` | read-only |
| `GET` | `/api/tags` | read-only |
| `GET` | `/api/backlinks/:path` | read-only |
| `GET` | `/api/graph` | read-only |
| `GET` | `/api/folders` | read-only |
| `POST` | `/api/folders` | read-write |
| `GET` | `/api/daily` | read-only |
| `GET` | `/api/templates` | read-only |

Full OpenAPI reference: [REST API](/kryton/advanced/api/rest/).

## MCP — Model Context Protocol

Kryton ships a built-in MCP server at `/api/mcp` using the [Streamable HTTP transport](https://modelcontextprotocol.io/docs/concepts/transports). Compatible AI agents drop straight in.

### Claude Code / Claude Desktop / Cursor / Codex

```json
{
  "mcpServers": {
    "kryton": {
      "type": "streamable-http",
      "url": "https://kryton.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer kryton_your_key_here"
      }
    }
  }
}
```

For stdio-only hosts (Claude Desktop, Cline, Continue), the `@azrtydxb/kryton-mcp` shim bridges stdio to the HTTP endpoint:

```json
{
  "mcpServers": {
    "kryton": {
      "command": "npx",
      "args": ["-y", "@azrtydxb/kryton-mcp"],
      "env": {
        "KRYTON_URL": "https://kryton.example.com",
        "KRYTON_TOKEN": "kryton_your_key_here"
      }
    }
  }
}
```

One command does all of this for every supported host automatically:

```sh
npx @azrtydxb/kryton-init
```

See the [CLI](/kryton/advanced/reference/cli/) for the full installer reference.

### Available MCP tools

The full list lives at [MCP tools](/kryton/advanced/api/mcp-tools/) (auto-generated). 33+ tools cover note CRUD, search, tags, the link graph, folders, templates, favorites, trash, and shares. Plugin-registered routes with OpenAPI annotations are exposed automatically — install a plugin, get extra MCP tools for free.

### MCP resources

| URI | Description |
|---|---|
| `kryton://notes` | The full note tree structure (JSON). |

### Statelessness

The MCP server operates in stateless mode (no server-side session state). The bearer token is the only context the server keeps about an agent connection. This is by design — restart-safe, horizontally-scalable, no resume protocol.

## Auditing

The admin panel exposes a "Recent activity" view that lists every API-key-authenticated request: timestamp, key id, route, status code. Use it to confirm an agent is doing what it says it's doing, or to spot a misbehaving script.

## See also

- [REST API](/kryton/advanced/api/rest/) — generated reference for every endpoint.
- [MCP tools](/kryton/advanced/api/mcp-tools/) — every MCP tool with parameters.
- [CLI](/kryton/advanced/reference/cli/) — `@azrtydxb/kryton-init` one-shot installer.
