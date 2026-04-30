# API Keys & AI Agent Access

Kryton supports programmatic access via API keys and a built-in MCP (Model Context Protocol) server. This allows AI agents like Claude Code, Cursor, and custom scripts to read and write your notes.

## Creating an API Key

1. Open Kryton in your browser and log in
2. Click your avatar (top-right) and select **Account Settings**
3. Go to the **API Keys** tab
4. Click **Create API Key**
5. Fill in:
   - **Name** — a label to identify this key (e.g. "Claude Code", "Backup Script")
   - **Scope** — `Read Only` (can only read notes) or `Read Write` (can read, create, update, delete)
   - **Expires** — 30 days, 90 days, 1 year, or Never
6. Click **Create Key**
7. **Copy the key immediately** — it is shown only once and cannot be retrieved later

The key looks like: `kryton_a1b2c3d4e5f6...` (70 characters total).

## Revoking an API Key

In Account Settings > API Keys, click the trash icon next to any key and confirm. The key is immediately invalidated.

## Scopes

| Scope | Can do |
|-------|--------|
| `read-only` | List notes, read content, search, view tags/graph/backlinks, list folders/templates |
| `read-write` | Everything above, plus create/update/delete notes, create folders, manage shares |

Admin operations (user management, invites, settings) are never accessible via API keys.

---

## Using the REST API

All API endpoints accept bearer token authentication:

```bash
curl -H "Authorization: Bearer kryton_your_key_here" \
  https://your-kryton-instance/api/notes
```

### Key Endpoints

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/api/notes` | read-only | List all notes |
| `GET` | `/api/notes/:path` | read-only | Read a note |
| `POST` | `/api/notes` | read-write | Create a note |
| `PUT` | `/api/notes/:path` | read-write | Update a note |
| `DELETE` | `/api/notes/:path` | read-write | Delete a note |
| `GET` | `/api/search?q=query` | read-only | Full-text search |
| `GET` | `/api/tags` | read-only | List all tags |
| `GET` | `/api/backlinks/:path` | read-only | Get backlinks for a note |
| `GET` | `/api/graph` | read-only | Get the link graph |
| `GET` | `/api/folders` | read-only | List folder structure |
| `POST` | `/api/folders` | read-write | Create a folder |
| `GET` | `/api/daily` | read-only | Get today's daily note |
| `GET` | `/api/templates` | read-only | List templates |

Full OpenAPI documentation is available at `/api/docs` on your Kryton instance.

### Examples

**List all notes:**
```bash
curl -H "Authorization: Bearer kryton_..." https://localhost:3001/api/notes
```

**Create a note:**
```bash
curl -X POST \
  -H "Authorization: Bearer kryton_..." \
  -H "Content-Type: application/json" \
  -d '{"path": "ideas/new-idea.md", "content": "# New Idea\n\nThis is my note."}' \
  https://localhost:3001/api/notes
```

**Search notes:**
```bash
curl -H "Authorization: Bearer kryton_..." \
  "https://localhost:3001/api/search?q=kubernetes"
```

---

## Connecting AI Agents via MCP

Kryton includes a built-in [MCP server](https://modelcontextprotocol.io/) at `/api/mcp` using the Streamable HTTP transport. This allows MCP-compatible AI agents to interact with your notes directly.

### Claude Code / Claude Desktop

Add to your MCP configuration (`~/.claude/claude_desktop_config.json` or Claude Code settings):

```json
{
  "mcpServers": {
    "kryton": {
      "type": "streamable-http",
      "url": "https://your-kryton-instance/api/mcp",
      "headers": {
        "Authorization": "Bearer kryton_your_key_here"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "kryton": {
      "type": "streamable-http",
      "url": "https://your-kryton-instance/api/mcp",
      "headers": {
        "Authorization": "Bearer kryton_your_key_here"
      }
    }
  }
}
```

### Available MCP Tools

Once connected, the AI agent has access to these tools:

| Tool | Description |
|------|-------------|
| `list_notes` | List all notes (paths and titles) |
| `read_note` | Read a note's markdown content |
| `create_note` | Create a new note |
| `update_note` | Update a note (full content replacement) |
| `delete_note` | Delete a note |
| `search` | Full-text search across notes |
| `list_tags` | List all tags with counts |
| `get_backlinks` | Get notes linking to a given path |
| `get_graph` | Get the full link graph |
| `list_folders` | List folder structure |
| `create_folder` | Create a folder |
| `get_daily_note` | Get today's daily note |
| `list_templates` | List available templates |
| `create_note_from_template` | Create a note from a template |

Write tools (`create_note`, `update_note`, `delete_note`, `create_folder`, `create_note_from_template`) require a `read-write` scoped API key.

### MCP Resources

| URI | Description |
|-----|-------------|
| `kryton://notes` | The full note tree structure (JSON) |

### Plugin Tools

Plugins that register routes with OpenAPI (`@swagger`) annotations are automatically discovered and exposed as additional MCP tools. No extra configuration needed -- install a plugin and its API becomes available to your AI agent.

---

## Rate Limits

| Auth Method | Limit | Keyed By |
|-------------|-------|----------|
| Session (browser) | 100 requests / 15 min | IP address |
| API Key (bearer) | 300 requests / 15 min | API key ID |

Each API key has its own independent rate limit bucket.

---

## Security Notes

- API keys are stored as SHA-256 hashes -- the raw key is never persisted
- Keys use 256-bit entropy (`kryton_` prefix + 64 hex characters)
- The `kryton_` prefix enables secret scanning tools (like GitHub's) to detect leaked keys
- API keys cannot access admin endpoints or manage other API keys
- Revoking a user account immediately invalidates all their API keys
- The MCP server operates in stateless mode (no server-side session state)
