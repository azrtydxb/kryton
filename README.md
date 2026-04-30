<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logos/kryton_banner_dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="logos/kryton_banner_dark.png" />
    <img src="logos/kryton_banner_dark.png" alt="Kryton" width="600" style="border-radius: 12px; background-color: #0d1117; padding: 20px;" />
  </picture>
</p>

<p align="center">
  <strong>A shared brain for people and AI. Self-hosted knowledge base with built-in MCP server, wiki-linking, graph visualization, and mobile sync.</strong>
</p>

<p align="center">
  <em>For everyone who wished Obsidian was a server app.</em>
</p>

<p align="center">
  <a href="https://github.com/azrtydxb/kryton/actions"><img src="https://github.com/azrtydxb/kryton/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/azrtydxb/kryton/releases"><img src="https://img.shields.io/github/v/release/azrtydxb/kryton" alt="Release"></a>
  <a href="https://github.com/azrtydxb/kryton/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
</p>

<p align="center">
  <img src="docs/screenshots/hero.png" alt="Kryton Screenshot" width="800" />
</p>

---

## Why Kryton?

Your notes shouldn't live in a silo. Kryton is a knowledge base that both humans and AI agents can read, write, and reason over — through the same API, the same notes, the same graph.

**For humans:** A full-featured note-taking app with wiki-links, graph view, markdown editor, mobile app, and multi-user sharing.

**For AI agents:** A built-in [MCP server](https://modelcontextprotocol.io) gives Claude Code, Cursor, Windsurf, and any MCP-compatible agent direct access to your knowledge base — search notes, read context, create documents, traverse the knowledge graph, and use templates. Your AI assistant becomes a collaborator that remembers everything you've written.

**Together:** Humans write notes, AI reads them for context. AI generates documentation, humans review and refine it. Both contribute to a shared, interconnected knowledge graph.

---

## Built-in MCP Server

Kryton ships with a production-ready MCP server at `/api/mcp`. No sidecar, no proxy, no extra setup — it's part of the app.

### What AI Agents Can Do

| Tool | Description |
|------|-------------|
| `list_notes` | Browse all notes with paths and titles |
| `read_note` | Read any note's markdown content |
| `create_note` | Create new notes |
| `update_note` | Edit existing notes |
| `delete_note` | Remove notes |
| `search` | Full-text search across the entire knowledge base |
| `get_backlinks` | Find all notes linking to a given note |
| `get_graph` | Traverse the full wiki-link graph (nodes + edges) |
| `list_tags` | Browse tags with counts |
| `list_folders` | Navigate folder structure |
| `get_daily_note` | Access today's daily note |
| `list_templates` / `create_note_from_template` | Use templates |
| + **Plugin tools** | Plugins that register API routes are automatically exposed as MCP tools |

### Connect Your AI Agent

**1. Create an API key** in Kryton: Account Settings > API Keys > Create (read-write scope)

**2. Configure your agent:**

<details>
<summary><strong>Claude Code / Claude Desktop</strong></summary>

Add to your MCP settings (`~/.claude.json` or project `.mcp.json`):

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
</details>

<details>
<summary><strong>Cursor / Windsurf / Any MCP Client</strong></summary>

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
</details>

**3. Start using it:** Ask your AI to "search my notes for...", "create a note about...", "what notes link to X?", or "read my project roadmap and suggest next steps."

### Security

- **Scoped API keys** — read-only or read-write, with optional expiration
- **Per-user isolation** — each key accesses only that user's notes
- **256-bit entropy** — keys use `kryton_` prefix for secret scanning detection
- **Rate limited** — 300 requests / 15 minutes per key
- **No admin access** — API keys cannot access admin functions

See [API Keys & MCP docs](docs/API-ACCESS.md) for the full reference.

---

## Features

### Editor & Notes
- **Markdown Editor** — CodeMirror 6 with syntax highlighting, formatting toolbar, and Vim mode
- **Live Preview** — rendered markdown with wiki-links, frontmatter display, and code fences
- **Auto-save** — 2-second debounce saves automatically while editing
- **Wiki-style Linking** — `[[double brackets]]` with autocomplete and broken link detection
- **Full-text Search** — instant results across all notes
- **Version History** — browse and restore previous versions of any note
- **Image Upload** — drag into editor or use toolbar button
- **Frontmatter** — YAML metadata parsing with styled display
- **Templates** and **Daily Notes** for quick creation
- **Trash** — soft delete with restore capability (auto-purge after 30 days)
- **PDF Export** for any note
- **Breadcrumb Navigation** — clickable path segments above notes

### Knowledge Graph
- **Interactive D3.js graph** with zoom, pan, and drag
- **Local/Full view** toggle
- **Color-coded nodes** — active (green), starred (yellow stars), shared (orange), default (purple)
- **Mobile graph overlay** — mini expandable graph on phone screens

<p align="center">
  <img src="docs/screenshots/graph-view.png" alt="Graph View" width="700" />
</p>

### Mobile App (React Native)
- **Offline-first** — expo-sqlite local database with bidirectional sync
- **Full feature parity** — notes, search, graph, tags, settings, daily notes, templates, trash, history, sharing, admin
- **WebView editor** — same CodeMirror experience on mobile
- **Android APK** available via EAS Build
- **Auto-sync** on foreground, pull-to-refresh, manual sync button
- **Version compatibility** — enforces major-version match with server

### Multi-User & Security
- **Authentication** — email/password, OAuth (Google, GitHub), passkeys (WebAuthn)
- **Two-Factor Authentication** — TOTP with QR code setup and backup codes
- **Per-user isolation** — each user has their own notes directory
- **Note Sharing** — share notes/folders with read or read-write permissions
- **Access Requests** — request access to notes via wiki-links
- **API Keys** — scoped bearer tokens for programmatic and AI agent access
- **Admin Panel** — manage users, invite codes, registration mode

### REST API
- **Swagger/OpenAPI docs** at `/api/docs` — interactive API explorer
- **30+ REST endpoints** — notes, search, graph, settings, sharing, auth, admin, sync
- **Sync v2 API** — `/api/sync/v2/pull` and `/api/sync/v2/push` (primary); legacy `/api/sync` deprecated
- **Version endpoint** — `GET /api/version` for compatibility checks

### UI & Layout
- **Three-panel layout** — sidebar, content, graph+outline (all resizable)
- **Dark/Light theme** with system preference detection
- **Favorites sidebar** — quick access to starred notes
- **Drag-and-drop file tree** — move files and folders by dragging
- **Toast notifications** — global info/success/error feedback
- **Responsive mobile layout** — optimized for phone screens
- **Full WCAG accessibility** — ARIA roles, keyboard navigation, focus management

<p align="center">
  <img src="docs/screenshots/editor.png" alt="Split Editor" width="700" />
</p>

### Plugin Ecosystem
12 plugins available via [kryton-plugins](https://github.com/azrtydxb/kryton-plugins):

Slash Commands, Pomodoro Timer, Reading List, Writing Metrics, Excalidraw, Kanban Board, Mass Upload, Publish/Export, Flashcards, Presentation Mode, Calendar Journal, RSS Reader

Plugin APIs are automatically exposed as MCP tools — install a plugin and your AI agent can use it immediately.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 19, Vite 8, TypeScript 5.9, Tailwind CSS 4 |
| Backend | Express 5, Prisma 7, TypeScript 5.9 |
| Database | SQLite (via better-sqlite3) |
| Mobile | Expo SDK 55, React Native, expo-sqlite |
| Editor | CodeMirror 6 with Vim mode |
| Graph | D3.js force-directed |
| Auth | better-auth (sessions, OAuth, passkeys, 2FA) |
| AI Integration | MCP SDK (Model Context Protocol) |
| Runtime | Node.js 24 |

---

## Quick Start

### Docker (recommended)

```yaml
# docker-compose.yml
services:
  kryton:
    image: ghcr.io/azrtydxb/kryton/kryton:latest
    ports:
      - "3100:3000"
    volumes:
      - ./notes:/notes
      - kryton-data:/data
    environment:
      - DATABASE_URL=file:/data/kryton.db
      - BETTER_AUTH_SECRET=change-me-use-openssl-rand-hex-32
      - APP_URL=http://localhost:3100

volumes:
  kryton-data:
```

```bash
docker compose up -d
```

Open http://localhost:3100 — the first user to register becomes admin.

### From Source

```bash
git clone https://github.com/azrtydxb/kryton.git
cd kryton
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- API Docs: http://localhost:5173/api/docs

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite path: `file:/data/kryton.db` |
| `BETTER_AUTH_SECRET` | Yes | Auth secret (min 32 chars). Generate: `openssl rand -hex 32` |
| `APP_URL` | No | Public URL (default: `http://localhost:5173`) |
| `PORT` | No | Server port (default: `3001`) |
| `NOTES_DIR` | No | Notes directory path |
| `WEBAUTHN_RP_ID` | No | Passkey relying party ID (default: `localhost`) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth — auto-hidden if not set |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth secret |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth — auto-hidden if not set |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth secret |
| `SMTP_HOST` | No | SMTP server for password reset emails |
| `SMTP_PORT` | No | SMTP port (default: `587`) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `SMTP_FROM` | No | From address for emails |

---

## Mobile App

The React Native mobile app lives in its own repository: **[azrtydxb/kryton-mobile](https://github.com/azrtydxb/kryton-mobile)**. It consumes `@azrtydxb/core` and `@azrtydxb/core-react` (see [Consumer Libraries](#consumer-libraries) below) and syncs with the server via the Sync v2 API.

### Install on Android

Download the latest APK from [EAS Build](https://expo.dev/accounts/piwi3910/projects/kryton/builds).

---

## Sync v2 Architecture

Kryton v4.4 ships a redesigned synchronisation layer that supports offline-first clients (mobile, and future desktop) with reliable conflict detection.

### Cursor-based delta sync

Every tier 1 entity (folders, tags, notes, settings, graph edges, shares, trash items, installed plugins) carries two extra columns: a `version` integer and an `updatedCursor` bigint. The server maintains a single monotonically-increasing global cursor. On every write, the cursor is incremented and stamped onto each modified row in the same transaction.

Clients store the last-seen cursor value. A `POST /api/sync/v2/pull` request returns only rows with `updatedCursor > clientCursor` — a deterministic, clock-skew-immune delta. Push requests include the client's `base_version` per row; if the server's version for that row is higher, a conflict response is returned instead of a silent overwrite.

### Yjs for note content

Note bodies are stored and synced as [Yjs](https://yjs.dev) CRDT documents rather than plain text columns. Concurrent edits from multiple devices or collaborators merge automatically with no data loss. The server exposes a WebSocket endpoint (`/ws/yjs/:docId`) for live collaboration; offline clients queue pending Yjs updates locally and flush them on reconnect. Everything that is not note body content (relational metadata) continues to use LWW delta sync.

### Cedar for agent identity

AI agents are first-class database entities with short-lived tokens and optional [Cedar](https://www.cedarpolicy.com) policy documents. The server evaluates the Cedar policy on every agent request — `(principal, action, resource)` — before executing the handler. Agents default to deny-all; permissions are granted explicitly per note, folder, or tag. Agent actions are attributed to `Agent::<id>` in audit logs, distinct from the owning user's actions.

### Endpoint summary

| Method | Path | Status |
|--------|------|--------|
| `POST` | `/api/sync/v2/pull` | **Primary** |
| `POST` | `/api/sync/v2/push` | **Primary** |
| `GET` | `/api/sync/v2/tier2/:entityType/:parentId` | **Primary** |
| `WS` | `/ws/yjs/:docId` | **Primary** |
| `POST` | `/api/sync/pull` | Deprecated — kept for legacy clients |
| `POST` | `/api/sync/push` | Deprecated — kept for legacy clients |

See `docs/superpowers/specs/2026-04-30-server-sync-v2-design.md` for the full endpoint reference and wire format.

---

## Consumer Libraries

Two npm packages are published from this monorepo to [GitHub Packages](https://github.com/features/packages) under the `@azrtydxb` scope:

| Package | Description |
|---------|-------------|
| `@azrtydxb/core` | Platform-agnostic offline-first data layer. Local SQLite + Sync v2 + Yjs. Adapters for `expo-sqlite` and `better-sqlite3`. |
| `@azrtydxb/core-react` | React hooks wrapping `@azrtydxb/core`. Typed hooks per entity type: `useNotes`, `useFolders`, `useTags`, `useNoteShares`, etc. |

These packages are consumed by `kryton-mobile` today and by a future desktop sub-project. The Kryton web client (`packages/client`) does not consume them — it stays online-only against the server's REST API.

To install in a consumer project, add to `.npmrc`:

```
@azrtydxb:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

A GitHub Personal Access Token with `read:packages` scope is required. See `docs/superpowers/specs/2026-04-30-core-publishing-design.md` and [ADR-006](docs/superpowers/adrs/ADR-006-pat-publish-token.md) for details.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+E` | Toggle edit mode |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+P` | Quick switcher |
| `Ctrl+N` | New note |
| `Ctrl+K` | Focus search |
| `Ctrl+Shift+S` | Toggle star |
| `F2` | Rename note |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React 19 + Vite 8 + Tailwind CSS 4)               │
│  ┌─────────┬──────────────┬────────────┐                     │
│  │ Sidebar │  Preview/    │ Graph +    │                     │
│  │ (files, │  Editor      │ Outline    │                     │
│  │  tags,  │  (CodeMirror │ (D3.js)    │                     │
│  │  trash, │   + Vim)     │            │                     │
│  │  favs)  │              │            │                     │
│  └─────────┴──────────────┴────────────┘                     │
└──────────────────────┬───────────────────────────────────────┘
                       │ REST API + Sync API
┌──────────────────────┴───────────────────────────────────────┐
│  Express 5 Server                                             │
│  ├── Auth (better-auth + OAuth + passkeys + 2FA)              │
│  ├── Notes, Search, Graph, Tags, Trash, History               │
│  ├── Sharing & Access Requests                                │
│  ├── Sync v2 (cursor + Yjs for mobile/desktop)                │
│  ├── MCP Server (AI agent access — 14 tools + plugin tools)   │
│  ├── Plugin system (server + client)                          │
│  └── Swagger API Docs                                         │
├─────────────────┬────────────────────────────────────────────┤
│  SQLite         │  File System                                │
│  (search index, │  notes/{userId}/                            │
│   graph edges,  │  ├── Welcome.md                             │
│   settings,     │  ├── .trash/                                │
│   users, shares,│  ├── .history/                              │
│   sync tracking)│  └── attachments/                           │
└─────────────────┴────────────────────────────────────────────┘
         ▲                           ▲
         │ Sync v2 API + WS/Yjs      │ MCP Protocol (streamable HTTP)
┌────────┴────────────────┐  ┌───────┴──────────────────────────┐
│  React Native Mobile    │  │  AI Agents                        │
│  azrtydxb/kryton-mobile │  │  ├── Claude Code / Claude Desktop │
│  ├── @azrtydxb/core     │  │  ├── Cursor / Windsurf            │
│  ├── @azrtydxb/core-    │  │  ├── Custom MCP clients           │
│  │   react hooks        │  │  └── Any MCP-compatible tool      │
│  └── Expo SDK 55        │  └──────────────────────────────────┘
└─────────────────────────┘
```

---

## Database Migrations

Kryton uses Prisma Migrate for safe schema updates. Migrations run automatically on container startup with automatic backup.

For developers:
```bash
# After changing prisma/schema.prisma:
DATABASE_URL="file:./data/kryton.db" npx prisma migrate dev --name describe_change
```

See [MIGRATIONS.md](packages/server/MIGRATIONS.md) for details.

---

## Development

```bash
npm install          # Install dependencies
npm run dev          # Start dev servers (frontend :5173, backend :3001)
npm run typecheck    # Type check
npm run lint         # Lint
npm run build        # Build for production
npm test             # Run all tests
```

---

## Documentation

- [API Keys & MCP](docs/API-ACCESS.md) — API key setup, MCP configuration, full tool reference
- [Plugin Development](docs/PLUGINS.md) — plugin API reference
- [Migrations](packages/server/MIGRATIONS.md) — database migration guide
- [Architecture Decision Records](docs/superpowers/adrs/) — ADR-001 through ADR-006 covering scope, sync, Yjs, Cedar, schema gen, and publishing tokens

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

