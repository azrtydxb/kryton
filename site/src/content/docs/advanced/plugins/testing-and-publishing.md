---
title: Testing and publishing
description: Vitest setup for plugins, manifest validation, and the registry submission process.
---

The [`kryton-plugins`](https://github.com/azrtydxb/kryton-plugins)
repository is the development workspace for every official plugin and
the staging area for community submissions. It ships with a build,
test, and validate workflow you can lean on.

## Test runner

[vitest](https://vitest.dev) is the runner — it's declared in
`kryton-plugins/package.json`:

```json
"devDependencies": {
  "esbuild": "^0.25.0",
  "jsdom": "^25.0.0",
  "typescript": "^5.9.0",
  "vitest": "^2.1.0"
}
```

Convention: each plugin keeps its tests inside its own
`__tests__/` folder, alongside `manifest.json`. Examples:

- `plugins/checklist/__tests__/parser.test.js`
- `plugins/kanban/__tests__/board-model.test.js`
- `plugins/flashcards/__tests__/srs.test.js`
- `plugins/advanced-tables/__tests__/format.test.js`

## A vitest example

From `plugins/checklist/__tests__/parser.test.js`:

```js
import { describe, it, expect } from 'vitest';
const { extractCheckboxes } = require('../parser.js');

describe('extractCheckboxes', () => {
  it('returns empty for note with no checkboxes', () => {
    expect(extractCheckboxes('plain text', 'a.md')).toEqual([]);
  });
  it('parses unchecked and checked items', () => {
    const md = '- [ ] todo\n- [x] done\n  - [X] indented';
    expect(extractCheckboxes(md, 'n.md')).toEqual([
      { path: 'n.md', line: 1, checked: false, text: 'todo' },
      { path: 'n.md', line: 2, checked: true, text: 'done' },
      { path: 'n.md', line: 3, checked: true, text: 'indented' },
    ]);
  });
});
```

The pattern across the repo: extract pure logic (parsers, model
transforms, formatters) into a plain module the test imports directly,
then drive UI from that module. Don't test through the host — there's
no host in vitest.

## Repo scripts

From `kryton-plugins/package.json`:

| Script | What it runs |
|--------|--------------|
| `npm run build` | `node scripts/build-plugins.js` — esbuild bundles each plugin's TypeScript to JS. |
| `npm run validate` | `node scripts/validate-registry.js` — manifest sanity checks (see below). |
| `npm run generate` | `node scripts/generate-registry.js` — rebuilds `registry.json` from manifests. |
| `npm test` | `node scripts/test-plugins.js && vitest run` — per-plugin sanity tests, then the vitest suite. |
| `npm run test:unit` | `vitest run` — just the vitest suite. |
| `npm run test:watch` | `vitest` — watch mode for local dev. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | `eslint plugins/ --ext .js`. |

## Manifest validation

`scripts/validate-registry.js` enforces:

1. Each plugin folder has a parseable `manifest.json`.
2. Required fields are present: `id`, `name`, `version`, `description`,
   `author`, `minKrytonVersion`.
3. `manifest.id` matches the directory name.
4. Declared entry points (`server`, `client`) exist on disk.
5. Settings entries are well-formed.
6. No two plugins share an id across the repo.

The script exits non-zero if any check fails; CI runs it on every PR.

## Publishing to the registry

`registry.json` is **auto-generated** — `generate-registry.js` reads
every `plugins/*/manifest.json` and rewrites the file. Don't edit it
by hand.

Workflow for a new community plugin:

1. Fork [`kryton-plugins`](https://github.com/azrtydxb/kryton-plugins).
2. Create `plugins/<your-id>/` with the layout from the
   [overview](/kryton/advanced/plugins/overview/#file-layout).
3. Locally: `npm install && npm run validate && npm test && npm run build`.
4. Run `npm run generate` so `registry.json` reflects your plugin.
5. Open a PR. CI re-runs validate, test, and build; reviewers check the
   plugin against the contribution guidelines in
   `kryton-plugins/README.md`.

Once merged, your plugin shows up in every Kryton instance's Plugin
Manager on the next registry refresh.

## Local installation (no registry)

For development or private plugins you don't want to publish: drop the
folder into the running Kryton's configured plugins directory, then
reload from the admin panel. The lifecycle is exactly the same as a
registry install — see
[Overview → Lifecycle](/kryton/advanced/plugins/overview/#lifecycle).
