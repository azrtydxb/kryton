# Docs and Branding Refresh — Implementation Plan

**Spec:** [`../specs/2026-05-20-docs-and-branding-refresh-design.md`](../specs/2026-05-20-docs-and-branding-refresh-design.md)

Five phases. Phases 1, 2, 4, 5 run in parallel; Phase 3 waits on 1 and 2.

---

## Phase 1 — Logo assets refresh

**Files**
- Replace: `kryton/logos/kryton_logo.svg`
- Replace: `kryton/logos/kryton_icon.svg`
- Replace: `kryton/logos/kryton_banner_dark.png`
- Replace: `kryton/logos/kryton_logo_transparent.png`
- Create: `kryton/scripts/build-logo-pngs.mjs`

**Steps**
1. Copy canonical SVGs in place:
   - `cp kryton-wp/theme/kryton/assets/logo.svg kryton/logos/kryton_logo.svg`
   - `cp kryton-wp/theme/kryton/assets/icon.svg kryton/logos/kryton_icon.svg`
2. Write `kryton/scripts/build-logo-pngs.mjs` — Node script using `sharp` (already a dep in kryton; verify) that:
   - Reads `kryton/logos/kryton_logo.svg`
   - Writes `kryton_banner_dark.png` (1200×400, background `#0d1117`, logo scaled to fit with 80px padding, accent recoloured to `#A78BFA`)
   - Writes `kryton_logo_transparent.png` (1024px wide, transparent background, accent `#A78BFA`)
3. Run the script: `node kryton/scripts/build-logo-pngs.mjs`. Expected output: "wrote 2 PNGs".
4. Verify each PNG opens in Preview.app and looks correct (no clipping, accent colour applied).
5. `git status` — confirm 4 logo files modified, 1 script added.

**Gate:** all 4 logo files updated, script idempotent on a second run.

---

## Phase 2 — Screenshot re-capture

**Files**
- Replace: `kryton/docs/screenshots/hero.png`
- Replace: `kryton/docs/screenshots/dashboard.png`
- Replace: `kryton/docs/screenshots/editor.png`
- Replace: `kryton/docs/screenshots/graph-view.png`
- Replace: `kryton/docs/screenshots/login.png`
- Replace: `kryton/docs/screenshots/mobile-preview.png`
- Replace: `kryton/docs/screenshots/note-preview.png`

**Setup**
- Dev server already running on `:5173`, plugins kanban + mermaid enabled, Skyport notes seeded, smoke@kryton.test signed in.

**Steps (Chrome DevTools MCP, executed by main agent — subagents don't have the tools)**

1. Open new page → navigate to `http://localhost:5173/` → set viewport 1440×900 → ensure dark theme.
2. **`login.png`** — sign out → wait for login page → screenshot.
3. Sign back in.
4. **`dashboard.png`** — navigate to all-notes view → wait → screenshot.
5. **`hero.png`** — open `Architecture.md` → enter Edit mode → set Split layout → wait for mermaid render in preview → screenshot.
6. **`editor.png`** — open `Sprint-Board.md` → Edit + Split → wait for kanban render → screenshot.
7. **`graph-view.png`** — navigate to graph view → wait for layout to settle (5s) → screenshot.
8. **`note-preview.png`** — open `Roadmap-2026.md` → Preview mode → scroll to mid-document → screenshot.
9. **`mobile-preview.png`** — set viewport 375×812 → navigate to `Architecture.md` in preview → screenshot.
10. Save all 7 as PNGs into `kryton/docs/screenshots/`, overwriting.

**Gate:** all 7 files updated, no console errors during capture, each image opens cleanly in Preview.app.

---

## Phase 3 — kryton core README + docs

**Files**
- Modify: `kryton/README.md`
- Modify: `kryton/CHANGELOG.md`
- Modify: `kryton/docs/PLUGINS.md`
- Light pass: `kryton/docs/{CLI,HELM,OPERATOR,API-ACCESS}.md` (no changes expected; verify only)

**Depends on:** Phases 1 and 2 complete.

**Steps**
1. Read current `kryton/README.md` end-to-end.
2. Swap hero `<img src="logos/kryton_banner_dark.png" …>` → `<img src="logos/kryton_logo.svg" …>` (keep dark/light `<source>` tags but point both to the SVG; SVG uses `currentColor` so it adapts).
3. Replace the hardcoded 12-plugin list with: a one-line description ("24 official plugins — see [the registry](https://github.com/azrtydxb/kryton-plugins#available-plugins)") plus a short "highlights" sentence naming kanban, mermaid, excalidraw, git-backup.
4. Remove vim-mode from the editor features list. Add one sentence under "Editor" describing the in-house editor (no external dependency).
5. Add a "What's new" or "Recent UI" subsection (3 bullets):
   - Tab strip with FIFO eviction at 4 tabs
   - Sidebar customization mode (move plugins L/R, reorder)
   - Inline per-plugin settings in the admin panel
6. Read `kryton/CHANGELOG.md`. Append a new entry for 2026-05-20 listing the user-visible changes since the last entry. Source: `git log --oneline --no-merges v4.6.5-pre.5..HEAD` in kryton, kryton-plugins. Synthesize, don't paste raw commit messages.
7. Read `kryton/docs/PLUGINS.md`. Cross-check against:
   - `kryton/packages/server/src/plugins/types.ts` (server `PluginAPI`)
   - `kryton-plugins/types/client.ts` (client `ClientPluginAPI`)
   For any namespace/slot in the types that isn't in the doc, add a short subsection (1–3 sentences + example). Especially: `api.notes.*`, `api.storage.*`, `api.editor.*`, `registerTopbarAction`, the `interactive` fence-renderer prop.
8. Skim CLI / HELM / OPERATOR / API-ACCESS. For each, run the most representative command in its first example and verify output still matches what's documented. If yes, no edit. If no, fix the example.

**Gate:** README renders cleanly (preview locally with `grip` if available, or just open in VS Code markdown preview). Plugin count is 24. No vim-mode references. CHANGELOG has a new entry. PLUGINS.md describes all live APIs.

---

## Phase 4 — kryton-plugins README + PLUGIN_API

**Files**
- Modify: `kryton-plugins/README.md`
- Modify: `kryton-plugins/docs/PLUGIN_API.md`
- Light pass: `kryton-plugins/docs/CONTRIBUTING.md`

**Steps**
1. Read `kryton-plugins/registry.json`. Build a markdown table from it: id, name, version, one-line description (pull from each `plugins/<id>/manifest.json` `.description` if registry entry doesn't have it).
2. Replace the existing plugin table in `kryton-plugins/README.md` with the generated one. Remove the vim-mode row (already removed from registry).
3. Read `kryton-plugins/docs/PLUGIN_API.md`. Add three new sections:
   - **`api.notes.*`** — list `getCurrent`, `read`, `write`, `replaceFenceAtRange`, `list`, etc. with signatures sourced from `kryton-plugins/types/client.ts`.
   - **`api.storage.*`** — list per-plugin KV store ops.
   - **`api.editor.*`** — list editor cursor / selection ops.
   - **UI slot: `registerTopbarAction`** — signature + example (the Upload icon button is a real-world reference).
   - **Code-fence renderer props** — describe the `interactive: boolean` flag; show kanban as the canonical example.
4. Read `kryton-plugins/docs/CONTRIBUTING.md`. Verify the `npm run …` commands match the current `package.json` scripts. Fix any drift.

**Gate:** Plugin table has exactly 24 rows. PLUGIN_API documents every namespace and slot present in the type definitions. CONTRIBUTING build commands run end-to-end (`npm test` passes).

---

## Phase 5 — kryton-wp content sweep

**Files**
- Sweep: `kryton-wp/theme/kryton/templates/*.html`
- Sweep: `kryton-wp/theme/kryton/parts/*.html`
- Sweep: `kryton-wp/theme/kryton/patterns/*.{html,php}`
- Possibly: `kryton-wp/theme/kryton/inc/*.php`, `functions.php`
- Light pass: `kryton-wp/README.md`

**Steps**
1. `grep -rni "vim\|12 plugin\|coderoom\|codemirror" kryton-wp/theme/kryton/{templates,parts,patterns,inc,functions.php}`. For each hit, decide:
   - Remove (if it referenced vim-mode)
   - Update (if it referenced a stale plugin count)
   - Keep (if a false positive)
2. `grep -rni "kryton" kryton-wp/theme/kryton/templates kryton-wp/theme/kryton/parts kryton-wp/theme/kryton/patterns` and scan for tagline/description rot. Update any prose that contradicts the current README's "shared brain for people and AI" positioning.
3. Read `kryton-wp/README.md`. Verify Kubernetes/ArgoCD instructions still match the current chart. If yes, no edit.

**Out of scope:** new pages, design changes, anything stored in the WordPress DB rather than the theme files.

**Gate:** No grep hits for removed features. Theme's user-visible copy is consistent with the kryton core README.

---

## Final verification

After all phases land:

1. `git status` across all three repos — review every changed file.
2. Render `kryton/README.md` and `kryton-plugins/README.md` in VS Code markdown preview. Check the hero loads, all wikilinks resolve, screenshots embed.
3. `git grep -E "kryton_banner_dark\\.png|kryton_logo_transparent\\.png"` across all repos — confirm only the new canonical PNGs are referenced (or no references at all if README uses SVG).
4. `git grep -i "vim-mode\|vim mode"` across all repos — should return ≤1 hit (a historical CHANGELOG line is fine).
5. Run `npm test` in `kryton-plugins`. Should be green.
6. Boot `kryton` dev server, sign in, smoke-test: tabs work, sidebar customization toggles, kanban + mermaid render. (Already in this state from earlier in the session — verify nothing regressed.)

## Execution

Phases 1, 4, 5 dispatched as parallel subagents (independent file scopes, no overlap). Phase 2 executed by main agent (Chrome DevTools MCP tools live in the main session). Phase 3 dispatched after 1+2 complete.

No commits during execution. After all five phases land, a single review pass and the user decides on commits per repo.
