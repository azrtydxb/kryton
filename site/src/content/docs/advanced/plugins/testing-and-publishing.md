---
title: Testing and publishing
description: Vitest setup for plugins, how the existing plugins test themselves, and the registry submission process.
---

A plugin is just JavaScript. The host's testing stack — vitest — is the default. The registry's CI runs `vitest run` against every plugin's `__tests__/` directory on every PR.

## Vitest

Most plugins keep their model code in a plain JS file (no React, no browser globals) so it's trivial to unit-test. The kanban plugin is the example: `board-model.js` lives next to `client/index.ts`, and the same parse / serialize logic is exercised by `__tests__/board-model.test.js`.

```js title="plugins/kanban/__tests__/board-model.test.js"
import { describe, it, expect } from 'vitest';
import { parseBoard, serializeBoard } from '../board-model.js';

describe('kanban board model', () => {
  it('round-trips an empty board', () => {
    const md = '## Todo\n- Pick milk\n\n## Done\n- [x] Pick bread';
    expect(serializeBoard(parseBoard(md))).toBe(md);
  });
});
```

Run it from the registry root:

```bash
cd kryton-plugins
npm install
npm test
```

Or scope to one plugin:

```bash
npx vitest run plugins/kanban
```

The host repo's `vitest.config.ts` picks up `plugins/*/__tests__/**/*.test.{ts,js}` automatically.

### Mocking the host API

For tests that exercise the client entry, mock `window.__krytonPluginDeps` and the `api.*` namespaces:

```js
import { vi } from 'vitest';

const api = {
  ui: { registerSidebarPanel: vi.fn() },
  notes: {
    get: vi.fn().mockResolvedValue({ content: '## Todo\n- A' }),
    update: vi.fn().mockResolvedValue({ ok: true }),
  },
  notify: { error: vi.fn() },
};

globalThis.window = { __krytonPluginDeps: { React: await import('react') } };

const { activate } = await import('../client/index.ts');
activate(api);

expect(api.ui.registerSidebarPanel).toHaveBeenCalledOnce();
```

For component tests, [`@testing-library/react`](https://testing-library.com/docs/react-testing-library/intro/) layers on top of vitest cleanly.

## Manifest validation

Before publishing, validate the manifest against the schema the host uses at load time:

```bash
node scripts/validate-manifest.mjs plugins/my-plugin/manifest.json
```

(The registry's CI runs this for you on every PR.)

Required fields: `id`, `name`, `version`, `description`, `author`, `minKrytonVersion`. Optional: `tags[]`, `icon`, `client`, `server`. The `id` must be globally unique within the registry and follow `^[a-z][a-z0-9-]{1,40}$`.

## Submitting to the registry

The canonical registry lives at [github.com/azrtydxb/kryton-plugins](https://github.com/azrtydxb/kryton-plugins). To add a plugin:

1. Fork the repo.
2. Create `plugins/<id>/` with your `manifest.json`, `client/`, optional `server/`, and `__tests__/`.
3. Add an entry to `registry.json`:

   ```json
   {
     "id": "my-plugin",
     "name": "My Plugin",
     "version": "1.0.0",
     "description": "What it does in one sentence.",
     "author": "your-handle",
     "minKrytonVersion": "2.0.0",
     "tags": ["productivity"],
     "icon": "smile",
     "archiveUrl": "https://github.com/your-handle/my-plugin/releases/download/v1.0.0/my-plugin.tar.gz",
     "sha256": "<sha256 of the archive>"
   }
   ```

4. `npm test` locally — every plugin's tests must pass before the registry CI accepts the PR.
5. Open a PR. The CI runs lint + tests + manifest validation. A maintainer reviews for security and fit.

## Versioning

Plugins use [SemVer](https://semver.org/). The registry stores one version per plugin id — bumping `version` in `registry.json` is how users get an update.

Breaking changes (renamed settings keys, removed slots, schema migrations on stored data) go in a major bump and should include a migration note in the PR description. The admin panel surfaces the version delta when an update is available.

## Releasing an archive

The simplest path: tag a GitHub release on your fork, upload `my-plugin.tar.gz`, copy the URL + SHA-256 into the registry entry. The archive should contain just your plugin's directory (the `tar` extracts into `/data/plugins/<id>/`).

```bash
cd plugins/my-plugin
npm run build              # compiles TS → JS
tar czf my-plugin.tar.gz manifest.json client/ server/ README.md
sha256sum my-plugin.tar.gz
```

Drop the archive into a GitHub release of your fork, paste the URL + digest into the registry PR.

## See also

- [Plugins overview](/kryton/advanced/plugins/overview/) — what a plugin is.
- [Quickstart](/kryton/advanced/plugins/quickstart/) — hello-world.
- [Code-fence renderers](/kryton/advanced/plugins/code-fence-renderers/) — kanban's `__tests__/` is the reference test layout.
