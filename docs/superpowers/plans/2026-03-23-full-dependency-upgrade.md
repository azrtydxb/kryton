# Full Dependency Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade all dependencies to latest major versions — React 19, Vite 8, Tailwind 4, ESLint 10, Express 5, Node 24 — with zero behavior changes.

**Architecture:** Six-phase sequential upgrade. Each phase produces a buildable/lintable state before the next begins. CI/infra first, then build tooling, then linting, then runtime deps (frontend, then backend), then full verification.

**Tech Stack:** React 19, Vite 8, Tailwind CSS 4, ESLint 10, Express 5, Node 24, TypeScript 5.9

**Spec:** `docs/superpowers/specs/2026-03-23-full-dependency-upgrade-design.md`

**Working directory:** All commands assume cwd is `/Users/pascal/Development/kryton` (repo root). Relative paths like `packages/client` are relative to this root.

---

## Task 1: CI & Dockerfile — Node 24 + Actions update

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `Dockerfile`

- [ ] **Step 1: Update CI node version**

In `.github/workflows/ci.yml`, change:
```yaml
          node-version: '22'
```
to:
```yaml
          node-version: '24'
```

- [ ] **Step 2: Update GitHub Action version**

In `.github/workflows/ci.yml`, change:
```yaml
        uses: docker/build-push-action@v5
```
to:
```yaml
        uses: docker/build-push-action@v6
```

- [ ] **Step 3: Update Dockerfile base images**

In `Dockerfile`, change both `FROM` lines:
```dockerfile
FROM node:20-alpine AS builder
```
to:
```dockerfile
FROM node:24-alpine AS builder
```

And:
```dockerfile
FROM node:20-alpine
```
to:
```dockerfile
FROM node:24-alpine
```

- [ ] **Step 4: Update Dockerfile npm install flag**

In `Dockerfile`, change:
```dockerfile
RUN npm install --production
```
to:
```dockerfile
RUN npm install --omit=dev
```

(`--production` is deprecated in npm 9+; `--omit=dev` is the modern equivalent)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml Dockerfile
git commit -m "chore: upgrade Node to 24 and docker/build-push-action to v6"
```

---

## Task 2: Vite 6 → 8 + Tailwind 3 → 4

**Files:**
- Modify: `packages/client/package.json`
- Modify: `packages/client/vite.config.ts`
- Modify: `packages/client/src/styles/globals.css`
- Delete: `packages/client/tailwind.config.js`
- Delete: `packages/client/postcss.config.js`

- [ ] **Step 1: Remove old deps, add new ones**

```bash
cd /Users/pascal/Development/kryton/packages/client
npm uninstall tailwindcss autoprefixer postcss
npm install -D tailwindcss@latest @tailwindcss/vite@latest vite@latest @vitejs/plugin-react@latest
```

- [ ] **Step 2: Delete old config files**

```bash
rm packages/client/tailwind.config.js packages/client/postcss.config.js
```

- [ ] **Step 3: Update vite.config.ts**

Replace the full content of `packages/client/vite.config.ts` with:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 4: Migrate globals.css**

In `packages/client/src/styles/globals.css`, replace the first three lines:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

With:
```css
@import "tailwindcss";

@theme {
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  --color-surface-50: #fafafa;
  --color-surface-100: #f5f5f5;
  --color-surface-200: #e5e5e5;
  --color-surface-300: #d4d4d4;
  --color-surface-700: #374151;
  --color-surface-800: #1f2937;
  --color-surface-850: #1a1f2e;
  --color-surface-900: #111827;
  --color-surface-950: #0d1117;
}
```

Keep ALL existing content below (the `@layer base`, `@layer components` blocks, CodeMirror overrides, markdown preview styles, etc.) **unchanged**.

- [ ] **Step 5: Verify build**

```bash
cd /Users/pascal/Development/kryton
npm run build
```

Expected: Both server and client build successfully. Fix any Tailwind 4 CSS compatibility issues if they arise (e.g., `@apply` with custom classes may need adjustment).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: upgrade Vite to 8, Tailwind to 4, remove PostCSS config"
```

---

## Task 3: ESLint 8 → 10 + Flat Config

**Files:**
- Modify: `packages/client/package.json`
- Modify: `packages/server/package.json`
- Create: `packages/client/eslint.config.js`
- Create: `packages/server/eslint.config.mjs`
- Delete: `packages/client/.eslintrc.json`
- Delete: `packages/server/.eslintrc.json`

- [ ] **Step 1: Swap ESLint deps in client**

```bash
cd /Users/pascal/Development/kryton/packages/client
npm uninstall eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-react-hooks eslint-plugin-react-refresh
npm install -D eslint@latest @eslint/js@latest typescript-eslint@latest eslint-plugin-react-hooks@latest eslint-plugin-react-refresh@latest
```

- [ ] **Step 2: Swap ESLint deps in server**

```bash
cd /Users/pascal/Development/kryton/packages/server
npm uninstall eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install -D eslint@latest @eslint/js@latest typescript-eslint@latest
```

- [ ] **Step 3: Create client flat config**

Create `packages/client/eslint.config.js`:
```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
);
```

- [ ] **Step 4: Create server flat config**

Create `packages/server/eslint.config.mjs` (`.mjs` because server has no `"type": "module"`):
```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
);
```

- [ ] **Step 5: Delete old config files**

```bash
rm packages/client/.eslintrc.json packages/server/.eslintrc.json
```

- [ ] **Step 6: Update lint scripts**

In `packages/client/package.json`, change:
```json
    "lint": "eslint src --ext .ts,.tsx --max-warnings 0",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
```
to:
```json
    "lint": "eslint src --max-warnings 0",
    "lint:fix": "eslint src --fix",
```

In `packages/server/package.json`, change:
```json
    "lint": "eslint src --ext .ts",
```
to:
```json
    "lint": "eslint src",
    "lint:fix": "eslint src --fix",
```

- [ ] **Step 7: Run lint and fix any errors**

```bash
cd /Users/pascal/Development/kryton
npm run lint
```

Expected: Both packages pass linting. If new rules surface errors, fix them. Common issues:
- `@typescript-eslint/no-require-imports` may fire on CommonJS patterns in server
- Rules may have been renamed between typescript-eslint v7 → v8

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: upgrade ESLint to 10 with flat config, typescript-eslint to 8"
```

---

## Task 4: React 19 + Frontend Dependency Upgrades

**Files:**
- Modify: `packages/client/package.json`
- Modify: `package.json` (root — add overrides)

- [ ] **Step 1: Upgrade React and types**

```bash
cd /Users/pascal/Development/kryton/packages/client
npm install react@latest react-dom@latest
npm install -D @types/react@latest @types/react-dom@latest
```

- [ ] **Step 2: Upgrade lucide-react**

```bash
cd /Users/pascal/Development/kryton/packages/client
npm install lucide-react@latest
```

- [ ] **Step 3: Add overrides to root package.json for peer dep warnings**

In the root `package.json`, add after the `"workspaces"` field:
```json
  "overrides": {
    "lucide-react": {
      "react": "$react"
    }
  },
```

- [ ] **Step 4: Upgrade react-markdown to latest 9.x**

```bash
cd /Users/pascal/Development/kryton/packages/client
npm install react-markdown@^9.1.0
```

Do NOT install v10 — it does not support React 19.

- [ ] **Step 5: Upgrade remaining frontend deps**

```bash
cd /Users/pascal/Development/kryton/packages/client
npm install @codemirror/autocomplete@latest @codemirror/commands@latest @codemirror/lang-markdown@latest @codemirror/language@latest @codemirror/search@latest @codemirror/state@latest @codemirror/theme-one-dark@latest @codemirror/view@latest @replit/codemirror-vim@latest codemirror@latest
npm install @xyflow/react@latest
npm install d3@latest rehype-highlight@latest rehype-raw@latest remark-gfm@latest
npm install html2canvas@latest jspdf@latest
npm install -D @types/d3@latest
```

- [ ] **Step 6: Verify typecheck and build**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run build
```

Expected: Both pass. Common React 19 type issues to watch for:
- `ReactNode` type changes — children prop may need explicit typing in some components
- `useRef` generic inference changes — `useRef<T>(null)` may need `useRef<T | null>(null)`

Fix any type errors that arise.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: upgrade React to 19, lucide-react, CodeMirror, and frontend deps"
```

---

## Task 5: Express 5 + Server Dependency Upgrades

**Files:**
- Modify: `packages/server/package.json`

- [ ] **Step 1: Upgrade Express and types**

```bash
cd /Users/pascal/Development/kryton/packages/server
npm install express@latest
npm install -D @types/express@latest
```

- [ ] **Step 2: Upgrade remaining server deps**

```bash
cd /Users/pascal/Development/kryton/packages/server
npm install cors@latest pg@latest typeorm@latest reflect-metadata@latest
npm install -D @types/cors@latest @types/node@latest tsx@latest typescript@latest
```

- [ ] **Step 3: Upgrade client TypeScript too**

```bash
cd /Users/pascal/Development/kryton/packages/client
npm install -D typescript@latest
```

- [ ] **Step 4: Verify server builds**

```bash
cd /Users/pascal/Development/kryton
npm run typecheck
npm run build
```

Expected: Both pass. Express 5 type changes to watch for:
- `@types/express` v5 may change `Request`/`Response` generics
- `req.query` already handles `undefined` in our code (`packages/server/src/routes/search.ts:10`)

Fix any type errors that arise.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: upgrade Express to 5, TypeScript to 5.9, and server deps"
```

---

## Task 6: Full Verification

- [ ] **Step 1: Clean install**

```bash
cd /Users/pascal/Development/kryton
rm -rf node_modules packages/client/node_modules packages/server/node_modules package-lock.json
npm install
```

Verify: No peer dependency warnings in output (other than expected lucide-react override).

- [ ] **Step 2: Run all checks**

```bash
npm run typecheck
npm run lint
npm run build
```

Expected: All three pass with zero errors.

- [ ] **Step 3: Check for vulnerabilities**

```bash
npm audit
```

Expected: `found 0 vulnerabilities`

- [ ] **Step 4: Check no outdated major versions remain**

```bash
npm outdated
```

Expected: No packages with a newer major version (react-markdown 9.x showing 10.x is expected and acceptable — documented incompatibility with React 19).

- [ ] **Step 5: Verify Docker build**

```bash
docker build -t kryton:test .
```

Expected: Build completes successfully with Node 24 base image.

- [ ] **Step 6: Commit any remaining fixes and push**

```bash
git add -A
git status
# Only commit if there are changes
git commit -m "chore: clean install verification and final fixes"
git push
```

- [ ] **Step 7: Verify CI passes**

```bash
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Expected: Build and docker jobs both pass.
