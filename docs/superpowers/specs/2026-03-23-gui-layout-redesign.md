# GUI Layout Redesign

**Date:** 2026-03-23
**Scope:** Redesign the main app layout to make preview the default view, embed the graph as a persistent panel, and simplify the view mode system.

## Goals

- Notes always show in preview (rendered markdown) by default
- Knowledge graph is always visible alongside the note, not a modal overlay
- Editing is opt-in via an Edit button, which opens a split editor+preview
- Remove the editor/split/preview mode switcher from the header
- Remove the Canvas view entirely
- Outline pane moves into the right panel below the graph

## Non-Goals

- Changing the graph rendering logic (d3 canvas, force simulation)
- Changing the editor (CodeMirror) or preview (react-markdown) components
- Mobile layout changes (focus on desktop)
- Changing the sidebar, search, or quick switcher

---

## Layout States

### Default State (Preview Mode)

```
┌─────────────────────────────────────────────────────────┐
│  Header: Sidebar toggle | Logo | Search | [Edit] | ...  │
├────────┬──────────────────────────┬─────────────────────┤
│        │                          │  Graph (local/full) │
│ Side-  │   Preview (rendered MD)  │  ─ ─ ─ ─ ─ ─ ─ ─  │
│ bar    │                          │  Outline (headings) │
│        │──────────────────────────│                     │
│        │  Outgoing / Backlinks    │                     │
├────────┴──────────────────────────┴─────────────────────┤
│  Status bar                                             │
└─────────────────────────────────────────────────────────┘
```

- **Center:** Full-width preview of the active note with outgoing links and backlinks panels below
- **Right panel:** Graph (top, ~60% height) + Outline (bottom, ~40% height), stacked vertically
- **Header:** Edit button replaces the old editor/split/preview switcher. Other buttons (outline toggle removed — outline is now always in the right panel) remain.

### Edit State

```
┌─────────────────────────────────────────────────────────┐
│  Header: Sidebar toggle | Logo | Search | [Done] | ...  │
├────────┬────────────────────┬───────────────────────────┤
│        │                    │                           │
│ Side-  │   Editor (CM)      │   Preview (rendered MD)   │
│ bar    │                    │                           │
│        │────────────────────│                           │
│        │  Outgoing/Backlinks│                           │
├────────┴────────────────────┴───────────────────────────┤
│  Status bar                                             │
└─────────────────────────────────────────────────────────┘
```

- **Right panel (graph + outline) hides** to make room for the split view
- **Left half:** Editor with outgoing links and backlinks panels below
- **Right half:** Live preview
- **Header:** Edit button becomes a "Done" button (exits edit mode, returns to preview + graph)

---

## Component Changes

### App.tsx

**State changes:**
- Remove `viewMode` state (`'editor' | 'preview' | 'split'`)
- Add `editing` boolean state (default `false`)
- Remove `showGraph` state (graph is always visible when not editing)
- Remove `showCanvas` state
- Remove `outlineOpen` state (outline is always visible in the right panel)

**Header changes:**
- Remove the editor/split/preview segmented button
- Remove the Canvas button
- Remove the Outline toggle button
- Remove the Graph modal button
- Add an "Edit" / "Done" toggle button

**Layout changes:**
- When `editing === false`: render Preview (full width in main area) with outgoing links and backlinks below it + right panel (GraphPanel + OutlinePane)
- When `editing === true`: render Editor (left half) with outgoing links and backlinks below the editor + Preview (right half), no right panel. This matches the current split-mode behavior where backlinks/outgoing are siblings of the editor column.

### GraphView → GraphPanel

Refactor `GraphView` from a modal (`fixed inset-0 z-50`) to an inline panel component:
- Remove the modal wrapper, close button, and backdrop
- Remove the Escape key handler
- Keep all d3 canvas rendering, zoom/pan, node interaction logic
- Add `local/full` toggle (local = only direct connections of current note, full = all notes)
- Accept `activeNotePath` prop to center/highlight the current note
- `onNoteSelect` callback navigates to clicked node and highlights it in the graph
- Component resizes to fill its container (already uses ResizeObserver)

### New: GraphPanel wrapper

A thin wrapper around the refactored GraphView that adds:
- The header with "Graph" label and local/full toggle
- Sizing within the right panel

### OutlinePane

- Moves from a conditional right sidebar into the right panel, below the graph
- **Behavior change in preview mode:** In the current code, `handleOutlineJump` dispatches cursor movement to the CodeMirror editor. In preview (default) mode, there is no editor mounted. The outline must support two modes:
  - **Edit mode:** Jump to line in the editor (current behavior via `editorViewRef`)
  - **Preview mode:** Scroll to the corresponding heading in the preview pane. Implement by adding `id` attributes to rendered headings in the Preview component (e.g., `id="heading-{slug}"`), then `onJumpToLine` in preview mode calls `document.getElementById` and `scrollIntoView`
- This requires a small change to `OutlinePane` or `handleOutlineJump` to accept a mode-aware callback, and a small change to `Preview` to add heading IDs

### CanvasView — Full Removal

- Delete `packages/client/src/components/Canvas/CanvasView.tsx`
- Remove import and usage from App.tsx
- Remove `@xyflow/react` from `packages/client/package.json` (unused after Canvas deletion)
- Remove `LayoutDashboard` icon import from App.tsx (only used for Canvas button)
- **Follow-up cleanup (out of scope for this spec):** Server-side canvas routes (`packages/server/src/routes/canvas.ts`) and client API methods (`getCanvasList`, `getCanvas`, `saveCanvas`, `createCanvas`, `deleteCanvas` in `packages/client/src/lib/api.ts`, and `CanvasData` type) will be dead code. These can be cleaned up in a separate pass.

### Keyboard Shortcuts

- Remove `toggleOutline` shortcut (outline is always visible)
- Add `Ctrl+E` shortcut to toggle edit mode (Edit/Done)
- Keep other shortcuts unchanged

---

## Graph: Local vs Full Mode

**Local graph (default):**
- Shows only the active note and its direct connections (notes it links to + notes that link to it)
- API: Use existing `/api/graph` endpoint, filter client-side to only show nodes within 1 hop of the active note

**Full graph:**
- Shows all notes and connections (current behavior)
- Toggle via "Local" / "Full" buttons in the graph panel header

**Highlighting:**
- The active note's node is visually distinct (larger, different color)
- When clicking a node, navigate to that note — the graph re-centers on the new active note in local mode
- Centering on the active note requires programmatically setting the d3 zoom transform after the simulation settles (new logic, not just a prop)

**Data fetching:**
- Graph data is fetched once on mount and cached
- When the active note changes, re-filter the cached data for local mode (no re-fetch)
- Graph re-fetches when a note is created, deleted, or renamed (to pick up new links)

---

## Edge Cases

**No note selected:**
- Center area shows the existing empty state placeholder ("No note selected")
- Right panel shows the graph in full mode (no anchor for local mode) with outline empty
- Edit button is disabled / hidden when no note is selected

**No graph data (empty vault):**
- Graph panel shows "No notes yet" message (existing behavior)
- Outline shows "No headings" or is empty

---

## Files Modified

- `packages/client/src/App.tsx` — major rewrite of layout and state
- `packages/client/src/components/Graph/GraphView.tsx` — refactor from modal to inline panel
- Create: `packages/client/src/components/Graph/GraphPanel.tsx` — wrapper with header and local/full toggle
- Delete: `packages/client/src/components/Canvas/CanvasView.tsx`
- `packages/client/src/hooks/useKeyboardShortcuts.ts` — remove outline toggle, add Ctrl+E for edit toggle
- `packages/client/src/components/Preview/Preview.tsx` — add `id` attributes to rendered headings for outline scroll-to
- `packages/client/src/components/Outline/OutlinePane.tsx` — minor: accept mode-aware jump callback
- `packages/client/package.json` — remove `@xyflow/react`

## Files NOT Modified

- `packages/client/src/components/Editor/Editor.tsx`
- `packages/client/src/components/Sidebar/Sidebar.tsx`
- `packages/client/src/components/Search/SearchBar.tsx`
- `packages/client/src/components/Backlinks/BacklinksPanel.tsx`
- `packages/client/src/components/OutgoingLinks/OutgoingLinksPanel.tsx`
- Server code (no API changes needed — canvas route cleanup is a follow-up)
