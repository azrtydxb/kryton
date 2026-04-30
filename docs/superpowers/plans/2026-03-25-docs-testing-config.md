# Documentation, Testing & Configuration Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix documentation gaps, add CI test execution, configure coverage reporting, add linting improvements, and create missing docs.

**Architecture:** Update stale docs, add test infrastructure, configure ESLint rules, add pre-commit hooks, create CONTRIBUTING.md and plugin development guide.

**Tech Stack:** Vitest, ESLint, Husky, lint-staged, GitHub Actions

**Closes:** #25, #26, #32, #42, #43, #44, #45, #46 (partial)

**Independent of:** Plans 1-3 (mostly non-code changes, except CI and ESLint config).

---

## File Structure

### New Files
- `CONTRIBUTING.md` — Contributing guide
- `CHANGELOG.md` — Project changelog
- `docs/PLUGINS.md` — Plugin development guide
- `.editorconfig` — Editor formatting consistency

### Modified Files
- `.github/workflows/ci.yml` — Add test step, coverage
- `packages/server/vitest.config.ts` — Add coverage config
- `packages/client/vitest.config.ts` — Add coverage config
- `packages/server/eslint.config.mjs` — Add stricter rules
- `packages/client/eslint.config.js` — Add stricter rules
- `packages/server/tsconfig.json` — Re-enable strictPropertyInitialization
- `SPEC.md` — Rewrite or remove
- `README.md` — Add test commands, update architecture
- `package.json` — Add husky/lint-staged

---

### Task 1: Add test execution to CI pipeline (#26)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Read ci.yml**

Read `.github/workflows/ci.yml` fully.

- [ ] **Step 2: Add test step after lint**

In the `build` job, add after the lint step:

```yaml
      - name: Test
        run: npm run test
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add test execution to CI pipeline

Closes #26"
```

---

### Task 2: Add coverage configuration (#45)

**Files:**
- Modify: `packages/server/vitest.config.ts`
- Modify: `packages/client/vitest.config.ts`

- [ ] **Step 1: Install coverage provider**

```bash
npm install -D @vitest/coverage-v8 --workspace=packages/server
npm install -D @vitest/coverage-v8 --workspace=packages/client
```

- [ ] **Step 2: Read and update server vitest config**

Read `packages/server/vitest.config.ts`. Add coverage configuration:

```typescript
test: {
  globals: true,
  environment: "node",
  include: ["src/**/__tests__/**/*.test.ts"],
  coverage: {
    provider: "v8",
    reporter: ["text", "lcov"],
    include: ["src/**/*.ts"],
    exclude: ["src/generated/**", "src/**/__tests__/**"],
  },
}
```

- [ ] **Step 3: Read and update client vitest config**

Read `packages/client/vitest.config.ts`. Add similar coverage config:

```typescript
test: {
  globals: true,
  environment: "jsdom",
  include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
  setupFiles: ["./src/test-setup.ts"],
  coverage: {
    provider: "v8",
    reporter: ["text", "lcov"],
    include: ["src/**/*.{ts,tsx}"],
    exclude: ["src/**/__tests__/**"],
  },
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/vitest.config.ts packages/client/vitest.config.ts packages/server/package.json packages/client/package.json
git commit -m "feat: add vitest coverage configuration

Closes #45"
```

---

### Task 3: Add ESLint stricter rules (#44)

**Files:**
- Modify: `packages/server/eslint.config.mjs`
- Modify: `packages/client/eslint.config.js`

- [ ] **Step 1: Read server eslint config**

Read `packages/server/eslint.config.mjs`.

- [ ] **Step 2: Add stricter rules to server**

Add these rules to the server ESLint config:

```javascript
rules: {
  "no-console": "warn",
  "eqeqeq": ["error", "always"],
  "@typescript-eslint/no-non-null-assertion": "warn",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/consistent-type-assertions": ["warn", {
    assertionStyle: "as",
    objectLiteralTypeAssertions: "never",
  }],
},
```

Note: Start with `warn` for `no-console` and `no-non-null-assertion` since there are many existing violations. These can be escalated to `error` after the code quality plans fix the violations.

- [ ] **Step 3: Read and update client eslint config**

Read `packages/client/eslint.config.js`. Add similar rules, keeping `no-console` as `warn`:

```javascript
"no-console": "warn",
"eqeqeq": ["error", "always"],
"@typescript-eslint/no-explicit-any": "error",
```

- [ ] **Step 4: Verify lint passes (or document expected warnings)**

```bash
npm run lint 2>&1 | head -50
```

If there are too many warnings to fix immediately, that's OK — they're warnings not errors. The existing code will still pass CI.

- [ ] **Step 5: Commit**

```bash
git add packages/server/eslint.config.mjs packages/client/eslint.config.js
git commit -m "feat: add stricter ESLint rules (no-floating-promises, eqeqeq, no-explicit-any)

Closes #44 (partial)"
```

---

### Task 4: Re-enable strictPropertyInitialization (#44 partial)

**Files:**
- Modify: `packages/server/tsconfig.json`

- [ ] **Step 1: Read tsconfig.json**

Read `packages/server/tsconfig.json`.

- [ ] **Step 2: Remove the override**

Remove or set to true:

```json
"strictPropertyInitialization": true
```

- [ ] **Step 3: Check for compilation errors**

```bash
npm run typecheck --workspace=packages/server
```

If there are errors, fix them by adding initializers or `!` (definite assignment) where truly guaranteed. But prefer initializers.

- [ ] **Step 4: Commit**

```bash
git add packages/server/tsconfig.json
git commit -m "feat(server): re-enable strictPropertyInitialization in tsconfig"
```

---

### Task 5: Add .editorconfig and pre-commit hooks (#44 partial)

**Files:**
- Create: `.editorconfig`
- Modify: `package.json`

- [ ] **Step 1: Create .editorconfig**

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 2: Install husky and lint-staged**

```bash
npm install -D husky lint-staged
npx husky init
```

- [ ] **Step 3: Configure lint-staged in package.json**

Add to root `package.json`:

```json
"lint-staged": {
  "packages/**/*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write"
  ]
}
```

- [ ] **Step 4: Configure husky pre-commit hook**

```bash
echo "npx lint-staged" > .husky/pre-commit
```

- [ ] **Step 5: Commit**

```bash
git add .editorconfig .husky/ package.json
git commit -m "feat: add .editorconfig, husky pre-commit hooks, lint-staged

Closes #44 (partial)"
```

---

### Task 6: Rewrite SPEC.md (#32)

**Files:**
- Modify: `SPEC.md`

- [ ] **Step 1: Read current SPEC.md**

Read `SPEC.md` fully.

- [ ] **Step 2: Rewrite with current state**

Replace with an accurate specification reflecting the current multi-user app:

```markdown
# Kryton Technical Specification

## Overview

Kryton is a multi-user, web-based note-taking application with Markdown editing, knowledge graph visualization, note sharing, and an extensible plugin system.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 24+ |
| Language | TypeScript | 5.9+ |
| Backend | Express.js | 5.x |
| Database | PostgreSQL | 16 |
| ORM | Prisma | 7.x |
| Auth | better-auth | 1.5.x |
| Frontend | React | 19.x |
| Build | Vite | 8.x |
| CSS | Tailwind CSS | 4.x |
| State | Zustand + TanStack Query | 5.x |
| Editor | CodeMirror | 6.x |
| Graph | D3.js | 7.x |
| Search | MiniSearch | 7.x |

## Architecture

... (include updated architecture overview matching current codebase)

## API Endpoints

Link to Swagger docs at /api/docs for complete API reference.

## Database Schema

Link to prisma/schema.prisma for current schema.
```

Keep it concise — point to the code as the source of truth rather than duplicating it.

- [ ] **Step 3: Remove stale planning docs**

Delete `ALL_FEATURES.md` and `ENHANCEMENTS.md` since all items are completed and the docs serve no ongoing purpose.

- [ ] **Step 4: Commit**

```bash
git add SPEC.md
git rm ALL_FEATURES.md ENHANCEMENTS.md
git commit -m "docs: rewrite SPEC.md to reflect current multi-user architecture, remove stale planning docs

Closes #32"
```

---

### Task 7: Create CONTRIBUTING.md (#42)

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create contributing guide**

```markdown
# Contributing to Kryton

## Development Setup

### Prerequisites
- Node.js 24+
- PostgreSQL 16
- npm

### Quick Start

1. Clone the repository
2. Copy environment config: `cp .env.example packages/server/.env`
3. Edit `packages/server/.env` with your database URL and a strong `BETTER_AUTH_SECRET`
4. Install dependencies: `npm install`
5. Generate Prisma client: `npx prisma generate --schema=packages/server/prisma/schema.prisma`
6. Push schema to database: `npx prisma db push --schema=packages/server/prisma/schema.prisma`
7. Start development: `npm run dev`

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start server and client in development mode |
| `npm run build` | Build both packages for production |
| `npm run test` | Run all tests |
| `npm run lint` | Lint all packages |
| `npm run typecheck` | Type-check all packages |

## Code Style

- TypeScript strict mode
- ESLint with recommended rules
- 2-space indentation (see .editorconfig)
- Zod validation on all API request bodies
- Error propagation to centralized Express error middleware
- `requireUser(req)` instead of `req.user!`

## Pull Request Process

1. Create a feature branch from `master`
2. Make your changes with clear, focused commits
3. Ensure all checks pass: `npm run typecheck && npm run lint && npm run test && npm run build`
4. Open a PR against `master`
5. CI will run typecheck, lint, test, and build automatically

## Project Structure

See README.md for the architecture overview and directory structure.
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md with development setup and guidelines

Closes #42 (partial)"
```

---

### Task 8: Create plugin development guide (#42 partial)

**Files:**
- Create: `docs/PLUGINS.md`

- [ ] **Step 1: Read plugin type definitions**

Read `packages/server/src/plugins/types.ts` and `packages/client/src/plugins/types.ts` to understand the full plugin API.

- [ ] **Step 2: Create the plugin guide**

Document:
- Plugin directory structure (manifest.json, server/index.ts, client/index.ts)
- Manifest format (all fields from PluginManifest type)
- Plugin lifecycle (installed -> loaded -> active -> deactivating -> unloaded)
- Server API surface (notes, storage, events, http)
- Client API surface (registerPage, registerSidebarPanel, registerPostProcessor, registerEditorExtension)
- Available events
- UI slots
- Testing plugins locally
- Publishing to the registry

Base the documentation on the TypeScript interfaces — they are the source of truth.

- [ ] **Step 3: Commit**

```bash
git add docs/PLUGINS.md
git commit -m "docs: add plugin development guide

Closes #42 (partial)"
```

---

### Task 9: Create CHANGELOG.md (#42 partial)

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Review git history for major milestones**

```bash
git log --oneline --since="2026-03-01" | head -50
```

- [ ] **Step 2: Create changelog**

```markdown
# Changelog

All notable changes to Kryton are documented here.

## [3.0.0] - 2026-03-25

### Added
- Multi-user authentication with better-auth (email/password, OAuth, passkeys)
- Note sharing between users with read/readwrite permissions
- Admin panel for user management and invite codes
- Plugin ecosystem with server and client extension points
- Knowledge graph visualization with D3.js
- Full-text search with MiniSearch
- Daily notes, templates, and canvas features
- Per-user file isolation with UUID-based directories
- Rate limiting on API and auth endpoints
- Swagger API documentation

### Changed
- Migrated from TypeORM to Prisma ORM
- Migrated from single-user to multi-user architecture
- Upgraded to React 19, Express 5, Vite 8
- Replaced useState with Zustand store for UI state
- Added TanStack Query for server state management

### Security
- Added rehype-sanitize to prevent XSS in markdown rendering
- Added helmet for security headers
- Added WebSocket authentication
- Added path traversal protection across all file operations
- Added Zod validation on all API endpoints
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG.md with project history

Closes #42 (partial)"
```

---

### Task 10: Update README.md (#42 partial)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read README.md**

Read `README.md` fully.

- [ ] **Step 2: Add missing content**

Add to the Development section:

```markdown
### Running Tests

```bash
# Run all tests
npm run test

# Run server tests only
npm run test --workspace=packages/server

# Run client tests only
npm run test --workspace=packages/client

# Run tests with coverage
npm run test -- --coverage
```
```

Update the architecture diagram to include the plugin system and WebSocket.

Add a link to `docs/PLUGINS.md` for plugin development.

Add a link to `CONTRIBUTING.md` for contribution guidelines.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README with test commands, plugin system, and contributing link

Closes #42"
```
