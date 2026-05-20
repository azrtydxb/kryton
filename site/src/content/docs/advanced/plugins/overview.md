---
title: Plugins overview
description: What a Kryton plugin is, where it lives on disk, its lifecycle, and how the registry differs from a local install.
---

A Kryton plugin is a small JavaScript or TypeScript package that extends the server, the client, or both. Plugins ship as a directory with a `manifest.json`, an optional `client/` entrypoint, and an optional `server/` entrypoint. The server discovers them on boot; the client loads them on first render.

There is no "plugin process" — server plugins run inside the main Node server, and client plugins run inside the main browser bundle. The plugin API is the contract.

## Anatomy

```
plugins/
  my-plugin/
    manifest.json           # required: id, name, version, description, ...
    client/
      index.ts              # optional client entry (registered via api.*)
    server/
      index.ts              # optional server entry (registered via ServerAPI)
    __tests__/
      board-model.test.ts   # vitest tests; the host's vitest picks them up
```

`manifest.json` minimum:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Adds a sidebar panel that shows hello",
  "author": "you",
  "minKrytonVersion": "2.0.0",
  "client": "client/index.js"
}
```

The `client` field is the path the host loads in the browser. Build pipelines that emit JS from TS write the compiled file to that path. The `server` field, when present, points at a Node entry the server loads on boot.

## Lifecycle

### Server side

1. Server boots, scans `/data/plugins/` (or `NOTES_DIR/plugins`).
2. For each plugin directory, the loader reads `manifest.json`, validates it, and dynamic-imports `server/index.js` (if present).
3. The plugin exports `activate(api: ServerAPI)`. The host invokes it once with the namespaced ServerAPI: route registration, hooks, storage, the database, the logger, the request user lookup.
4. On clean shutdown, the host calls `deactivate()` if exported.

### Client side

1. Browser fetches `/api/plugins`, which returns the manifests of every enabled plugin.
2. For each plugin with a `client` entry, the browser dynamically imports it.
3. The plugin exports `activate(api: ClientPluginAPI)`. The host invokes it once with the ClientPluginAPI: UI slot registration, command registration, code-fence renderers, notes / editor / storage namespaces, the suggestion popup, settings hooks.
4. On disable (from the admin panel), the host calls `deactivate()` if exported and removes the registered surfaces.

Both `activate` functions are synchronous. Async work belongs in event handlers and effects, not the entry call.

## Where plugins live on disk

| Path | When |
|---|---|
| `<repo>/plugins/<id>/` | Bundled / built-in plugins shipped with the host. |
| `/data/plugins/<id>/` (in-container) | User-installed plugins, persisted to the data PVC. Matches `NOTES_DIR/plugins/` on bare-metal. |
| `~/.kryton/plugins/<id>/` (desktop helper, future) | Reserved for the desktop helper's local-only plugins. |

## Registry vs local install

There are two ways a plugin lands on disk:

### Registry (`kryton-plugins`)

The [`azrtydxb/kryton-plugins`](https://github.com/azrtydxb/kryton-plugins) repo hosts the canonical registry. Its `registry.json` lists every approved plugin with `id`, `version`, `description`, archive URL, and SHA-256 digest. The admin panel renders this registry, and **Install** downloads the archive, verifies the digest, extracts into `/data/plugins/<id>/`, and reloads the plugin loader.

### Local

Drop a directory into `/data/plugins/<id>/`, restart the server. The loader picks it up. Use this for development or for plugins you don't want to publish.

The [Operator's `spec.plugins`](/kryton/advanced/deployment/operator/#with-pre-installed-plugins) is the Kubernetes-native equivalent of "registry install": URL + SHA-256, fetched into the PVC by an init-container.

## Permissions

Server plugins run with the full server's privileges. They can read and write any user's notes, the database, and the host's process env. **There is no sandboxing** — only install plugins you trust. The registry's review process exists to gate that trust.

Client plugins are constrained by the browser's same-origin policy and the host-provided API surface. They cannot fetch from arbitrary origins (CSP `connect-src 'self'`), cannot read other users' notes, and cannot bypass the server's auth model. The API surface gives them everything they need without exposing the raw DOM or arbitrary fetch.

## Generated API reference

The full client and server API references are auto-generated from TypeScript types:

- [Client API](/kryton/advanced/plugins/client-api/) — `api.notes`, `api.storage`, `api.ui`, `api.editor`, `api.markdown`, `api.commands`, `api.context`, `api.notify`.
- [Server API](/kryton/advanced/plugins/server-api/) — `app.get/post/...`, `app.db`, `app.notes`, `app.storage`, `app.logger`, `app.hooks`.

Browse the type signatures and the generated docstrings there.

## See also

- [Quickstart](/kryton/advanced/plugins/quickstart/) — a 30-line hello-world.
- [UI slots](/kryton/advanced/plugins/ui-slots/) — every place a plugin can render.
- [Code-fence renderers](/kryton/advanced/plugins/code-fence-renderers/) — kanban, mermaid, dataview, mind-map, excalidraw all use this.
- [Testing and publishing](/kryton/advanced/plugins/testing-and-publishing/)
