# Core Publishing Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the `@azrtydxb` npm scope on GitHub Packages with automated publish-on-tag, version-consistency enforcement, and developer ergonomics for path-based local development.

**Architecture:** Two empty-but-real npm packages (`packages/core/` and `packages/core-react/`) wired into the kryton monorepo's workspaces. A `publish-core` GitHub Actions workflow triggered on `v*` tags. A `dev-link.js` script that swaps consumer `package.json` between published and `file:` paths, gated by a husky pre-commit hook.

**Tech Stack:** GitHub Packages, GitHub Actions, npm 10, husky, Node 24, TypeScript 5.

**Spec:** [`docs/superpowers/specs/2026-04-30-core-publishing-design.md`](../specs/2026-04-30-core-publishing-design.md)

---

## File ownership

This plan is executed by a single agent; no parallel split. All files below are owned by this stream during Phase 0.

**Created:**
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/index.ts` (minimal real export — see PUB-3)
- `packages/core/README.md`
- `packages/core/LICENSE`
- `packages/core-react/package.json`
- `packages/core-react/tsconfig.json`
- `packages/core-react/src/index.ts`
- `packages/core-react/README.md`
- `packages/core-react/LICENSE`
- `tsconfig.base.json` (root)
- `.github/workflows/publish-core.yml`
- `scripts/publish-core.js`
- `scripts/verify-versions.js`
- `scripts/release.js`

**Modified:**
- `package.json` (root) — add scripts, ensure workspaces glob covers new packages

---

## Task PUB-1: Add tsconfig.base.json at the monorepo root

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Write the file**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 2: Verify it parses**

Run: `npx tsc --showConfig -p tsconfig.base.json | head -5`
Expected: prints the resolved config without error.

- [ ] **Step 3: Commit**

```bash
git add tsconfig.base.json
git commit -m "chore: add tsconfig.base for shared compiler options"
```

---

## Task PUB-2: Create `packages/core` package skeleton

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/README.md`
- Create: `packages/core/LICENSE`

- [ ] **Step 1: Write `packages/core/package.json`**

```json
{
  "name": "@azrtydxb/core",
  "version": "4.4.0-pre.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -b",
    "clean": "rm -rf dist",
    "test": "echo 'no tests yet' && exit 0"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  },
  "license": "see LICENSE"
}
```

- [ ] **Step 2: Write `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write minimal real `packages/core/src/index.ts`**

This is intentionally minimal but real (no stub comments). It exists so the package can build and publish.

```ts
export const KRYTON_CORE_VERSION = "4.4.0-pre.0";
```

- [ ] **Step 4: Write `packages/core/README.md`**

```markdown
# @azrtydxb/core

Offline-first data layer for Kryton clients. Schema generation from Prisma, sync, Yjs, and SQLite adapter abstractions.

This package is published to GitHub Packages under the `@azrtydxb` scope. See `docs/superpowers/specs/2026-04-30-kryton-core-design.md` for design.

## Status

Pre-release. APIs not stable until `4.4.0` final.

## License

Same as the Kryton project. See LICENSE in the kryton monorepo.
```

- [ ] **Step 5: Copy LICENSE from monorepo root**

Run: `cp LICENSE packages/core/LICENSE`
Expected: file copied; `ls packages/core/LICENSE` shows it.

- [ ] **Step 6: Verify package builds**

Run: `npm install && npm run build --workspace=packages/core`
Expected: produces `packages/core/dist/index.js` and `packages/core/dist/index.d.ts`. No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/ tsconfig.base.json
git commit -m "feat(core): initial @azrtydxb/core package with version constant"
```

---

## Task PUB-3: Create `packages/core-react` package skeleton

**Files:**
- Create: `packages/core-react/package.json`
- Create: `packages/core-react/tsconfig.json`
- Create: `packages/core-react/src/index.ts`
- Create: `packages/core-react/README.md`
- Create: `packages/core-react/LICENSE`

- [ ] **Step 1: Write `packages/core-react/package.json`**

```json
{
  "name": "@azrtydxb/core-react",
  "version": "4.4.0-pre.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -b",
    "clean": "rm -rf dist",
    "test": "echo 'no tests yet' && exit 0"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "peerDependencies": {
    "@azrtydxb/core": "4.4.0-pre.0",
    "react": ">=18"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  },
  "license": "see LICENSE"
}
```

- [ ] **Step 2: Write `packages/core-react/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/core-react/src/index.ts`**

```ts
export const KRYTON_CORE_REACT_VERSION = "4.4.0-pre.0";
```

- [ ] **Step 4: Write README and copy LICENSE**

```markdown
# @azrtydxb/core-react

React hooks for `@azrtydxb/core`. See the spec doc in the kryton monorepo.

## Status

Pre-release. APIs not stable until `4.4.0` final.
```

Run: `cp LICENSE packages/core-react/LICENSE`

- [ ] **Step 5: Verify build**

Run: `npm install && npm run build --workspace=packages/core-react`
Expected: produces `packages/core-react/dist/index.js`. No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core-react/
git commit -m "feat(core-react): initial @azrtydxb/core-react package"
```

---

## Task PUB-4: Update root package.json with build scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current root package.json**

Run: `cat package.json`
Expected: shows current root config.

- [ ] **Step 2: Add build/test scripts for core packages**

Edit `package.json`. Add to the `scripts` object:

```json
"build:core": "npm run build --workspace=packages/core --workspace=packages/core-react",
"test:core": "npm run test --workspace=packages/core --workspace=packages/core-react",
"verify-versions": "node scripts/verify-versions.js",
"release": "node scripts/release.js"
```

The full updated `scripts` block should now read:

```json
"scripts": {
  "dev": "npm run dev --workspace=packages/server & npm run dev --workspace=packages/client",
  "build": "npm run build --workspace=packages/server && npm run build --workspace=packages/client",
  "build:core": "npm run build --workspace=packages/core --workspace=packages/core-react",
  "lint": "npm run lint --workspace=packages/server && npm run lint --workspace=packages/client",
  "lint:fix": "npm run lint:fix --workspace=packages/server && npm run lint:fix --workspace=packages/client",
  "typecheck": "npm run typecheck --workspace=packages/server && npm run typecheck --workspace=packages/client",
  "test": "npm run test --workspace=packages/server --workspace=packages/client",
  "test:server": "npm run test --workspace=packages/server",
  "test:client": "npm run test --workspace=packages/client",
  "test:core": "npm run test --workspace=packages/core --workspace=packages/core-react",
  "verify-versions": "node scripts/verify-versions.js",
  "release": "node scripts/release.js",
  "prepare": "husky"
}
```

- [ ] **Step 3: Verify**

Run: `npm run build:core`
Expected: builds both `@azrtydxb/core` and `@azrtydxb/core-react`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add build:core and test:core scripts"
```

---

## Task PUB-5: Write `scripts/verify-versions.js`

**Files:**
- Create: `scripts/verify-versions.js`
- Test: manual verification (this is a CI utility script)

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const expected = root.version;

const packages = [
  "packages/core/package.json",
  "packages/core-react/package.json",
];

const mismatches = [];
for (const pkgPath of packages) {
  const pkg = JSON.parse(readFileSync(resolve(pkgPath), "utf8"));
  if (pkg.version !== expected) {
    mismatches.push({ pkgPath, name: pkg.name, version: pkg.version });
  }
}

if (mismatches.length > 0) {
  console.error(`Version mismatch: root is ${expected}.`);
  for (const m of mismatches) {
    console.error(`  ${m.name} (${m.pkgPath}) is ${m.version}`);
  }
  process.exit(1);
}

console.log(`All workspace versions match root: ${expected}`);
```

- [ ] **Step 2: Set executable bit**

Run: `chmod +x scripts/verify-versions.js`
Expected: file is now executable.

- [ ] **Step 3: Run it — should pass**

Run: `node scripts/verify-versions.js`
Expected: prints `All workspace versions match root: 4.3.2` (assuming root is `4.3.2` and the new packages are `4.4.0-pre.0`).

WAIT — root is `4.3.2`, packages are `4.4.0-pre.0`. This will fail. That's expected during the pre-release phase. Update root to match.

- [ ] **Step 4: Bump root version to match pre-release**

Edit `package.json` root: change `"version": "4.3.2"` to `"version": "4.4.0-pre.0"`.

- [ ] **Step 5: Re-run verify-versions**

Run: `node scripts/verify-versions.js`
Expected: prints `All workspace versions match root: 4.4.0-pre.0`. Exit 0.

- [ ] **Step 6: Negative test — break it deliberately**

Edit `packages/core/package.json` `"version"` to `"9.9.9"`.

Run: `node scripts/verify-versions.js`
Expected: prints `Version mismatch: root is 4.4.0-pre.0. ... @azrtydxb/core ... is 9.9.9`. Exit 1.

Restore `packages/core/package.json` to `"4.4.0-pre.0"`.

Re-run, confirm pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-versions.js package.json
git commit -m "chore: add verify-versions script and bump root to 4.4.0-pre.0"
```

---

## Task PUB-6: Write `scripts/release.js`

**Files:**
- Create: `scripts/release.js`

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+(-\w+(\.\d+)?)?$/.test(newVersion)) {
  console.error("Usage: node scripts/release.js <version>");
  console.error("Example: node scripts/release.js 4.4.0");
  process.exit(1);
}

function exec(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const dirty = exec("git status --porcelain");
if (dirty) {
  console.error("Working tree is dirty. Commit or stash first.");
  process.exit(1);
}

const branch = exec("git rev-parse --abbrev-ref HEAD");
if (branch !== "master") {
  console.error(`Releases must be cut from master. Current branch: ${branch}`);
  process.exit(1);
}

const packageFiles = [
  "package.json",
  "packages/core/package.json",
  "packages/core-react/package.json",
];

for (const file of packageFiles) {
  const path = resolve(file);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = newVersion;
  // Update peer dep on @azrtydxb/core inside core-react
  if (pkg.peerDependencies?.["@azrtydxb/core"]) {
    pkg.peerDependencies["@azrtydxb/core"] = newVersion;
  }
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`bumped ${file} → ${newVersion}`);
}

exec("npm install");
exec(`git add ${packageFiles.join(" ")} package-lock.json`);
exec(`git commit -m "chore(release): v${newVersion}"`);
exec(`git tag v${newVersion}`);

console.log(`\nv${newVersion} ready. Push with: git push origin master --tags`);
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/release.js`

- [ ] **Step 3: Smoke test (don't actually release)**

Run: `node scripts/release.js`
Expected: prints `Usage: ...`, exits 1.

Run: `node scripts/release.js abc`
Expected: prints `Usage: ...`, exits 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/release.js
git commit -m "chore: add release.js for version bumping and tagging"
```

---

## Task PUB-7: Write `scripts/publish-core.js`

**Files:**
- Create: `scripts/publish-core.js`

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
import { execSync } from "node:child_process";

function exec(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { encoding: "utf8", stdio: "inherit", ...opts });
}

const dryRun = process.argv.includes("--dry-run");

console.log("Step 1/5: verify versions match");
exec("node scripts/verify-versions.js");

console.log("Step 2/5: build core packages");
exec("npm run build:core");

console.log("Step 3/5: typecheck and test");
exec("npm run typecheck --workspace=packages/core --workspace=packages/core-react");
exec("npm run test:core");

console.log("Step 4/5: publish");
const publishCmd = dryRun
  ? "npm publish --workspace=packages/core --workspace=packages/core-react --dry-run"
  : "npm publish --workspace=packages/core --workspace=packages/core-react";
exec(publishCmd);

console.log(dryRun ? "Dry run complete." : "Publish complete.");
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/publish-core.js`

- [ ] **Step 3: Smoke test in dry-run mode**

Note: typecheck and test scripts in core packages don't exist yet. Add minimal ones first.

Edit `packages/core/package.json`, add to scripts: `"typecheck": "tsc --noEmit"`.
Edit `packages/core-react/package.json`, add same.

- [ ] **Step 4: Run dry-run**

Run: `node scripts/publish-core.js --dry-run`
Expected: passes verify-versions, builds, typechecks, tests (no-op), runs `npm publish --dry-run` (which prints what would be published without actually publishing).

- [ ] **Step 5: Commit**

```bash
git add scripts/publish-core.js packages/core/package.json packages/core-react/package.json
git commit -m "chore: add publish-core.js script and typecheck targets"
```

---

## Task PUB-8: Write `.github/workflows/publish-core.yml`

**Files:**
- Create: `.github/workflows/publish-core.yml`

- [ ] **Step 1: Write the workflow file**

```yaml
name: Publish @azrtydxb packages

on:
  push:
    tags:
      - "v*"

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
      - name: Install dependencies
        run: npm ci
      - name: Verify versions match
        run: node scripts/verify-versions.js
      - name: Typecheck core packages
        run: |
          npm run typecheck --workspace=packages/core
          npm run typecheck --workspace=packages/core-react
      - name: Test core packages
        run: npm run test:core
      - name: Build core packages
        run: npm run build:core
      - name: Publish to GitHub Packages
        run: npm publish --workspace=packages/core --workspace=packages/core-react
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Validate syntax**

Run: `npx --yes action-validator .github/workflows/publish-core.yml || cat .github/workflows/publish-core.yml | grep -c '^'`
Expected: action-validator passes (or if not installed, the file has expected line count).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-core.yml
git commit -m "ci: publish-core workflow triggered on v* tags"
```

---

## Task PUB-9: First real publish (manual claim of @azrtydxb scope)

This task is partially manual — the first publish establishes the scope on GitHub Packages and cannot be automated by CI before it exists.

**Files:** none (operational task)

- [ ] **Step 1: Verify GitHub PAT is configured**

Ensure `GITHUB_TOKEN` env var is set in the operator's shell with `write:packages` scope on the `azrtydxb` account.

Run: `echo "${GITHUB_TOKEN:?GITHUB_TOKEN must be set}" | head -c 4 && echo "..."`
Expected: prints first 4 chars of token. Confirms it's set.

- [ ] **Step 2: Configure local .npmrc for publish**

Run:
```bash
cat > ~/.npmrc.kryton-publish <<EOF
@azrtydxb:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
EOF
```

This is a temporary file used only for this manual publish; the CI uses a different mechanism.

- [ ] **Step 3: Run publish via the script with explicit npmrc**

Run: `npm_config_userconfig=~/.npmrc.kryton-publish node scripts/publish-core.js`
Expected: publishes both packages to `npm.pkg.github.com` under `@azrtydxb` scope. URLs printed: `https://github.com/azrtydxb/kryton/packages`.

- [ ] **Step 4: Verify on GitHub**

Open `https://github.com/azrtydxb?tab=packages` (or wherever GitHub displays packages for the org/account). Confirm `@azrtydxb/core@4.4.0-pre.0` and `@azrtydxb/core-react@4.4.0-pre.0` are listed.

- [ ] **Step 5: Clean up**

Run: `rm ~/.npmrc.kryton-publish`
Expected: temp file removed.

- [ ] **Step 6: No commit needed for this task** (operational)

---

## Task PUB-10: Add `dev-link.js` to `kryton-mobile`

**Files (in `kryton-mobile` repo):**
- Create: `kryton-mobile/scripts/dev-link.js`
- Create: `kryton-mobile/.npmrc`

- [ ] **Step 1: cd to kryton-mobile**

Run: `cd ../kryton-mobile && pwd`
Expected: `/Users/pascal/Development/Kryton/kryton-mobile`.

- [ ] **Step 2: Write `.npmrc`**

```
@azrtydxb:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

- [ ] **Step 3: Write `scripts/dev-link.js`**

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, isAbsolute } from "node:path";

const action = process.argv[2];
if (!["link", "unlink", "verify"].includes(action)) {
  console.error("Usage: node scripts/dev-link.js [link|unlink|verify]");
  process.exit(1);
}

const corePathInput = process.env.KRYTON_LOCAL_PATH ?? "../kryton/packages/core";
const reactPathInput = process.env.KRYTON_LOCAL_PATH
  ? `${process.env.KRYTON_LOCAL_PATH}-react`
  : "../kryton/packages/core-react";

const corePath = isAbsolute(corePathInput) ? corePathInput : resolve(corePathInput);
const reactPath = isAbsolute(reactPathInput) ? reactPathInput : resolve(reactPathInput);

const pkgFile = resolve("package.json");
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));

function deps() { return pkg.dependencies ?? (pkg.dependencies = {}); }

function isLinked() {
  const c = deps()["@azrtydxb/core"];
  const r = deps()["@azrtydxb/core-react"];
  return (c && c.startsWith("file:")) || (r && r.startsWith("file:"));
}

if (action === "verify") {
  if (isLinked()) {
    console.error("ERROR: package.json contains file: deps for @azrtydxb/*");
    console.error("Run `npm run dev:unlink` before committing.");
    process.exit(1);
  }
  console.log("OK: no file: deps for @azrtydxb/*");
  process.exit(0);
}

if (action === "link") {
  deps()["@azrtydxb/core"] = `file:${corePath}`;
  deps()["@azrtydxb/core-react"] = `file:${reactPath}`;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  execSync("npm install", { stdio: "inherit" });
  console.log(`Linked. core=${corePath} core-react=${reactPath}`);
  console.log("Run `npm run dev:unlink` to restore published versions.");
  process.exit(0);
}

if (action === "unlink") {
  // Read pristine versions from HEAD
  const headPkg = JSON.parse(execSync("git show HEAD:package.json", { encoding: "utf8" }));
  const coreVer = headPkg.dependencies?.["@azrtydxb/core"];
  const reactVer = headPkg.dependencies?.["@azrtydxb/core-react"];
  if (!coreVer || !reactVer) {
    console.error("Cannot find @azrtydxb/* deps in HEAD package.json");
    process.exit(1);
  }
  deps()["@azrtydxb/core"] = coreVer;
  deps()["@azrtydxb/core-react"] = reactVer;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  execSync("npm install", { stdio: "inherit" });
  console.log(`Unlinked. core=${coreVer} core-react=${reactVer}`);
}
```

- [ ] **Step 4: Make executable**

Run: `chmod +x scripts/dev-link.js`

- [ ] **Step 5: Add scripts to mobile's package.json**

Edit `kryton-mobile/package.json`, add to `scripts`:

```json
"dev:link": "node scripts/dev-link.js link",
"dev:unlink": "node scripts/dev-link.js unlink",
"dev:verify": "node scripts/dev-link.js verify"
```

Add to `dependencies`:

```json
"@azrtydxb/core": "4.4.0-pre.0",
"@azrtydxb/core-react": "4.4.0-pre.0"
```

- [ ] **Step 6: Test verify mode (should pass)**

Run: `node scripts/dev-link.js verify`
Expected: prints `OK: no file: deps for @azrtydxb/*`. Exit 0.

- [ ] **Step 7: Test install with the published packages**

Run: `GITHUB_TOKEN=$GITHUB_TOKEN npm install`
Expected: installs `@azrtydxb/core@4.4.0-pre.0` and `@azrtydxb/core-react@4.4.0-pre.0` from GitHub Packages.

If this fails with 401: confirm `GITHUB_TOKEN` is set with `read:packages` scope.

- [ ] **Step 8: Test link mode**

Run: `npm run dev:link`
Expected: rewrites package.json with `file:../kryton/packages/core` deps, runs `npm install`. Mobile's node_modules now points at local core build.

- [ ] **Step 9: Verify mode now fails**

Run: `npm run dev:verify`
Expected: prints `ERROR: package.json contains file: deps for @azrtydxb/*`. Exit 1.

- [ ] **Step 10: Test unlink mode**

Run: `npm run dev:unlink`
Expected: restores package.json to `4.4.0-pre.0` deps. Re-installs.

- [ ] **Step 11: Verify mode passes again**

Run: `npm run dev:verify`
Expected: OK exit 0.

- [ ] **Step 12: Commit (in kryton-mobile repo)**

```bash
cd /Users/pascal/Development/Kryton/kryton-mobile
git add scripts/dev-link.js .npmrc package.json package-lock.json
git commit -m "feat: dev-link.js for swapping @azrtydxb/* between published and file: deps"
git push origin master
```

---

## Task PUB-11: Husky pre-commit hook in `kryton-mobile` to block linked package.json

**Files (in `kryton-mobile` repo):**
- Create: `kryton-mobile/.husky/pre-commit`

- [ ] **Step 1: Check if husky is set up**

Run: `cat package.json | grep husky`
Expected: if no husky entry, install it: `npm install --save-dev husky && npx husky init`.

If already installed, continue.

- [ ] **Step 2: Write the pre-commit hook**

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

node scripts/dev-link.js verify
```

Save as `.husky/pre-commit`.

- [ ] **Step 3: Make executable**

Run: `chmod +x .husky/pre-commit`

- [ ] **Step 4: Test — commit while linked should fail**

Run:
```bash
npm run dev:link
git add package.json package-lock.json
git commit -m "test: should be blocked"
```
Expected: pre-commit hook fails with "ERROR: package.json contains file: deps for @azrtydxb/*". Commit aborted.

- [ ] **Step 5: Restore and verify normal commits work**

Run:
```bash
npm run dev:unlink
# git status — verify clean
git status
```

If package.json is now restored, no further changes; the previous test left a dirty state.

- [ ] **Step 6: Commit the hook**

```bash
git add .husky/pre-commit package.json
git commit -m "chore: pre-commit hook blocks @azrtydxb/* file: deps"
git push
```

---

## Task PUB-12: End-to-end verification

**Files:** none (verification task)

- [ ] **Step 1: From kryton monorepo, do a clean tag-driven publish**

Cd back to kryton: `cd /Users/pascal/Development/Kryton/kryton`.

Bump version to `4.4.0-pre.1` for verification:

Run: `node scripts/release.js 4.4.0-pre.1`
Expected: bumps all package.json files, commits, tags `v4.4.0-pre.1`. (No push yet.)

- [ ] **Step 2: Push and let CI publish**

Run: `git push origin master --tags`
Expected: pushes commit and tag.

Wait for the `Publish @azrtydxb packages` workflow run to complete on GitHub Actions.

- [ ] **Step 3: Verify packages were published**

Open: `https://github.com/azrtydxb?tab=packages`
Expected: `@azrtydxb/core@4.4.0-pre.1` and `@azrtydxb/core-react@4.4.0-pre.1` listed.

- [ ] **Step 4: From kryton-mobile, install the new version**

Run:
```bash
cd /Users/pascal/Development/Kryton/kryton-mobile
npm pkg set 'dependencies.@azrtydxb/core'='4.4.0-pre.1'
npm pkg set 'dependencies.@azrtydxb/core-react'='4.4.0-pre.1'
GITHUB_TOKEN=$GITHUB_TOKEN npm install
```
Expected: installs `4.4.0-pre.1` versions.

- [ ] **Step 5: Verify package contents**

Run: `cat node_modules/@azrtydxb/core/dist/index.js`
Expected: contains `export const KRYTON_CORE_VERSION = "4.4.0-pre.1";`.

- [ ] **Step 6: Commit version bump in mobile**

```bash
git add package.json package-lock.json
git commit -m "chore: bump @azrtydxb/core to 4.4.0-pre.1"
git push
```

- [ ] **Step 7: Phase 0 gate satisfied**

Confirm against the master phasing doc:
- [x] `@azrtydxb/core@4.4.0-pre.1` and `@azrtydxb/core-react@4.4.0-pre.1` published.
- [x] Mobile installs them via `.npmrc`.
- [x] `dev:link` swaps to local file paths.
- [x] Pre-commit hook blocks `file:` deps.

Phase 0 complete.

---

## Self-review

Run before declaring this plan complete:

- [ ] Every step contains the actual command, code, or file content the engineer needs.
- [ ] No "TODO" or "TBD" placeholders.
- [ ] Each task ends with an explicit commit.
- [ ] File paths are absolute or rooted at the monorepo / kryton-mobile.
- [ ] No reference to types or functions defined nowhere.
- [ ] Dev-link script handles the "user runs unlink with no committed pristine version" edge case (it reads from `HEAD`, which exists once any version is committed — first-time setup commits the initial state in PUB-10 step 12 before the hook would ever fire).
