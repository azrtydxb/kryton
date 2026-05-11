# Kryton UI redesign — implementation plan

**Status**: Implemented

**Goal:** rebuild every client screen against the design system in `design_handoff_kryton_redesign/README.md`. The README + `prototype/` files are the canonical spec.

**Tech stack:** existing — React 19, Vite 8, Tailwind v4, Zustand, TanStack Query, CodeMirror 6, lucide-react. No new state lib, no router change.

## Phases

### Phase A — Foundation (sequential, blocks B)

A1. Tokens + theme bootstrap
- New `packages/client/src/styles/tokens.css` lifted verbatim from prototype.
- Wire `data-theme` / `data-accent` / `data-density` on `<html>` from a Zustand store (`stores/prefsStore.ts`). Persist to localStorage.
- Wire `--font-mono` / `--font-sans` / `--font-display` from `fontPair` selection.
- Add Google Fonts links in `index.html`: JetBrains Mono, IBM Plex Mono, Inter, Instrument Serif.
- Defaults: `theme=dark, accent=violet, fontPair=jetbrains-inter, density=compact, layout=split, graphPosition=right`.

A2. Brand assets
- Replace `packages/client/public/icon.svg` + `logo.svg` with `prototype/ref/kryton_icon.svg` + `kryton_logo.svg`.
- Regenerate favicons + apple-touch + android-chrome from the new icon.

A3. Primitives
- Port `.mono`, `.kbd`, `.dot`, `.dot.pulse`, `.bg-grid` to `globals.css`.
- Port the prototype's icon set (`I.*`) into `packages/client/src/components/Icons.tsx`. Keep the same names; agents reference them.
- Port `data.jsx` mock data is **not** ported — production fetches via existing data hooks.

### Phase B — Screens (parallel agents, file-ownership scoped)

Each agent owns a distinct folder. Cross-references go through props or hooks already exported.

**B1. Login + Empty state** — `pages/LoginPage.tsx`, `components/Views/EmptyStateView.tsx`. Centred 380px card on `bg-grid`, mono eyebrow, accent radial behind. Empty state = keyboard-shortcut grid (Ctrl/Cmd-N, Ctrl/Cmd-K, etc.).

**B2. Command palette** — `components/QuickSwitcher/QuickSwitcher.tsx`. 560px modal, `>` mono prompt, AI-search hint row, sectioned results (Commands · Notes · Tags) with kbd hints.

**B3. Sidebar** — `components/Layout/SidebarLayout.tsx` + `components/Sidebar/*`. 260px wide, `var(--bg-1)`. Sections: brand row (40px), search (32px) with ⌘K hint, Quick actions, Favorites, Files (folder tree), Tags (chips). 28px footer with MCP pill + agents.

**B4. TopBar + EditorMeta** — `components/Layout/Header.tsx`, `components/StatusBar/StatusBar.tsx` (becomes EditorMeta). TopBar: 40px height, sidebar toggle + breadcrumb + theme toggle + ⌘K opener. EditorMeta: 28px, `wc · time · md · last saved Nm ago`.

**B5. Editor body** — `components/Views/EditModeView.tsx` + `PreviewModeView.tsx`. Tab strip 32px (active tab 2px accent border + saved-status pulse). Mode pills (Edit/Split/Preview, mono labels, accent-soft on active). Edit pane: monospace, line numbers, padding 24px 32px. Markdown render: per spec §"Markdown rendering". Backlinks rail in preview/split: `// linked from` mono uppercase.

**B6. Graph rail + fullscreen** — `components/Graph/GraphPanel.tsx` + `MobileGraphOverlay.tsx`. 340px side rail + fullscreen route. Header strip 38px with Local/Global toggle. SVG canvas with active node accent, ghosted off-set nodes, hover info card. Legend strip 28px.

**B7. All notes view** — `components/Views/EmptyStateView.tsx` (replaced when `view='all'`) → new `components/Views/AllNotesView.tsx`. Header 38px (inbox icon, title, count, list/grid toggle, sort). List rows: `20px icon | title+path | tags | wc | updated`. Grid: 220px-minmax cards.

### Phase C — Settings + integration

C1. Settings dialog. The `tweaks-panel` does NOT ship; surface the same options as a Settings dialog opened from the user menu.

C2. Plugin slots: re-wire `<PluginSlot>` placements. Sidebar accepts plugin sections under Tags. Editor toolbar slot remains. Status-bar slots re-route to EditorMeta.

C3. Visual rhythm sweep: every bottom rail = 28px height, all `var(--bg-1)`, all border-top `var(--line)`. Audit every screen.

C4. Lint + typecheck + tests.

## Out of scope (defer)
- ~~Floating Tweaks panel~~ (intentionally not ported per spec).
- Mock data — keep existing data hooks.
- New routing — keep the Zustand `view` state.
