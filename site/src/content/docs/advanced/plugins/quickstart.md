---
title: Plugin quickstart
description: A 30-line "Hello panel" Kryton plugin — manifest plus a sidebar panel.
---

This quickstart builds a client-only plugin that adds a sidebar panel
saying "Hello from my plugin". Develop it inside a clone of the
[`kryton-plugins`](https://github.com/azrtydxb/kryton-plugins)
repository — the type declarations live there, and the build / test /
validate scripts are pre-wired.

## 1. Scaffold the folder

From the repo root:

```bash
mkdir -p plugins/hello-panel/client
```

## 2. Write the manifest

`plugins/hello-panel/manifest.json`:

```json
{
  "id": "hello-panel",
  "name": "Hello Panel",
  "version": "0.1.0",
  "description": "A minimal sidebar-panel plugin.",
  "author": "you",
  "minKrytonVersion": "2.0.0",
  "client": "client/index.js"
}
```

The directory name must match `id`. The five string fields plus
`minKrytonVersion` are all required — see
[Overview → The manifest](/kryton/advanced/plugins/overview/#the-manifest).

## 3. Write the client entry

`plugins/hello-panel/client/index.ts`:

```ts
import type { ClientPluginAPI } from '../../../types/client';

const { React } = window.__krytonPluginDeps;
const { createElement: h } = React;

function HelloPanel(): any {
  return h(
    'div',
    { style: { padding: 12, fontSize: 13 } },
    'Hello from my plugin',
  );
}

export function activate(api: ClientPluginAPI): void {
  api.ui.registerSidebarPanel(HelloPanel, {
    id: 'hello-panel',
    title: 'Hello',
    icon: 'sparkles',
    order: 100,
  });
}

export function deactivate(): void {
  // nothing to clean up
}
```

A few things to note:

- The relative `'../../../types/client'` import points at
  `kryton-plugins/types/client.d.ts` — the type-only declaration of
  `ClientPluginAPI`. No npm package is involved.
- `React` and `ReactDOM` arrive on `window.__krytonPluginDeps`; the
  plugin never imports them directly.
- The manifest points at `client/index.js`, but you write `.ts` — the
  build step transpiles to JS.

## 4. Build and validate

```bash
npm install          # once, at the repo root
npm run build        # esbuild bundles every plugin's ts → js
npm run validate     # runs scripts/validate-registry.js
```

The validator checks that every plugin's manifest has the required
fields, the `id` matches the directory name, declared entry points
exist on disk, and that there are no duplicate ids.

## 5. Try it locally

Two options:

- **Drop it into a running Kryton's plugins directory** and reload —
  the manager picks up `plugins/hello-panel/`.
- **Submit to the registry** — see
  [Testing and publishing](/kryton/advanced/plugins/testing-and-publishing/).

## Next steps

- [UI slots](/kryton/advanced/plugins/ui-slots/) lists every place
  you can hook into the UI besides the sidebar.
- The full type surface is documented in the
  [Client API reference](/kryton/advanced/plugins/client-api/).
