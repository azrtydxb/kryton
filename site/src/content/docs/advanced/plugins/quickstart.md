---
title: Plugin quickstart
description: Build a "hello world" Kryton plugin in 30 lines that registers a sidebar panel.
---

A working hello-world in three files: a `manifest.json`, a `client/index.ts`, and a one-line build script. After that you'll know the shape of every other plugin in the registry.

## 1. Scaffold

```bash
mkdir -p hello-kryton/client
cd hello-kryton
npm init -y
npm install --save-dev esbuild typescript
```

## 2. Manifest

```json title="manifest.json"
{
  "id": "hello-kryton",
  "name": "Hello Kryton",
  "version": "0.1.0",
  "description": "Greets you from a sidebar panel.",
  "author": "you",
  "minKrytonVersion": "2.0.0",
  "tags": ["example"],
  "icon": "smile",
  "client": "client/index.js"
}
```

`id` must be lowercase, hyphen-separated, unique within the registry. `icon` is a [lucide](https://lucide.dev/icons/) icon name.

## 3. Client entry

```ts title="client/index.ts"
import type { ClientPluginAPI } from '@azrtydxb/kryton-plugins-types/client';

const { React } = window.__krytonPluginDeps;
const { createElement: h } = React;

function HelloPanel() {
  return h(
    'div',
    { style: { padding: 16, color: 'var(--kryton-text)' } },
    'Hello from a Kryton plugin.',
  );
}

export function activate(api: ClientPluginAPI): void {
  api.ui.registerSidebarPanel(HelloPanel, {
    id: 'hello-panel',
    title: 'Hello',
    icon: 'smile',
  });
}

export function deactivate(): void {
  // Host removes the registered panel automatically.
}
```

A few rules:

- React is provided by the host on `window.__krytonPluginDeps`. **Don't import `react` directly** — your plugin and the host would fight over two copies of React, and hooks would explode.
- All `register*` calls happen inside `activate`. Calling them at module top-level is a race against the host being ready.
- TypeScript is convenient but optional — the host loads JS, not TS. The build step compiles.

## 4. Build

`esbuild` against the client entry, no bundling (the host has React already):

```bash
npx esbuild client/index.ts \
  --bundle=false \
  --format=esm \
  --outfile=client/index.js \
  --target=es2022
```

That's it — `client/index.js` now sits next to `manifest.json`, and the manifest's `"client": "client/index.js"` field points at it.

## 5. Install locally

Copy the directory into your running Kryton:

```bash
# Compose:
docker cp ../hello-kryton kryton-kryton-1:/data/plugins/

# Helm: kubectl cp into the kryton pod's PVC mount.
# Bare-metal: cp -r into $NOTES_DIR/plugins/.

# Then enable from the admin panel, or restart and the loader picks it up.
```

Refresh the browser. A new icon (a lucide smile) appears in the sidebar rail. Click it — your panel renders.

## What you just learned

- A plugin is a directory with a manifest and an entry file.
- The host injects React via `window.__krytonPluginDeps`.
- UI surface registration goes through `api.ui.register*`.
- Everything is opt-in: no sidebar panel until you call `registerSidebarPanel`.

## Where next

- [UI slots](/kryton/advanced/plugins/ui-slots/) — every other slot you can register against (statusbar, editor toolbar, topbar, settings, custom pages, note actions).
- [Code-fence renderers](/kryton/advanced/plugins/code-fence-renderers/) — render custom UI from a markdown code fence (`\`\`\`kanban`, `\`\`\`mermaid`, …).
- [Client API](/kryton/advanced/plugins/client-api/) — full generated reference for `api.notes`, `api.storage`, `api.editor`, etc.
- [Testing and publishing](/kryton/advanced/plugins/testing-and-publishing/) — vitest, then PR against the registry.
