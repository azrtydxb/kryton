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
- `registerSidebarPanel(component, { id, title, icon, order? })` — add a sidebar panel
- `registerStatusBarItem(component, { id, position, order? })` — add a status bar item
- `registerEditorToolbarButton(component, { id, order? })` — add an editor toolbar button
- `registerSettingsSection(component, { id, title })` — add a settings section
- `registerPage(component, { id, path, title, icon, showInSidebar? })` — add a full page route
- `registerNoteAction({ id, label, icon, onClick })` — add a note context menu action

### api.editor
- `registerExtension(extension)` — add a CodeMirror 6 extension

### api.markdown
- `registerCodeFenceRenderer(language, component)` — custom renderer for fenced code blocks
- `registerPostProcessor(fn)` — transform rendered HTML

### api.commands
- `register({ id, name, shortcut?, execute })` — register a keyboard command

### api.context
React hooks for accessing app state:
- `useCurrentUser()`, `useCurrentNote()`, `useTheme()`, `usePluginSettings(key)`

### api.api
- `fetch(path, options?)` — authenticated fetch wrapper

### api.notify
- `info(message)`, `success(message)`, `error(message)` — toast notifications

## Installation

Plugins can be installed from the Kryton plugin registry or manually by placing the plugin directory in the `plugins/` folder. Use the admin panel to manage installed plugins.
