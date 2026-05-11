# `@azrtydxb/core` Publishing Infrastructure — Design Spec

**Status:** Approved for implementation planning.
**Sub-project:** 5 of 5.
**Companion:** `2026-04-30-kryton-core-design.md` (defines what's published).

## Purpose

Establish the npm scope, registry, CI workflows, versioning policy, and developer ergonomics for distributing `@azrtydxb/core` and `@azrtydxb/core-react` from the kryton monorepo to external consumers (`kryton-mobile`, future `kryton-desktop`).

## Scope

This spec covers:
- Registration of the `@azrtydxb` npm scope on GitHub Packages.
- Versioning policy across the monorepo and consumers.
- CI workflows for publishing on tag.
- Local-development override mechanism (path linking).
- `.npmrc` configuration for consumers.
- Token management for CI and developers.

This spec does **not** cover:
- The library's API or implementation (kryton-core spec).
- Server-side sync logic (server-sync-v2 spec).

## Registry: GitHub Packages

Packages publish to `npm.pkg.github.com` under the `@azrtydxb` scope, hosted in the `azrtydxb` GitHub account/org. Private by default — only members with read access to the `kryton` repository can install.

Rationale: free for private packages on GitHub-hosted repos, no separate billing, and ties access to the same GitHub permissions already used for source code. Migration to npm.org's private registry later is straightforward (change `.npmrc` and re-publish under the same scope name).

## Scope registration

One-time setup:

1. Repository owner publishes the first version manually to claim `@azrtydxb/core` on `npm.pkg.github.com`. Subsequent publishes are automated.
2. Org-level setting: ensure GitHub Packages is enabled for `azrtydxb`.
3. Repository setting on `azrtydxb/kryton`: under "Packages", confirm Actions has `packages: write` permission.

## Versioning policy

### Single source of truth

The kryton monorepo's root `package.json` `version` field is authoritative. Currently `4.3.2`. This becomes the version of every published `@azrtydxb/*` package.

Rationale: `core` and `core-react` are tightly coupled (same monorepo, same release cycle). Independent semver across them invites mismatched-version pain across consumers. A monorepo-wide version is honest about what they actually are: views of the same release.

### Bump rules

- **Patch (`4.3.2 → 4.3.3`):** internal fixes, no API changes, no schema changes.
- **Minor (`4.3.2 → 4.4.0`):** new entity types added, new optional API surface, additive schema changes (new columns with defaults). Server's sync v2 protocol must remain backward-compatible.
- **Major (`4.x → 5.0.0`):** breaking API changes in core, breaking schema changes (renamed/removed columns), breaking sync protocol changes. Requires a server-side compatibility window: server supports protocol N and N-1 for one minor cycle to allow rolling client upgrades.

### Compatibility matrix

`@azrtydxb/core@<version>` declares compatible server versions in its README and at runtime via `core.compatibleServerVersions`. On `Kryton.init()`, core probes `GET /api/version` and refuses to start if the server is incompatible (with a clear error pointing to the migration guide).

## Workspaces and `package.json`

Monorepo root `package.json`:

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "build:core": "npm run build --workspace=packages/core --workspace=packages/core-react",
    "publish:core": "node scripts/publish-core.js"
  }
}
```

`packages/core/package.json`:

```json
{
  "name": "@azrtydxb/core",
  "version": "4.3.2",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./adapters/expo-sqlite": "./dist/adapters/expo-sqlite.js",
    "./adapters/better-sqlite3": "./dist/adapters/better-sqlite3.js",
    "./adapters/in-memory": "./dist/adapters/in-memory.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "peerDependencies": {
    "expo-sqlite": "*",
    "better-sqlite3": "*"
  },
  "peerDependenciesMeta": {
    "expo-sqlite": { "optional": true },
    "better-sqlite3": { "optional": true }
  },
  "dependencies": {
    "yjs": "^13.6.0",
    "y-protocols": "^1.0.6"
  }
}
```

`packages/core-react/package.json`:

```json
{
  "name": "@azrtydxb/core-react",
  "version": "4.3.2",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "peerDependencies": {
    "@azrtydxb/core": "4.3.2",
    "react": ">=18"
  }
}
```

`@azrtydxb/core-react`'s peer dep on `@azrtydxb/core` is pinned to the exact monorepo version: they're released together, never mixed.

## Build pipeline

### Prerequisite: schema generation

Before TypeScript compilation, `packages/core/scripts/generate-schema.ts` runs and emits `src/generated/{schema.sql,types.ts,entities.ts}`. The generated files are committed to source control (so consumers reading core's source can grep them) but treated as outputs by CI's freshness check (CI fails if generated files are stale relative to `schema.prisma`).

### TypeScript build

Each package has a standard `tsc --build` against `tsconfig.json` extending a root `tsconfig.base.json`. Output to `dist/` with `.d.ts` and `.js.map` files alongside.

`tsup` or `esbuild`-based bundling is **not** used: shipping per-file outputs lets consumers' bundlers tree-shake adapter sub-modules they don't import (e.g., Expo apps don't pull in `better-sqlite3` adapter code).

### Local pre-publish validation

`scripts/publish-core.js`:

1. Verify `git status` is clean.
2. Verify current branch is `master`.
3. Run `npm run build:core`.
4. Run `npm run test --workspace=packages/core --workspace=packages/core-react`.
5. Verify all `@azrtydxb/*` `package.json` versions match root `package.json` version.
6. Run `npm publish --workspace=packages/core --workspace=packages/core-react`.

This script is invoked by CI after a release tag is pushed; it can also be run manually for emergency releases.

## CI workflow

`kryton/.github/workflows/publish-core.yml`:

```yaml
name: Publish @azrtydxb packages

on:
  push:
    tags: ["v*"]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          registry-url: "https://npm.pkg.github.com"
          scope: "@azrtydxb"
      - run: npm ci
      - run: npm run typecheck --workspace=packages/core --workspace=packages/core-react
      - run: npm run test --workspace=packages/core --workspace=packages/core-react
      - run: npm run build:core
      - name: Verify version match
        run: node scripts/verify-versions.js
      - run: npm publish --workspace=packages/core --workspace=packages/core-react
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The `GITHUB_TOKEN` provided to GitHub Actions has `packages: write` permission for the same repository — sufficient to publish under `@azrtydxb`.

### Release tagging

Releases are tagged from `master` after a green CI run on the existing `ci.yml` workflow. The release tag triggers `publish-core.yml`. Suggested tag format: `v4.3.3`, matching `package.json`.

A small helper script `scripts/release.js` automates: bump root `package.json` version, propagate to all workspace `package.json` versions, commit, tag, push.

## Consumer setup (`kryton-mobile`, future `kryton-desktop`)

### `.npmrc` in the consumer repo

```
@azrtydxb:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

The `${GITHUB_TOKEN}` env var is read at install time. CI sets it from secrets; developers add it to their shell (a personal access token with `read:packages` scope, or a fine-grained token scoped to the kryton org).

### `package.json` dependencies

```json
{
  "dependencies": {
    "@azrtydxb/core": "4.3.2",
    "@azrtydxb/core-react": "4.3.2"
  }
}
```

Pinned to exact versions. `^` ranges are intentionally not used: consumers update deliberately, not on a `npm install` whim.

### Onboarding instructions for new developers

A `kryton-mobile/CONTRIBUTING.md` (and same for desktop later) documents:

1. Generate a GitHub PAT with `read:packages` scope.
2. Add to shell: `export GITHUB_TOKEN=ghp_...`.
3. `npm install`.
4. (Optional) `npm run dev:link` if working on `@azrtydxb/core` itself.

## Local development: path override

Day-to-day, library authors edit `@azrtydxb/core` and want changes to flow into their consumer (mobile, desktop) without a publish cycle.

### `dev:link` mechanism

`scripts/dev-link.js` in each consumer repo:

```js
// Pseudocode
function link() {
  const corePath = process.env.KRYTON_LOCAL_PATH ?? "../kryton/packages/core";
  const reactPath = process.env.KRYTON_LOCAL_PATH ?? "../kryton/packages/core-react";
  npmPkgSet(`dependencies.@azrtydxb/core`, `file:${corePath}`);
  npmPkgSet(`dependencies.@azrtydxb/core-react`, `file:${reactPath}`);
  exec("npm install");
  console.log("Linked. Run `npm run dev:unlink` to restore published versions.");
}

function unlink() {
  // Read versions from git history of package.json (last committed value)
  const lastCommittedPkg = exec("git show HEAD:package.json");
  const coreVer = JSON.parse(lastCommittedPkg).dependencies["@azrtydxb/core"];
  const reactVer = JSON.parse(lastCommittedPkg).dependencies["@azrtydxb/core-react"];
  npmPkgSet(`dependencies.@azrtydxb/core`, coreVer);
  npmPkgSet(`dependencies.@azrtydxb/core-react`, reactVer);
  exec("npm install");
}
```

A `.gitignore` rule warns developers not to commit linked `package.json`:

```
# Hooks check that package.json doesn't contain "file:" entries before allowing commit
```

A husky pre-commit hook in each consumer repo runs `node scripts/dev-link.js verify` and fails the commit if `package.json` contains `file:` references to `@azrtydxb/*`.

### Why not `npm link`?

`npm link` creates global symlinks that are invisible, persist across projects, and routinely cause "but it works on my machine" debugging sessions. The `file:` path override is local to one consumer's `package.json`, fully reversible, and visible in `git diff`.

### Why not a workspace-spanning monorepo (yarn workspaces / pnpm workspaces with kryton + kryton-mobile)?

Considered and rejected. The split was deliberate (separate release cadences, independent CI, mobile's app-store binary cycle is independent of server releases). Re-merging to make linking easier would lose those benefits.

## Token management

| Token | Holder | Scope | Lifecycle |
|---|---|---|---|
| `GITHUB_TOKEN` (Actions) | CI in `azrtydxb/kryton` | `packages: write` for that repo | Per-job, ephemeral |
| Developer PAT | Local dev environments | `read:packages` for `@azrtydxb` scope | Personal, rotated annually |
| Consumer CI tokens | `kryton-mobile`, `kryton-desktop` CI | `read:packages` | Stored as repo-level secret `GITHUB_TOKEN` |

Tokens are never embedded in source. `.npmrc` uses `${VAR}` interpolation (npm 8+).

## Migration from current state

There is no existing `@azrtydxb/core` package today. The first publish is the v1 release, post-implementation. Until then, mobile (and any pre-release desktop work) uses path links exclusively.

The first publish:

1. Bump root `package.json` to a fresh minor (e.g., `4.4.0`) signaling the architectural change.
2. Tag `v4.4.0`, push.
3. CI publishes `@azrtydxb/core@4.4.0` and `@azrtydxb/core-react@4.4.0`.
4. Consumer repos remove path-link dev state, pin to `4.4.0`.

## Testing strategy

- **Pre-publish dry run:** `scripts/publish-core.js --dry-run` runs all steps except actual publish.
- **Smoke install:** after publish, an integration job in `azrtydxb/kryton` creates a temp directory, sets up `.npmrc` with a freshly minted token, runs `npm install @azrtydxb/core@<latest>`, requires it, verifies the export shape.
- **Versioning consistency:** `scripts/verify-versions.js` runs in CI on every PR, fails if any workspace's version drifts from root.

## Out of scope for v1

- Independent semver per `@azrtydxb/*` package — all packages share monorepo version.
- Public npm registry. GitHub Packages only. Public release is a future decision.
- npm provenance signing — useful for public packages, less so for private.
- Breaking-change detection tooling (e.g., api-extractor). Will reconsider if/when consumer count grows.

## Risks

1. **GitHub Packages rate limits.** Free tier is generous for private repos but worth monitoring once desktop joins as a second consumer with its own CI install runs.
2. **Token rotation pain.** If a developer's PAT expires, `npm install` fails with a confusing 401. Mitigation: clear error in `CONTRIBUTING.md`, optional `scripts/check-token.js` that prints a friendly message.
3. **Pre-release / RC versions.** No current need but if we want to publish `4.5.0-rc.1` for testing, the CI workflow needs a small extension (publish under `next` dist-tag instead of `latest`). Deferred.

## Open implementation questions

1. Should the version-bump-and-tag flow be a manual step or triggered from a `release-please`-style automation? Manual for v1; revisit after a few releases.
2. Should `@azrtydxb/core` ship CommonJS + ESM, or ESM-only? ESM-only matches modern toolchains (Expo SDK 55, Vite, Tauri) and avoids the dual-package hazard. Decision: ESM-only with `"type": "module"`.
3. Where do shared TypeScript types live for *server-only* models (User, Session, etc.) — does a separate `@azrtydxb/server-types` package make sense? Probably not for v1; the server's API surface is Express + Zod schemas, types stay internal.
