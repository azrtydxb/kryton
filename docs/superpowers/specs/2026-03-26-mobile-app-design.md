# Mnemo Mobile App — Design Spec

## Overview

A React Native mobile app for Mnemo that provides full feature parity with the web app. Uses WatermelonDB for offline-first local storage with bidirectional sync to the Mnemo server. Lives in the monorepo at `packages/mobile`.

## Tech Stack

- Expo SDK 53 (managed workflow)
- Expo Router (file-based navigation)
- WatermelonDB (offline-first SQLite + sync)
- React Native WebView (CodeMirror editor + graph)
- `expo-secure-store` (encrypted token storage)
- `react-native-toast-message` (notifications)

## Project Structure

```
packages/mobile/
├── app/                        # Expo Router file-based routing
│   ├── (auth)/                 # Auth screens (login, register, 2fa)
│   ├── (app)/                  # Main app screens (behind auth)
│   │   ├── (tabs)/             # Bottom tab navigator
│   │   │   ├── notes.tsx       # Note list + file tree + favorites
│   │   │   ├── search.tsx      # Full-text search
│   │   │   ├── graph.tsx       # Graph view (D3 in WebView)
│   │   │   ├── tags.tsx        # Tag browser
│   │   │   └── settings.tsx    # Settings + account + admin
│   │   ├── note/[path].tsx     # Note view/edit (WebView CodeMirror)
│   │   ├── daily.tsx           # Daily notes
│   │   ├── templates.tsx       # Template picker
│   │   ├── trash.tsx           # Trash management
│   │   ├── history/[path].tsx  # Version history
│   │   └── sharing.tsx         # Shares + access requests
│   └── _layout.tsx             # Root layout with auth guard
├── src/
│   ├── db/
│   │   ├── schema.ts           # WatermelonDB schema definition
│   │   ├── models/             # WatermelonDB model classes
│   │   │   ├── Note.ts
│   │   │   ├── Folder.ts
│   │   │   ├── Setting.ts
│   │   │   ├── Tag.ts
│   │   │   ├── GraphEdge.ts
│   │   │   ├── NoteShare.ts
│   │   │   └── TrashItem.ts
│   │   └── sync.ts             # Sync adapter (pull/push)
│   ├── components/             # Shared UI components
│   │   ├── NoteList.tsx
│   │   ├── FileTree.tsx
│   │   ├── FavoritesSection.tsx
│   │   ├── TagBadge.tsx
│   │   ├── Breadcrumbs.tsx
│   │   ├── OfflineBanner.tsx
│   │   └── SyncStatus.tsx
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useSync.ts
│   │   ├── useNetworkStatus.ts
│   │   └── useServerUrl.ts
│   ├── lib/
│   │   ├── api.ts              # HTTP client for server
│   │   ├── theme.ts            # Colors, typography
│   │   └── utils.ts
│   └── webview/
│       ├── editor.html         # Bundled CodeMirror editor
│       ├── graph.html          # Bundled D3 graph
│       └── bridge.ts           # postMessage protocol
├── app.json
├── package.json
└── tsconfig.json
```

## WatermelonDB Models & Schema

### Synced models (server ↔ mobile)

| Model | Fields | Maps to server |
|-------|--------|---------------|
| `Note` | path, title, content, tags (JSON string), modified_at | Files on disk + SearchIndex |
| `Setting` | key, value | Settings table |
| `NoteShare` | owner_user_id, path, is_folder, permission, shared_with_user_id | NoteShare table |
| `TrashItem` | original_path, trashed_at | TrashItem Prisma model (new) |

### Computed locally from synced Note content (NOT synced as tables)

- **Folders** — derived from note paths (if `Projects/todo.md` exists, `Projects` folder exists)
- **Tags** — parsed from note content (`#hashtag`) and frontmatter `tags` field
- **Graph edges** — parsed from `[[wiki-links]]` in note content
- **Backlinks** — reverse lookup of graph edges
- **Search index** — built locally by indexing Note records in WatermelonDB

This avoids syncing GraphEdge (which has no timestamps and is delete-recreated on every save), Tags (computed/volatile), and Folders (implicit from paths).

### WatermelonDB column naming

All columns use snake_case in the schema (WatermelonDB convention). The sync JSON payloads use snake_case to match. Model classes expose camelCase getters.

### Note identity and renames

Notes use `path` as both the WatermelonDB `id` and the server identifier. Renaming a note is a **delete + create** in sync terms — the old path is deleted and the new path is created. The sync adapter handles this by including the old path in `deleted` and the new path in `created` within the same push.

### Sync protocol

WatermelonDB's `synchronize()` calls two server endpoints:

1. **PULL**: `POST /api/sync/pull { last_pulled_at }` — server returns all changes since timestamp
2. **PUSH**: `POST /api/sync/push { changes, last_pulled_at }` — server applies mobile changes

Changes are grouped by table with `created`, `updated`, and `deleted` arrays per WatermelonDB's required format.

### Conflict resolution

Last-write-wins by `modified_at` timestamp. Since this is single-user-per-device, conflicts are rare — they only occur if the same user edits the same note on web and mobile while both are offline.

**Partial push failure:** If a push fails mid-request (network drop), WatermelonDB retains all unpushed changes locally. On next sync, it retries the full push. The server must handle push idempotently — creating a note that already exists should upsert, not error.

### Attachment sync

Images/attachments are NOT synced via WatermelonDB. They require online connectivity:
- **Upload**: camera/gallery picker → `POST /api/files` → insert markdown image link
- **Download**: images in notes are loaded via server URL when online, cached locally
- **Offline**: previously viewed images are served from cache; new uploads are queued until online

## Server Sync Endpoints

### Schema migrations required

Add to `packages/server/prisma/schema.prisma`:

```prisma
model TrashItem {
  id           String   @id @default(uuid())
  originalPath String
  userId       String
  trashedAt    DateTime @default(now())

  @@index([userId, trashedAt])
}

model SyncDeletion {
  id        String   @id @default(uuid())
  tableName String
  recordId  String
  userId    String
  deletedAt DateTime @default(now())

  @@index([userId, deletedAt])
}
```

Add `updatedAt DateTime @updatedAt` to `NoteShare` (already has it) and `Settings` (needs adding).

### `POST /api/sync/pull`

Request:
```json
{ "last_pulled_at": 1711468800000 }
```

Response (only 4 synced tables — no graph_edges, tags, or folders):
```json
{
  "changes": {
    "notes": {
      "created": [{ "id": "Projects/todo.md", "path": "Projects/todo.md", "title": "Todo", "content": "# Todo\n...", "tags": "[\"project\"]", "modified_at": 1711468800000 }],
      "updated": [],
      "deleted": ["old-note.md"]
    },
    "settings": {
      "created": [{ "id": "theme:user1", "key": "theme", "value": "dark" }],
      "updated": [],
      "deleted": []
    },
    "note_shares": {
      "created": [],
      "updated": [],
      "deleted": []
    },
    "trash_items": {
      "created": [{ "id": "uuid", "original_path": "deleted-note.md", "trashed_at": 1711468800000 }],
      "updated": [],
      "deleted": []
    }
  },
  "timestamp": 1711472400000
}
```

Server implementation:
- Query SearchIndex for notes with `modifiedAt > lastPulledAt`; read file content from disk for each
- Query Settings with `updatedAt > lastPulledAt` (requires adding `updatedAt` column)
- Query NoteShare with `updatedAt > lastPulledAt`
- Query TrashItem with `trashedAt > lastPulledAt`
- Query SyncDeletion for deletions since `lastPulledAt`
- If `lastPulledAt` is null, return everything (full sync)

### `POST /api/sync/push`

Request:
```json
{
  "changes": {
    "notes": {
      "created": [{ "id": "new-note.md", "path": "new-note.md", "title": "New", "content": "# New\n..." }],
      "updated": [{ "id": "existing.md", "path": "existing.md", "title": "Updated", "content": "..." }],
      "deleted": ["removed.md"]
    },
    "settings": {
      "created": [],
      "updated": [{ "id": "theme:user1", "key": "theme", "value": "light" }],
      "deleted": []
    }
  },
  "last_pulled_at": 1711468800000
}
```

Response:
```json
{}
```

Server implementation:
- **Notes created/updated**: write file to disk, update SearchIndex, rebuild graph edges
- **Notes deleted**: move to `.trash/`, create TrashItem record, record in SyncDeletion
- **Settings**: upsert in Settings table
- All operations must be **idempotent** — creating a note that already exists should upsert

### Rate limiting

Sync endpoints (`/api/sync/*`) are exempt from the general 100req/15min rate limit. They have their own limit: 20 syncs per 15 minutes per user (each sync is 1 pull + 1 push = 2 requests).

### Route file

`packages/server/src/routes/sync.ts` — mounted at `/api/sync` with auth middleware.

## Authentication

React Native does not have a browser cookie jar, so the mobile app uses a **two-step auth flow**: login via better-auth to get a session, then create an API key for persistent mobile access.

### Login flow
1. First launch: "Enter your Mnemo server URL" (e.g., `https://mnemo.example.com`)
2. Server URL validated via `GET /api/health`
3. Email/password login form
4. If 2FA required: TOTP code input screen
5. On successful login, the app automatically creates an API key (`POST /api/api-keys`) with scope `read-write` and name `"Mobile App"`
6. The API key is stored in `expo-secure-store` (encrypted device keychain)
7. All subsequent API calls use `Authorization: Bearer mnemo_...` header
8. The session cookie from login is discarded — only the API key persists

### Why API keys over cookies
- React Native's `fetch` does not handle `Set-Cookie` reliably
- API keys survive server restarts and session expiry
- API keys have their own rate limit (300 req/15min vs 100 for sessions)
- `expo-secure-store` provides encrypted storage on both iOS and Android
- No need to handle cookie refresh logic

### OAuth (Google/GitHub)
- Open system browser via `WebBrowser.openAuthSessionAsync()`
- Callback URL: `mnemo://auth-callback`
- Server `trustedOrigins` must include `mnemo://`
- On callback: extract temporary session, create API key, discard session

### Token management
- API key stored in `expo-secure-store` with server URL
- On app launch: validate key with `GET /api/auth/get-session` using bearer auth
- If key is revoked: show login screen (pending offline changes are preserved locally)
- API key does not expire unless the user sets an expiration or revokes it

### Registration
- Name, email, password, optional invite code
- Same validation as web (8-char password minimum)
- After registration, same API key creation flow as login

### Server changes needed
- Add `mnemo://` to `trustedOrigins` in `auth.ts`
- The API key auth middleware already supports `Authorization: Bearer` headers — no changes needed

## UI & Navigation

### Bottom tabs (5)

| Tab | Icon | Content |
|-----|------|---------|
| Notes | `file-text` | Favorites section + expandable file tree + FAB for new note/daily |
| Search | `search` | Search input + results list from local WatermelonDB |
| Graph | `network` | D3 force-directed graph in WebView |
| Tags | `hash` | Tag list with counts, tap to see notes with that tag |
| Settings | `settings` | Account, sync status, theme, admin (if admin role) |

### Note screen (push from any tab)

- **Header**: back button, breadcrumbs, edit/preview toggle, overflow menu
- **Overflow menu**: star, share, history, trash, export PDF
- **Preview mode**: WebView rendering markdown (same styles as web)
- **Edit mode**: WebView with CodeMirror, postMessage bridge for content sync
- **Frontmatter**: rendered above content when present
- **Auto-save**: 2s debounce via WebView bridge, same as web

### WebView bridge protocol (editor)

Mobile → WebView:
- `{ type: "setContent", content: "..." }`
- `{ type: "setTheme", theme: "dark" | "light" }`
- `{ type: "setVimMode", enabled: true | false }`

WebView → Mobile:
- `{ type: "contentChanged", content: "..." }`
- `{ type: "cursorState", line: 1, col: 1, wordCount: 100 }`
- `{ type: "saveRequested" }`

### Design system

- **Background**: surface-950 `#0d1117`
- **Cards/surfaces**: surface-900 `#111827`
- **Primary accent**: violet-500 `#7c3aed`
- **Text primary**: `#e2e8f0`
- **Text secondary**: `#94a3b8`
- **Error**: red-500 `#ef4444`
- **Success**: green-500 `#22c55e`
- **Font**: system default (San Francisco on iOS, Roboto on Android)
- **Monospace**: system monospace for code

### Offline indicator

Small banner at top: "Offline — changes will sync when connected." Appears/disappears on connectivity change.

### Sync UX

- Pull-to-refresh on notes list and search triggers sync
- Settings tab shows: last sync time, "Sync Now" button, pending changes count
- Background sync via `expo-background-fetch` when app is backgrounded

## Feature Parity

| Web Feature | Mobile Implementation |
|---|---|
| File tree sidebar | Notes tab — expandable folder tree |
| Note preview | WebView with markdown rendering |
| Note editing (CodeMirror) | WebView with CodeMirror + postMessage bridge |
| Split editor/preview | Toggle mode (not side-by-side) |
| Search | Search tab with local WatermelonDB queries |
| Graph view | Graph tab — D3 in WebView |
| Tags panel | Tags tab — list with counts |
| Daily notes | FAB button on Notes tab |
| Templates | Template picker on new note |
| Breadcrumbs | Header on note screen |
| Favorites/starred | Top section of Notes tab |
| Trash | Trash screen from settings or swipe-to-delete |
| Version history | History screen from note menu |
| Sharing | Share screen from note menu |
| Access requests | Sharing screen with pending requests |
| Image upload | Camera/gallery picker in editor |
| Frontmatter | Rendered above content in preview |
| Auto-save | 2s debounce via WebView bridge |
| Toast notifications | react-native-toast-message |
| Drag-and-drop tree | Long-press to move |
| Admin panel | Admin screen in settings (if admin) |
| 2FA management | Account settings |
| API keys | Account settings |
| Plugins | Server-side only — plugin UI not on mobile |
| Quick switcher | Search tab |
| Vim mode | Toggle passed to WebView editor |

## Online-Only Features

These features require server connectivity and are NOT available offline:

- **Access requests** — fetched live from `GET /api/access-requests`, not synced to WatermelonDB
- **Admin panel** — fetched live from admin API endpoints
- **Image upload** — requires `POST /api/files`
- **Version history** — fetched live from `GET /api/history/*`
- **OAuth login** — requires system browser + server
- **API key management** — fetched live from API

When offline, these screens show a "Requires connection" message.

## Background Sync Limitations

- `expo-background-fetch` on iOS is unreliable — iOS controls timing, minimum ~15 minutes
- Background sync is **best-effort**, not guaranteed
- Primary sync happens on app foreground (resume) and pull-to-refresh
- A "Sync Now" button in settings provides manual control

## Not In Scope

- Plugin UI on mobile (server-side plugins still run and affect data)
- Keyboard shortcuts (mobile doesn't have keyboards typically)
- Resize handles (fixed mobile layout)
- Right panel (graph/outline) — separate tabs instead
