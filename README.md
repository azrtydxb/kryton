<p align="center">
  <img src="logos/mnemo_logo_transparent.png" alt="Mnemo" width="400" />
</p>

<p align="center">
  <strong>A self-hosted, multi-user knowledge base with wiki-style linking and graph visualization.</strong>
</p>

<p align="center">
  <a href="https://github.com/piwi3910/mnemo/actions"><img src="https://github.com/piwi3910/mnemo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/piwi3910/mnemo/releases"><img src="https://img.shields.io/github/v/release/piwi3910/mnemo" alt="Release"></a>
  <a href="https://github.com/piwi3910/mnemo/blob/master/LICENSE"><img src="https://img.shields.io/github/license/piwi3910/mnemo" alt="License"></a>
</p>

---

## Features

### Editor & Notes
- **Markdown Editor** with CodeMirror 6, syntax highlighting, and formatting toolbar
- **Live Preview** with rendered markdown, wiki-links, and embeds
- **Vim Mode** with toggle switch — full Vim keybindings with command bar (`:search`, `:%s/replace`), starts in insert mode for beginners
- **Wiki-style Linking** — `[[double brackets]]` with autocomplete and broken link detection
- **Full-text Search** across all notes with instant results
- **Templates** and **Daily Notes** for quick note creation
- **PDF Export** for any note
- **Save/Cancel editing** — explicit save, no auto-save, with undo/redo buttons

### Knowledge Graph
- **Interactive D3.js graph** with zoom, pan, and drag
- **Local/Full view** toggle — see direct connections or the entire graph
- **Active note** centered (green), **starred notes** as yellow stars, **shared notes** as orange nodes
- **Crosshair button** to recenter the view

### Multi-User
- **Authentication** — email/password + OAuth (Google, GitHub)
- **Per-user file isolation** — each user has their own `notes/{userId}/` directory
- **Admin panel** — manage users, invite codes, registration mode (open/invite-only)
- **First user becomes admin** automatically

### Note Sharing
- **Share notes or folders** with specific users (read or read-write permissions)
- **Shared notes** appear in sidebar "Shared" section, search results (with share icon), and graph (orange nodes)
- **Access requests** — click an inaccessible link to request access, owners approve/deny
- **Graph link filtering** — only shows links to notes you have access to
- **Context menu sharing** — right-click any file/folder to share

### UI & Layout
- **Preview-first layout** — notes show in preview by default, click Edit for split editor+preview
- **Inline knowledge graph** panel (not a modal) with outline pane below
- **Resizable panels** — drag borders between sidebar, content, graph, and outline
- **Collapsible sidebar** with thin bar when closed
- **Dark/Light theme** with always-dark header
- **Custom Mnemo logo** and branding

### Security
- **JWT access tokens** (15min) + **SHA-256 hashed refresh tokens** (30 days) in httpOnly cookies
- **CSRF protection** via `X-Requested-With` header
- **Path traversal prevention** on all file routes
- **Password management** — change password, admin reset, forgot password via email (optional SMTP)

### API
- **Swagger/OpenAPI docs** at `/api/docs` — auto-generated from JSDoc annotations
- **25+ REST endpoints** covering notes, search, graph, settings, sharing, auth, admin

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 19, Vite 8, TypeScript 5.9, Tailwind CSS 4 |
| Backend | Express 5, TypeORM, TypeScript 5.9 |
| Database | PostgreSQL 16 |
| Editor | CodeMirror 6 with Vim mode |
| Graph | D3.js force-directed |
| Auth | JWT, bcrypt, OAuth (Google/GitHub) |
| Runtime | Node.js 24 |

---

## Quick Start

### Prerequisites

- Node.js 24+
- PostgreSQL 16+ (or Docker)

### 1. Clone and install

```bash
git clone https://github.com/piwi3910/mnemo.git
cd mnemo
npm install
```

### 2. Set up the database

```bash
# Using Docker (recommended)
docker compose up db -d

# Or use an existing PostgreSQL instance
# Create a database named "mnemo"
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your settings (see Configuration section below)
```

### 4. Start development servers

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- API Docs: http://localhost:5173/api/docs

### 5. Register

Open http://localhost:5173 — the first user to register becomes admin.

---

## Configuration

### Required

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/mnemo` |
| `JWT_SECRET` | Secret for signing JWTs (use a random 64-char string) | `dev-secret-change-me` |

### Optional: OAuth (Google)

To enable "Sign in with Google":

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `http://localhost:5173/api/auth/google/callback` (or your production URL)

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
APP_URL=http://localhost:5173
```

### Optional: OAuth (GitHub)

To enable "Sign in with GitHub":

1. Go to [GitHub Developer Settings](https://github.com/settings/developers) → New OAuth App
2. Set callback URL: `http://localhost:5173/api/auth/github/callback`

```env
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
APP_URL=http://localhost:5173
```

> **Note:** If OAuth credentials are not set, the OAuth buttons are automatically hidden from the login page.

### Optional: SMTP (Password Reset Emails)

To enable "Forgot Password" with email reset links:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="Mnemo <noreply@yourdomain.com>"
```

> **Note:** If SMTP is not configured, the "Forgot password?" link shows "Contact your admin" instead. Admins can always reset passwords from the Admin Panel.

For Gmail: use an [App Password](https://support.google.com/accounts/answer/185833), not your regular password.

---

## Docker Deployment

### Docker Compose (recommended)

```yaml
services:
  mnemo:
    image: ghcr.io/piwi3910/mnemo/mnemo:latest
    ports:
      - "3100:3000"
    volumes:
      - ./notes:/notes
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/mnemo
      - NOTES_DIR=/notes
      - JWT_SECRET=change-me-to-a-random-64-char-string
      - APP_URL=http://localhost:3100
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=mnemo
      - POSTGRES_PASSWORD=postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d mnemo"]
      interval: 2s
      timeout: 5s
      retries: 10
    restart: unless-stopped

volumes:
  pgdata:
```

```bash
docker compose up -d
```

Access at http://localhost:3100

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
| `Ctrl+Z` | Undo (in editor) |
| `Ctrl+Shift+Z` | Redo (in editor) |
| `Escape` | Exit insert mode (Vim) |

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Browser (React 19 + Vite 8 + Tailwind CSS 4)             │
│  ┌─────────┬──────────────┬────────────┐                   │
│  │ Sidebar │  Preview/    │ Graph +    │                   │
│  │ (files, │  Editor      │ Outline    │                   │
│  │  tags,  │  (CodeMirror │ (D3.js)    │                   │
│  │  shared)│   + Vim)     │            │                   │
│  └─────────┴──────────────┴────────────┘                   │
└──────────────────────┬─────────────────────────────────────┘
                       │ REST API
┌──────────────────────┴─────────────────────────────────────┐
│  Express 5 Server (TypeScript)                              │
│  ├── Auth (JWT + OAuth + CSRF)                              │
│  ├── Notes, Folders, Search, Graph, Tags                    │
│  ├── Sharing & Access Requests                              │
│  ├── Admin (users, invites, settings)                       │
│  └── Swagger API Docs                                       │
├─────────────────┬──────────────────────────────────────────┤
│  PostgreSQL 16  │  File System                              │
│  (search index, │  notes/{userId}/                          │
│   graph edges,  │  ├── Welcome.md                           │
│   settings,     │  ├── Projects/                            │
│   users, shares)│  └── Daily/                               │
└─────────────────┴──────────────────────────────────────────┘
```

---

## Development

```bash
# Install dependencies
npm install

# Start dev servers (frontend :5173, backend :3001)
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Build for production
npm run build
```

---

## License

MIT
