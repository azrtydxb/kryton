# Plugin Development Guide

Kryton supports server-side and client-side plugins. Plugins are installed into the server's `plugins/` directory and loaded at startup.

## Plugin Directory Structure

```
plugins/
  my-plugin/
    manifest.json
    server.js       # Server-side entry point (optional)
    client.js       # Client-side entry point (optional)
```

## manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "Your Name",
  "minKrytonVersion": "3.0.0",
  "server": "server.js",
  "client": "client.js",
  "settings": [
    {
      "key": "myOption",
      "type": "string",
      "default": "hello",
      "label": "My Option",
      "perUser": false
    }
  ]
}
```

**Fields:**
- `id` — unique plugin identifier
- `name` / `version` / `description` / `author` — metadata
- `minKrytonVersion` — minimum compatible Kryton version
- `server` — path to server entry point (optional)
- `client` — path to client entry point (optional)
- `settings` — user-configurable settings; `type` is `"string"`, `"boolean"`, or `"number"`; `perUser` controls whether the setting is global or per-user

## Plugin Lifecycle

Plugins go through these states: `installed` -> `loaded` -> `active` -> `deactivating` -> `unloaded`. If something goes wrong, the state becomes `error`.

Both server and client modules must export `activate()` and `deactivate()` functions:

```typescript
export function activate(api) { /* register handlers, routes, UI */ }
export function deactivate() { /* cleanup */ }
```

## Server API

The `activate(api)` function receives a `PluginAPI` object:

### api.notes
- `get(userId, path)` — read a note
- `list(userId, folder?)` — list notes (recursive)
- `create(userId, path, content)` — create a note
- `update(userId, path, content)` — update a note
- `delete(userId, path)` — delete a note

### api.storage
Key-value storage scoped to your plugin:
- `get(key, userId?)` — retrieve a value
- `set(key, value, userId?)` — store a value
- `delete(key, userId?)` — remove a value
- `list(prefix?, userId?)` — list entries

### api.events
Subscribe to lifecycle events:
- `on(event, handler)` / `off(event, handler)`
- Events: `note:beforeSave`, `note:afterSave`, `note:beforeDelete`, `note:afterDelete`, `note:open`, `search:query`, `user:login`, `user:logout`

### api.routes
Register custom HTTP endpoints:
- `register(method, path, handler)` — method is `get`, `post`, `put`, `delete`, or `patch`

### api.settings
- `get(key, userId?)` — read a plugin setting value

### api.search
- `index(userId, path, fields)` — add to search index
- `query(userId, query)` — search indexed content

### api.log
- `info(message)`, `warn(message)`, `error(message)`

### api.plugin
- `id`, `version`, `dataDir` — plugin metadata and data directory path

## Client API

The client `activate(api)` receives a `ClientPluginAPI` object:

### api.ui
- `registerSidebarPanel(component, { id, title, icon, order? })` — add a sidebar panel. Users can move the panel between the left and right sidebar rails and reorder it from edit-mode; placement persists per user.
- `registerStatusBarItem(component, { id, position, order? })` — add a status bar item
- `registerEditorToolbarButton(component, { id, order? })` — add an editor toolbar button (renders inline with built-in toolbar actions)
- `registerTopbarAction(component, { id, order? })` — add an always-visible action button to the app header. Use for plugin entry points that should be reachable regardless of which note is open. The mass-upload plugin is the canonical reference.
- `registerSettingsSection(component, { id, title })` — add a settings section
- `registerPage(component, { id, path, title, icon, showInSidebar? })` — add a full page route
- `registerNoteAction({ id, label, icon, onClick })` — add a note context menu action
- `closePane()` — close the currently focused note pane (the Cmd+W intent). No-op when no pane is open or the host has not registered a `closePane` hook.

### api.notes
First-class client-side note operations. All paths are relative to the user's notes root.
- `list(folder?)` — list notes/folders (`PluginNoteEntry[]`).
- `get(path)` — fetch a note's full record (`PluginNoteFile`: `path`, `content`, `title`, `modifiedAt`).
- `getContent(path)` — fetch just the markdown content as a string.
- `create(path, content)` / `update(path, content)` / `delete(path)` — CRUD, return `{ ok: true }`.
- `openByPath(path)` — open a note in the current pane.
- `replaceFenceAtRange(path, range, newSource)` — atomically replace a single fence block in a note. `range` should be the `rawRange` received from a code-fence renderer. Kanban uses this to round-trip board edits back to the markdown source.
- `saveCurrent()` — persist the currently focused editor buffer via the host save pipeline. Resolves with `{ path, savedAt }`; rejects when no editor is focused or the host has not registered a `saveCurrent` hook.

### api.storage
Per-plugin key-value storage, scoped to your plugin id.
- `get(key)` — retrieve a value.
- `set(key, value)` — store a value; returns `{ ok: true }`.
- `delete(key)` — remove a value; returns `{ ok: true }`.
- `list(prefix?)` — list `{ key, value, userId }` entries optionally filtered by key prefix.

### api.editor
Direct access to the in-house editor for plugins that need transaction-level control.
- `registerPlugin(plugin)` — register an `EditorPlugin` (decorations, commands, suggestions, `onTransaction`, `onKeyDown`). Returns an unregister function.
- `getActiveState()` — current `EditorState` (`{ doc, selection: { anchor, head }, ... }`) or `null`.
- `dispatch(tr)` — apply a `Transaction` (insert/delete/replace ops + optional new selection).
- `onTransaction(cb)` — subscribe to every transaction; returns an unsubscribe function.
- `setOption(name, value)` — set a host-level editor option. Known keys: `lineNumbers` (boolean) toggles the gutter. Unknown keys are accepted for forward compatibility.

### api.markdown
- `registerCodeFenceRenderer(language, component)` — custom renderer for fenced code blocks. The component receives `CodeFenceRendererProps`:
  - `content` — fence body without the surrounding ` ``` ` lines.
  - `notePath` — host note path (may be empty).
  - `range` / `rawRange` — fence range in parsed source / raw on-disk source. Prefer `rawRange` for round-tripping via `api.notes.replaceFenceAtRange`.
  - `source` — full original fence block including the ` ``` ` markers.
  - `interactive: boolean` — `true` in Edit/Split modes where the fence should accept user input; `false` in Preview where it must render read-only. Kanban toggles drag handles and inputs on this flag.
- `registerPostProcessor(fn)` — transform rendered HTML.

### api.commands
- `register({ id, name, shortcut?, execute })` — register a keyboard command

### api.context
React hooks for accessing app state. All hooks are reactive — components re-render when the underlying value changes.
- `useCurrentUser()` — `{ id, name, email } | null`
- `useCurrentNote()` — `{ path, content } | null`
- `useTheme()` — `"light" | "dark"`
- `usePluginSettings(key)` — current value of a plugin setting (reactive).
- `setPluginSetting(key, value)` — persist a plugin setting from inside the plugin (e.g. a settings-panel Save button). Returns a promise.

### api.api
- `fetch(path, options?)` — authenticated fetch wrapper

### api.notify
- `info(message)`, `success(message)`, `error(message)` — toast notifications

## Installation

Plugins can be installed from the Kryton plugin registry or manually by placing the plugin directory in the `plugins/` folder. Use the admin panel to manage installed plugins.
