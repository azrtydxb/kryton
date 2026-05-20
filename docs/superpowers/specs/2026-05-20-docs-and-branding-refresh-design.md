# Docs and Branding Refresh — Design

**Date:** 2026-05-20
**Scope:** `kryton`, `kryton-plugins`, `kryton-wp`

## Goal

Bring all user-facing documentation, screenshots, and logo usage across the three active Kryton repos into a consistent, current state. The canonical brand is the graph-glyph design already shipped in the running app and on the WordPress site; the only places using the obsolete gradient-K artwork are the asset files in `kryton/logos/` and the README hero that embeds them.

## Audit findings (evidence base)

The decisions below are driven by a read-only audit run on 2026-05-20 (see chat log). Key facts:

- **Canonical logo** is the 3-node graph-glyph rendered by `kryton/packages/client/src/components/Icons.tsx:262-283` (`Icons.Logo`) and `kryton-wp/theme/kryton/parts/header.html:8-18`. SVG sources: `kryton/packages/client/public/logo.svg`, `kryton-wp/theme/kryton/assets/logo.svg`, `kryton-wp/theme/kryton/assets/icon.svg`.
- **All four files** in `kryton/logos/` (`kryton_banner_dark.png`, `kryton_logo.svg`, `kryton_icon.svg`, `kryton_logo_transparent.png`) are the older gradient-K visual identity, no longer used anywhere in the running product.
- `kryton/README.md` is stale: lists "12 plugins" (registry has 24), still documents vim-mode as a built-in editor feature, embeds the obsolete banner.
- `kryton-plugins/README.md` lists vim-mode in its plugin table; vim-mode was removed in commit `ec42d67` on 2026-05-19.
- `kryton-plugins/docs/PLUGIN_API.md` does not document the `api.notes`, `api.storage`, `api.editor` namespaces or the `registerTopbarAction` slot (added during the recent plugin-completion work).
- Tab cap (4 max, FIFO), the sidebar customization mode, and the per-plugin inline settings panel are not documented anywhere user-facing.
- 7 screenshots in `kryton/docs/screenshots/` exist (`hero`, `dashboard`, `editor`, `graph-view`, `login`, `mobile-preview`, `note-preview`). User has confirmed re-capturing the same 7 against current UI.
- `kryton-wp` infrastructure README and theme metadata are fresh. Only the theme's user-facing content needs a content sweep (no logo work needed — it already uses the canonical glyph).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | README hero embeds the canonical SVG inline (GitHub renders SVG in `<img>`). | User-selected. Avoids generating a new PNG; SVG is colour-accurate and scales. |
| D2 | All four files in `kryton/logos/` are replaced with canonical-design artwork at the **same filenames**. | User-selected. Preserves any external links and forks that pulled raw URLs. Old gradient-K is fully retired. |
| D3 | Re-capture the existing 7 screenshots only — same filenames, no new shots. | User-selected. Minimizes doc churn (no `![]()` updates needed). New plugin views can land in a follow-up. |
| D4 | Screenshots taken against the seeded Skyport notes from earlier this session — coherent content, dense graph, kanban + mermaid plugins enabled. | The notes already exist on the dev server. Re-using them avoids capturing empty-state UI. |
| D5 | Dark theme for all screenshots. | Matches current app default and the WordPress site palette. |
| D6 | Spec + plan live in `kryton/docs/superpowers/{specs,plans}/` since that's where prior planning artefacts live. | Existing convention. The other two repos benefit but don't need their own plan files. |

## Logo asset architecture

All four obsolete files are replaced in place. Source of truth for the canonical art is the WP theme's `kryton-wp/theme/kryton/assets/`:

| File in `kryton/logos/` | New content | Source |
|---|---|---|
| `kryton_logo.svg` | Horizontal wordmark — graph-glyph + "kryton" text | Copy of `kryton-wp/theme/kryton/assets/logo.svg` |
| `kryton_icon.svg` | Icon-only graph-glyph | Copy of `kryton-wp/theme/kryton/assets/icon.svg` |
| `kryton_banner_dark.png` | Wordmark on dark background (1200×400 nominally) | Generated from the SVG with `rsvg-convert` or a one-shot Node script using `sharp`; dark background `#0d1117`, accent `#A78BFA` (oklch(0.72 0.18 295)) |
| `kryton_logo_transparent.png` | Wordmark on transparent background | Same source SVG, transparent canvas, 1024px wide |

PNG generation script lives at `kryton/scripts/build-logo-pngs.mjs` (new) and is idempotent — running it twice produces identical output.

## Documentation refresh — by repo

### kryton (main)

1. **`README.md`** — single coordinated rewrite:
   - Replace `<img src="logos/kryton_banner_dark.png" …>` with `<img src="logos/kryton_logo.svg" …>` (or the new banner PNG, if user prefers raster for OG/Twitter cards — see open question below).
   - Replace the inline "12 plugins" section with a generated list sourced from `kryton-plugins/registry.json` (or a short blurb plus a link to the plugin registry).
   - Remove vim-mode from the editor features list; mention it briefly in a "What's not included" or "Plugin ecosystem" sub-section if at all.
   - Add a short paragraph on the new UI affordances: tab strip (capped at 4, FIFO eviction), sidebar customization mode, inline plugin settings.
2. **`CHANGELOG.md`** — append entries for the 2026-05-18 → 2026-05-20 work that's already merged (tab cap, sidebar customization, plugin completion sweep, vim-mode removal). Pull commit messages with `git log --oneline v4.6.5..HEAD` and synthesize.
3. **`docs/PLUGINS.md`** — refresh plugin host capabilities to match the live `ClientPluginAPI` and `PluginAPI` (server) types, including the new namespaces and slots.
4. **`docs/{CLI,HELM,OPERATOR,API-ACCESS}.md`** — light pass only: confirm command outputs and example responses still match current CLI/operator/helm chart versions. No major rewrites expected based on audit.

### kryton-plugins

1. **`README.md`** — regenerate the plugin table from `registry.json`. Remove vim-mode. Verify each plugin's one-line description matches its `manifest.json`.
2. **`docs/PLUGIN_API.md`** — add three new sections covering `api.notes`, `api.storage`, `api.editor` namespaces, sourced from `kryton/packages/server/src/plugins/types.ts` and the client equivalents. Add `registerTopbarAction` to the UI slots reference. Add a "Code-fence renderer props" section documenting the `interactive` flag introduced for the kanban + mermaid plugins.
3. **`docs/CONTRIBUTING.md`** — refresh build/test commands if they've drifted from `package.json` scripts.

### kryton-wp (website)

1. **WordPress theme content** — sweep `templates/`, `parts/`, `patterns/` for any prose that references removed features (vim-mode), outdated plugin counts, or old logo art. The header already uses the canonical glyph, so no logo work expected — only copy edits.
2. **`README.md`** — confirm Kubernetes/ArgoCD/OpenBao deploy instructions still match the current chart values. Light pass.

Out of scope for this spec: changing the WordPress design, adding new pages, or touching the live site config. We update the theme sources in this repo only; deploy is the user's call.

## Screenshot refresh — shot list

Seven shots, all in dark theme, viewport 1440×900, taken via Chrome DevTools MCP against `http://localhost:5173` while logged in as `smoke@kryton.test`. Plugins enabled: **kanban** + **mermaid-diagrams** only (matches the state the user established earlier).

| File | Composition | Notes shown |
|---|---|---|
| `hero.png` | Editor split view (Edit + Preview), `Architecture.md` open with the mermaid diagram rendered in the preview pane | The full UI: sidebar, tabs, editor, preview, right rail |
| `dashboard.png` | All-notes view, sidebar expanded with Skyport folders | Folder tree + note list |
| `editor.png` | Split view, `Sprint-Board.md` open showing the kanban board renderer in the preview pane | Kanban plugin |
| `graph-view.png` | Fullscreen graph view of the Skyport notes (30 nodes, dense linking) | Wiki-link graph |
| `login.png` | Login page in dark theme | Branding + form |
| `mobile-preview.png` | Mobile responsive view (375×812 viewport) of the same editor+preview state as `hero.png` | Mobile layout |
| `note-preview.png` | Pure preview mode of `Roadmap-2026.md`, scrolled to show wikilinks and tags | Preview chrome |

All seven written to `kryton/docs/screenshots/<name>.png`, overwriting the existing files. The kryton-wp repo does not currently embed any of these — if that changes during the website sweep, we'll copy the same files into `kryton-wp/theme/kryton/assets/` rather than re-capturing.

## Phasing

Five phases, ordered by dependency, parallel-friendly where independent. Detailed steps live in the implementation plan; this section names the phases and their dependencies.

```
Phase 1: Logo assets refresh                ── independent
Phase 2: Screenshot re-capture              ── independent (needs dev server up + seeded notes)
Phase 3: kryton README + docs refresh       ── depends on Phase 1 (uses new SVG) and Phase 2 (links to new screenshots)
Phase 4: kryton-plugins README + PLUGIN_API ── independent of Phase 1/2 (no logo or screenshot embeds)
Phase 5: kryton-wp content sweep            ── independent of Phase 1 (theme already uses canonical logo)
```

Phases 1, 2, 4, 5 can run in parallel. Phase 3 waits for 1 and 2.

## Verification

Each phase has its own gates (see plan). Cross-cutting gate: when all phases are complete, the kryton-wp dev environment and the kryton dev server are both running, and a final visual review confirms:

- Both READMEs render correctly on GitHub (preview by pushing to a draft branch or rendering locally with `grip`).
- The 7 screenshots open in an image viewer without visible UI errors (no half-rendered tooltips, no dev overlay).
- `git grep` for the obsolete filenames returns no hits beyond the new canonical files themselves.

## Open questions

These do **not** block writing the plan, but I'll surface them again at the relevant phase if they aren't resolved before then:

- **OQ1** (Phase 1 / Phase 3): For social previews (GitHub OG image, Twitter card), an SVG in the README hero is not used — those scrapers want a PNG. Do we still want a high-res `kryton_banner_dark.png` (canonical art) for that purpose even though the README hero uses SVG? Default if no answer by Phase 3: yes, generate it.
- **OQ2** (Phase 5): The WP theme sweep is light by audit but I don't know if there's content stored in the WordPress database (page content, widgets) that the user expects updated too. The theme files are the only thing in this repo. Default if no answer by Phase 5: theme files only, leave DB-stored content alone.

## Non-goals

- New visual design for any logo or page.
- Adding new docs that don't exist today (only refreshing existing ones, with the exception of new PLUGIN_API sections directly mandated by the audit).
- Changing screenshot count or filenames.
- Touching the WordPress site's live deploy.
- Restructuring the docs folder hierarchy in any repo.
