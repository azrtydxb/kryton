# Full Dependency Upgrade Design

**Date:** 2026-03-23
**Scope:** Upgrade all dependencies to latest versions, replace incompatible libraries, modernize build tooling and CI.

## Goals

- Zero deprecated or outdated major versions across the project
- Latest Node.js LTS in CI and Docker
- Latest GitHub Actions versions
- Clean `npm audit` and no peer dependency warnings

## Non-Goals

- Feature changes or refactors beyond what's required for compatibility
- Adding new dependencies or capabilities
- Changing application behavior

---

## Phase 1: CI & Infrastructure

### Changes
- **Node.js in CI:** 22 → 24 (current LTS)
- **Dockerfile:** `node:20-alpine` → `node:24-alpine` (both builder and runtime stages)
- **GitHub Actions:** `docker/build-push-action@v5` → `@v6` (all others already at latest major)

### Files Modified
- `.github/workflows/ci.yml`
- `Dockerfile`

### Risk: Low
No application code changes. CI and Docker are independently testable.

---

## Phase 2: Vite & Tailwind

### Vite 6 → 8 + @vitejs/plugin-react 4 → 6
- Vite 8 uses Rolldown (replaces Rollup) and Oxc (replaces esbuild)
- Our `vite.config.ts` is simple (just react plugin + dev proxy) — no breaking changes
- `@vitejs/plugin-react` v6 uses Oxc instead of Babel — no config change needed

### Tailwind 3 → 4
Tailwind 4 moves to a CSS-first configuration model:

**Delete these files:**
- `packages/client/tailwind.config.js`
- `packages/client/postcss.config.js`

**Remove these dependencies:**
- `tailwindcss` (old PostCSS plugin)
- `autoprefixer` (Tailwind 4 handles vendor prefixes internally)
- `postcss` (no longer needed with Vite plugin approach)

**Add these dependencies:**
- `@tailwindcss/vite` (Vite plugin, replaces PostCSS integration)
- `tailwindcss` v4 (CSS engine, peer dep of the Vite plugin)

**Migrate `vite.config.ts`:**
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

**Migrate `globals.css`:**
Replace Tailwind directives and move theme config from JS to CSS:
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

- `darkMode: 'class'` is the default in Tailwind 4 — no config needed
- All `dark:` variant classes in components remain unchanged
- `@layer base`, `@layer components` blocks remain valid CSS
- `@apply` directive still works in Tailwind 4

### Files Modified
- `packages/client/vite.config.ts`
- `packages/client/src/styles/globals.css`
- `packages/client/package.json`
- Delete: `packages/client/tailwind.config.js`
- Delete: `packages/client/postcss.config.js`

### Risk: Medium
Tailwind 4 is the largest config migration. Custom colors and fonts must be carefully mapped to `@theme` variables. All existing utility classes remain compatible.

---

## Phase 3: ESLint 8 → 10 + Flat Config

### Changes
ESLint 10 requires flat config format. Replace `.eslintrc.json` files with `eslint.config.js`.

**Delete these files:**
- `packages/client/.eslintrc.json`
- `packages/server/.eslintrc.json`

**Create `packages/client/eslint.config.js`:**
```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
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

**Create `packages/server/eslint.config.js`:**
```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
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

**Update lint scripts** in both `package.json` files:
- `"lint": "eslint src"` (remove `--ext` flag, no longer supported)
- `"lint:fix": "eslint src --fix"`

**Dependency changes:**
- Remove: `eslint` v8, `@typescript-eslint/eslint-plugin` v7, `@typescript-eslint/parser` v7
- Add: `eslint` v10, `typescript-eslint` v8 (unified package), `@eslint/js`
- Client also: `eslint-plugin-react-hooks` v7, `eslint-plugin-react-refresh` v0.5

### Files Modified
- `packages/client/package.json`
- `packages/server/package.json`
- Create: `packages/client/eslint.config.js`
- Create: `packages/server/eslint.config.js`
- Delete: `packages/client/.eslintrc.json`
- Delete: `packages/server/.eslintrc.json`

### Risk: Medium
Flat config is a different format but the rules are equivalent. May surface new lint errors that need fixing.

---

## Phase 4: React 19 + Frontend Dependencies

### React 18 → 19
- `react` and `react-dom` → 19.x
- `@types/react` and `@types/react-dom` → 19.x
- `main.tsx` uses `createRoot` which is unchanged in React 19
- No class components, string refs, or deprecated APIs in the codebase

### lucide-react 0.469 → 0.577
- Does not officially list React 19 in peerDependencies yet
- Works at runtime — add `overrides` in root `package.json` to suppress warnings:
```json
{
  "overrides": {
    "lucide-react": {
      "react": "$react"
    }
  }
}
```

### react-markdown: stay on 9.x
- v10 does NOT support React 19
- Bump to latest 9.x (9.0.2+ has React 19 type fixes)
- rehype-highlight, rehype-raw, remark-gfm: bump to latest compatible versions

### Other frontend deps — bump to latest patch/minor:
- `@codemirror/*` packages: bump all to latest 6.x
- `@xyflow/react`: already compatible, bump to latest 12.x
- `@replit/codemirror-vim`: framework-agnostic, bump to latest
- `d3` + `@types/d3`: bump to latest 7.x
- `html2canvas`, `jspdf`: bump to latest

### Files Modified
- `packages/client/package.json`
- `package.json` (root — add overrides)

### Risk: Medium
React 19 is the riskiest single upgrade. Runtime testing needed to verify CodeMirror integration, xyflow canvas, and markdown preview all work correctly.

---

## Phase 5: Server Dependencies

### Express 4 → 5 + @types/express 4 → 5
- `express.json()` middleware unchanged
- Route definitions (`app.get`, `app.post`, etc.) unchanged
- `req.query` returns `undefined` for missing keys instead of `{}` — verify route handlers
- Path matching is stricter (no implicit optional trailing slashes)

### Other server deps:
- `@types/node` 20 → 25 (matches Node 24 runtime)
- `tsx` → latest 4.x
- `typescript` → latest 5.x (both client and server)

### Files Modified
- `packages/server/package.json`

### Risk: Low-Medium
Express 5 route behavior changes are minor. Server routes should be reviewed for `req.query` usage.

---

## Phase 6: Verification

After all upgrades:
1. `npm install` — clean install, no peer dep warnings
2. `npm run typecheck` — both packages pass
3. `npm run lint` — both packages pass (fix any new lint errors)
4. `npm run build` — both packages build successfully
5. `npm run dev` — manual smoke test:
   - Theme toggle works (light/dark/system)
   - Search bar dropdown appears and is clickable
   - Sidebar context menu works
   - Editor (CodeMirror + Vim mode) works
   - Markdown preview renders correctly
   - Graph view renders
   - Canvas view renders
6. Docker build succeeds locally

---

## Execution Order

Phases are ordered by dependency:
1. **Phase 1** (CI/Docker) — independent, no code impact
2. **Phase 2** (Vite/Tailwind) — must come before React upgrade (build tooling must work first)
3. **Phase 3** (ESLint) — independent of runtime deps, but easier to verify with working build
4. **Phase 4** (React 19 + frontend deps) — depends on Vite 8 working
5. **Phase 5** (Express + server deps) — independent of frontend
6. **Phase 6** (Verification) — after everything
