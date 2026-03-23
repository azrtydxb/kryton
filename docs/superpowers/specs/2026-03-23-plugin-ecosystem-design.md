# Plugin Ecosystem Design

Comprehensive design for an Obsidian-like plugin ecosystem in Mnemo, covering the Plugin API, runtime, distribution, and management UI.

## Overview

Mnemo's plugin system allows the admin to install community plugins that extend every aspect of the application — custom markdown renderers, new UI panels, workflow automation, data integrations, and full custom pages. Plugins are admin-installed and server-wide, but can expose per-user settings and store per-user data.

### Design Principles

- **Admin is the trust boundary** — plugins run with full access, installed by the admin for all users
- **Structured API over direct access** — plugins interact through a defined `PluginAPI`, not Mnemo internals
- **Defensive guardrails, not sandboxing** — error boundaries, health monitoring, and clean lifecycle hooks protect reliability without the complexity of process isolation
- **Hot-swappable** — individual plugins can be loaded/unloaded without server restart

### Architecture: Monolithic + Defensive Guardrails

Plugins run in the same Node.js process as the Mnemo server. This is the simplest execution model and avoids IPC overhead. Reliability is ensured through:

- React error boundaries wrapping all plugin UI components
- Server-side try/catch around all plugin event handlers and route handlers
- A health monitor that auto-disables plugins exceeding error thresholds
- Clean `activate()`/`deactivate()` lifecycle with tracked registrations for safe teardown

This architecture leaves the door open for Worker Thread isolation in the future if the ecosystem grows to need it.

---

## 1. Plugin Structure & Manifest

Each plugin is a directory in the registry monorepo:

```
plugins/
  kanban/
    manifest.json
    server/
      index.ts
    client/
      index.tsx
    README.md
  spaced-repetition/
    manifest.json
    server/
      index.ts
    client/
      index.tsx
    README.md
  registry.json
```

### manifest.json

```json
{
  "id": "kanban",
  "name": "Kanban Boards",
  "version": "1.0.0",
  "description": "Turn notes into Kanban boards",
  "author": "Pascal",
  "minMnemoVersion": "2.1.0",
  "server": "server/index.ts",
  "client": "client/index.tsx",
  "settings": [
    {
      "key": "defaultColumns",
      "type": "string",
      "default": "To Do,In Progress,Done",
      "label": "Default column names",
      "perUser": false
    },
    {
      "key": "showInSidebar",
      "type": "boolean",
      "default": true,
      "label": "Show boards in sidebar",
      "perUser": true
    }
  ]
}
```

Field descriptions:

- **`id`** — unique identifier, matches directory name in the registry
- **`name`** — human-readable display name
- **`version`** — semver version string
- **`description`** — short description for the registry browser
- **`author`** — plugin author name
- **`minMnemoVersion`** — minimum Mnemo version required for compatibility
- **`server`** — path to backend entry point (optional, omit for frontend-only plugins)
- **`client`** — path to frontend entry point (optional, omit for backend-only plugins)
- **`settings`** — array of setting declarations with type, default, label, and `perUser` flag

---

## 2. Plugin API (Backend)

When a plugin's `activate()` function is called, it receives a scoped `PluginAPI` object — the only interface between the plugin and Mnemo's internals.

### Plugin Entry Point

```typescript
export function activate(api: PluginAPI): void { ... }
export function deactivate(): void { ... }
```

### PluginAPI Interface

```typescript
interface PluginAPI {
  // --- Note Operations ---
  notes: {
    get(userId: string, path: string): Promise<Note>
    list(userId: string, folder?: string): Promise<NoteEntry[]>
    create(userId: string, path: string, content: string): Promise<void>
    update(userId: string, path: string, content: string): Promise<void>
    delete(userId: string, path: string): Promise<void>
  }

  // --- Events (lifecycle hooks) ---
  events: {
    on(event: PluginEvent, handler: Function): void
    off(event: PluginEvent, handler: Function): void
  }

  // --- Custom API Routes ---
  routes: {
    register(method: HttpMethod, path: string, handler: RequestHandler): void
  }

  // --- Key-Value Storage ---
  storage: {
    get(key: string, userId?: string): Promise<any>
    set(key: string, value: any, userId?: string): Promise<void>
    delete(key: string, userId?: string): Promise<void>
    list(prefix?: string, userId?: string): Promise<StorageEntry[]>
  }

  // --- Database (structured data) ---
  database: {
    registerEntity(entity: EntitySchema): void
    getRepository(entity: EntitySchema): Repository<any>
  }

  // --- Settings ---
  settings: {
    get(key: string, userId?: string): Promise<any>
  }

  // --- Search ---
  search: {
    index(userId: string, path: string, fields: IndexFields): Promise<void>
    query(userId: string, query: string): Promise<SearchResult[]>
  }

  // --- Logger ---
  log: {
    info(message: string, ...args: any[]): void
    warn(message: string, ...args: any[]): void
    error(message: string, ...args: any[]): void
  }

  // --- Plugin Identity ---
  plugin: {
    id: string
    version: string
    dataDir: string
  }
}
```

### Key Design Decisions

**`userId` is always explicit.** Plugins never implicitly operate on "the current user." Every note, storage, and settings operation requires an explicit `userId` parameter. This prevents accidental cross-user data access.

**Events use before/after pattern.** Available events:
- `note:beforeSave` — can modify content; throwing cancels the save
- `note:afterSave` — for side effects (indexing, notifications)
- `note:beforeDelete` — throwing cancels the delete
- `note:afterDelete` — cleanup side effects
- `note:open` — when a user opens a note
- `search:query` — extend search results
- `user:login` / `user:logout` — session lifecycle

`before` handlers receive a mutable context object and can cancel the operation by throwing. `after` handlers are fire-and-forget.

**Routes get auth for free.** Plugin routes are mounted at `/api/plugins/{pluginId}/...` with Mnemo's auth middleware already applied. The handler receives `req.user` like any Mnemo route. The plugin just writes the handler logic.

**Database entities are auto-namespaced.** When a plugin registers a TypeORM entity, the table name is automatically prefixed with `plugin_{pluginId}_` (e.g., `plugin_kanban_boards`). Mnemo runs migrations on plugin install/update.

**Logger is auto-prefixed.** All log output is prefixed with `[plugin:{pluginId}]` for easy filtering.

---

## 3. Plugin API (Frontend)

The client-side entry exports `activate()` and `deactivate()` functions that receive a `ClientPluginAPI` object.

### ClientPluginAPI Interface

```typescript
interface ClientPluginAPI {
  // --- UI Slots ---
  ui: {
    registerSidebarPanel(component: React.FC, options: {
      id: string
      title: string
      icon: LucideIcon
      order?: number
    }): void

    registerStatusBarItem(component: React.FC, options: {
      id: string
      position: 'left' | 'right'
      order?: number
    }): void

    registerEditorToolbarButton(component: React.FC, options: {
      id: string
      order?: number
    }): void

    registerSettingsSection(component: React.FC, options: {
      id: string
      title: string
    }): void

    registerPage(component: React.FC, options: {
      id: string
      path: string
      title: string
      icon: LucideIcon
      showInSidebar?: boolean
    }): void

    registerNoteAction(options: {
      id: string
      label: string
      icon: LucideIcon
      onClick: (notePath: string) => void
    }): void
  }

  // --- Markdown Rendering ---
  markdown: {
    registerCodeFenceRenderer(
      language: string,
      component: React.FC<{ content: string; notePath: string }>
    ): void

    registerPostProcessor(fn: (html: string) => string): void
  }

  // --- Commands ---
  commands: {
    register(command: {
      id: string
      name: string
      shortcut?: string
      execute: () => void
    }): void
  }

  // --- App State (read-only hooks) ---
  context: {
    useCurrentUser(): User
    useCurrentNote(): { path: string; content: string } | null
    useTheme(): 'light' | 'dark'
    usePluginSettings(key: string): any
  }

  // --- API Client ---
  api: {
    fetch(path: string, options?: RequestInit): Promise<Response>
  }

  // --- Notifications ---
  notify: {
    info(message: string): void
    success(message: string): void
    error(message: string): void
  }
}
```

### Key Design Decisions

**UI slots are explicit.** Plugins inject components into predefined locations: sidebar panels, status bar, editor toolbar, settings page, full custom pages, and note actions. This keeps the UI predictable — plugins can't arbitrarily modify the DOM.

**Custom pages are routed under `/plugin/`.** A plugin registering `path: '/kanban'` gets the full route `/plugin/kanban`. If `showInSidebar: true`, a navigation link appears in the sidebar.

**Markdown renderers are React components.** A ` ```kanban ` code fence is rendered by the plugin's React component with the raw content and note path as props.

**Commands integrate with the quick switcher.** Plugins can register commands that appear in the Ctrl+P command palette with optional keyboard shortcuts.

**`context` provides React hooks.** Plugins read app state reactively (current user, current note, theme, plugin settings) without coupling to Mnemo's internal state management.

**`api.fetch` is a thin wrapper.** It prefixes the URL to `/api/plugins/{pluginId}/...` and injects auth headers automatically. Plugins just call `api.fetch('/boards')`.

**All plugin components are wrapped in React error boundaries.** If a sidebar panel crashes, it shows a "Plugin X encountered an error" fallback with a retry button — it never takes down the rest of the UI.

---

## 4. Plugin Lifecycle & Hot-Swap

### Lifecycle States

```
Installed → Loaded → Active → Deactivating → Unloaded
                                    ↑              |
                                    └──── (reload) ┘
```

### Server-Side Lifecycle

1. **Install** — Mnemo downloads the plugin directory from the registry repo into a local `plugins/` directory. Manifest is validated. Database entities are registered and migrations run.

2. **Load** — Plugin's server entry is `require()`'d. The module is parsed but `activate()` is not yet called.

3. **Activate** — `activate(api)` is called with a scoped `PluginAPI` instance. The plugin registers event handlers, routes, storage schemas, and database entities. All registrations go through the scoped API, so Mnemo tracks what each plugin has registered.

4. **Deactivate** — `deactivate()` is called. The plugin cleans up timers, connections, etc. Then Mnemo automatically:
   - Removes all Express routes the plugin registered
   - Removes all event listeners the plugin registered
   - Clears the Node `require` cache for the plugin's modules

5. **Hot-swap (update)** — Deactivate old version → replace files → Load new version → Activate. Existing HTTP requests in flight finish against the old handlers; Express routes are swapped atomically after current middleware chains complete.

### Frontend Lifecycle

1. On page load, Mnemo serves a plugin manifest endpoint (`GET /api/plugins/active`) listing active plugins and their client bundle URLs.
2. The app dynamically `import()`s each plugin's client bundle.
3. Each plugin's `activate(clientApi)` is called, registering UI components into slots.
4. On hot-swap, the frontend receives a WebSocket event, unmounts the old plugin's components, loads the new bundle, and re-activates.

### Defensive Guardrails

- **Error boundaries** — each plugin's UI components are wrapped in React error boundaries. A crash shows a fallback message with a retry button.
- **Activation timeout** — if `activate()` doesn't return within 10 seconds, the plugin is marked as failed and disabled.
- **Health monitor** — if a plugin's event handlers or route handlers throw more than 5 errors in 60 seconds, the plugin is auto-disabled and the admin is notified via the dashboard.
- **Graceful degradation** — if a plugin fails to load, the rest of Mnemo works normally. Failed plugins show a warning in the admin dashboard with the error details.

---

## 5. Registry & Distribution

### Registry Repository

The plugin registry is a single git repository: **`piwi3910/mnemo-plugins`** (hardcoded in the Mnemo server source).

```
mnemo-plugins/
  registry.json
  plugins/
    kanban/
      manifest.json
      server/
        index.ts
      client/
        index.tsx
    spaced-repetition/
      manifest.json
      ...
```

### registry.json

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "kanban",
      "name": "Kanban Boards",
      "description": "Turn notes into interactive Kanban boards",
      "author": "Pascal",
      "version": "1.0.0",
      "minMnemoVersion": "2.1.0",
      "tags": ["productivity", "organization"],
      "icon": "layout-grid"
    }
  ]
}
```

### Build Pipeline

The registry repo has a CI pipeline that builds each plugin's TypeScript source into ready-to-run JavaScript bundles on merge. Mnemo downloads pre-built bundles, not source code.

- Server entry → bundled to a single CommonJS file
- Client entry → bundled to a single ESM file (for dynamic `import()`)
- Built artifacts are committed or published as release assets

### Fetch & Install Flow

1. Mnemo fetches `registry.json` from the GitHub repo (via GitHub API) when the admin opens the plugin browser.
2. The admin searches/browses, picks a plugin, clicks "Install."
3. Mnemo downloads the plugin's built bundle (via GitHub API), validates the manifest, and places it in the local `plugins/` directory.
4. The plugin is activated via the lifecycle described in Section 4.

### Update Flow

- Mnemo periodically checks the registry for version bumps (or the admin clicks "Check for updates").
- When an update is available, the admin sees it in the dashboard and clicks "Update."
- Mnemo downloads the new version and runs the hot-swap lifecycle: deactivate old → replace files → activate new.

---

## 6. Admin Dashboard (Plugin Management UI)

A new **Plugins** tab in the existing Admin Dashboard with three views:

### Plugin Browser

- Search bar with tag filtering (productivity, learning, integrations, etc.)
- Plugin cards showing name, description, version, author
- "Install" button per plugin
- Compatibility warnings when `minMnemoVersion` exceeds the current Mnemo version

### Installed Plugins

- List of all installed plugins with status indicators:
  - **Active** (green) — running normally
  - **Disabled** (gray) — manually disabled by admin or auto-disabled by health monitor
  - **Update available** (amber) — newer version in registry
  - **Error** (red) — failed to load or activate
- Per-plugin actions: Settings, Disable/Enable, Update, Uninstall
- Each card shows what the plugin has registered (routes, panels, renderers) for transparency

### Plugin Settings

- Auto-generated from the manifest's `settings` declarations
- Split into "Admin Settings" (server-wide) and "Per-User Settings" (defaults for users)
- Input types map from manifest: `string` → text input, `boolean` → toggle, `number` → number input
- Plugins can also register a custom settings component via `ui.registerSettingsSection()` for richer UI

---

## 7. Per-User Plugin Settings

Users access plugin settings through their existing Settings page.

- A new "Plugins" section lists installed plugins that have `perUser: true` settings
- Each plugin shows its per-user toggles/options
- Plugins can also expose settings inline in their own UI (e.g., a toggle in a sidebar panel)

### Data Model

Per-user plugin settings use the existing `Settings` entity with namespaced keys: `plugin:{pluginId}:{settingKey}` with the user's `userId`.

When `api.settings.get(key, userId)` is called:
1. Check for a user-specific override in `Settings` where key = `plugin:{pluginId}:{key}` and userId matches
2. If no override, fall back to the admin default in `Settings` where key = `plugin:{pluginId}:{key}` and userId is null
3. If no admin override, fall back to the manifest default

---

## 8. Plugin Data & Storage Model

Three persistence options for plugins, scaled to complexity:

### Key-Value Storage (`api.storage`)

A new `PluginStorage` entity:

| Column | Type | Description |
|--------|------|-------------|
| `pluginId` | string (PK) | Plugin identifier |
| `key` | string (PK) | Storage key |
| `userId` | string (PK, nullable) | Null = global, set = per-user |
| `value` | jsonb | Stored value |
| `updatedAt` | timestamp | Last modified |

- `userId` omitted → global plugin data
- `userId` provided → per-user plugin data
- Good for: preferences, small state, counters, bookmarks

### Custom Database Entities (`api.database`)

- Plugin defines TypeORM entities via `api.database.registerEntity()`
- Table names auto-prefixed: `plugin_{pluginId}_{tableName}`
- Mnemo manages the connection and runs migrations on plugin install/update
- Plugin queries via `api.database.getRepository(entity)`
- Good for: structured data with relationships and complex queries (Kanban boards, spaced repetition schedules)

### File Storage (`api.plugin.dataDir`)

- Each plugin gets a directory at `data/plugins/{pluginId}/`
- Plugin manages its own file organization
- Good for: large files, binary data, SQLite databases, or plugins that want full control

### Cleanup on Uninstall

Admin is prompted with two options:
- **Keep data** — storage entries, database tables, and `dataDir` remain intact (safe to reinstall later)
- **Delete everything** — all plugin data is removed

### Multi-User Safety

All storage and database operations require an explicit `userId` parameter. There is no implicit "current user" context on the server side. Plugin routes receive `req.user` from auth middleware, and the plugin decides how to scope its data queries.

---

## Implementation Phases

The plugin ecosystem will be implemented as four sequential sub-projects:

### Phase 1: Plugin API & Runtime

- Define TypeScript interfaces for `PluginAPI` and `ClientPluginAPI`
- Implement the plugin loader (require, activate, deactivate, module cache management)
- Implement backend API: notes, events, routes, storage, database, settings, search, logger
- Implement frontend API: UI slot registry, markdown renderer registry, commands, context hooks
- Implement `PluginStorage` entity and plugin data directory management
- Implement defensive guardrails: error boundaries, health monitor, activation timeout
- Build one internal example plugin to validate the API surface

### Phase 2: Plugin Lifecycle & Hot-Swap

- Implement the full lifecycle state machine (install → load → activate → deactivate → unload)
- Implement per-plugin hot-swap (deactivate → replace → activate)
- Implement frontend hot-swap via WebSocket notification
- Implement database entity registration and auto-migration for plugins
- Test lifecycle edge cases: crash during activate, crash during deactivate, rapid swap

### Phase 3: Registry & Distribution

- Set up the `piwi3910/mnemo-plugins` repository structure with `registry.json`
- Implement CI pipeline to build plugin TypeScript → JS bundles
- Implement registry fetching in Mnemo (GitHub API integration)
- Implement plugin download and installation from registry
- Implement update checking and update flow
- Build a sample plugin in the registry to validate the full pipeline

### Phase 4: Admin & User UI

- Add Plugins tab to Admin Dashboard
- Build Plugin Browser view (search, filter, install)
- Build Installed Plugins view (status, actions, settings)
- Build Plugin Settings view (auto-generated from manifest)
- Add Plugins section to user Settings page (per-user overrides)
- Implement plugin status notifications (auto-disable alerts, update available)
