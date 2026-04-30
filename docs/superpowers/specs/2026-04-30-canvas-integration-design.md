# Canvas Integration Design

**Date**: 2026-04-30
**Status**: Approved

## Problem

Mnemo has notes (markdown files) and a graph view (auto-derived from wikilinks). It does not have a way to lay notes out spatially, draw freeform arrows, or sketch structure visually — the kind of work users do in Obsidian Canvas, Heptabase, or Kinopio.

Adding a canvas-style surface as a separate sub-product would fragment the knowledge base: parallel storage, parallel sharing, parallel search, parallel mobile story. The goal is to integrate canvas seamlessly so canvases are first-class artifacts that share every piece of infrastructure with notes — no duplication of file model, sharing, search, or sync.

## Design

### Canvas as a File Type

A canvas is a `.canvas` file living alongside `.md` files in the per-user notes tree. Format conforms to the [JSON Canvas 1.0 spec](https://jsoncanvas.org) for full Obsidian interoperability — a canvas authored in Mnemo opens in Obsidian and vice versa with no data loss.

This means canvas inherits the entire file abstraction:

- Per-user isolation (`notesDir/<userId>/...`)
- Path-based sharing (`NoteShare` works on canvas paths unchanged)
- History snapshots (`historyService` snapshots before overwrite)
- File tree rendering (`.canvas` appears next to `.md` with a distinct icon)
- Path-based access checks (existing security guards apply)

No new core domain table for canvas content. The canvas IS the file.

### File Tree Treatment

`.canvas` files appear in the tree alongside `.md` files. Distinct icon. Default click behavior opens the canvas editor (analogous to clicking a `.md` opening the markdown editor). The "New" menu in the file tree gains a "New canvas" entry next to "New note" and "New folder."

### Edges Are Visual-Only

Arrows drawn between cards on a canvas are scoped to the canvas. They never enter `GraphEdge` and never appear in the global graph view or backlinks panel. This preserves the graph's meaning as a representation of *semantic* (wikilink-authored) relationships.

If a user wants a relationship to be globally visible, they add a wikilink in the note body — the standard mechanism.

### Contained-Note Backlinks

To keep canvases discoverable from the notes they contain, a small new index tracks containment:

```prisma
model CanvasContainment {
  id          String @id @default(uuid())
  canvasPath  String
  notePath    String
  userId      String
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([canvasPath, notePath, userId])
  @@index([userId, notePath])
  @@index([userId, canvasPath])
}
```

- Updated whenever a canvas is saved (parse JSON, list note-embed nodes, diff against previous index, write).
- Cleared when a canvas is deleted.
- Cleared/updated when a referenced note is renamed or deleted (hooks into existing rename/delete flows).
- Surfaced in the existing backlinks panel: notes display "Appears on canvases:" alongside their wikilink backlinks.

This is deliberately separate from `GraphEdge` so that canvases enrich navigation without polluting the link graph.

### Node Types

V1 supports the full JSON Canvas baseline:

| Type | Source | Renderer |
|------|--------|----------|
| `text` | inline markdown stored in the canvas JSON | markdown renderer (read mode) ↔ markdown editor (focused) |
| `file` (note) | reference to `.md` path in the notes tree | shared mounted markdown editor (see below) |
| `file` (image / PDF) | reference to image/PDF in the notes tree | image / PDF preview |
| `link` | external URL | `<iframe>` preview with sandbox restrictions, or fallback to title-only card |
| `group` | rectangular container | container that groups child nodes; drag moves children together |

All node types are registered through the same plugin slot mechanism (see Plugin Extensibility below). Built-in types are not special-cased — they register at app boot the same way a plugin would.

Nodes round-trip through serialization regardless of whether they render: a future spec-compliant node type added by a plugin will not be lost when the canvas is saved.

### Edit-In-Place Note Embeds

Clicking a note-embed card focuses an editor on that card. The editor is the same markdown editor used in the main editor route, mounted as a component bound to the same backing `.md` file.

- Read mode by default (rendered markdown). Editor mounts on focus.
- Multiple cards of the same note across different canvases share file state — edits in one card update all cards live (single-source-of-truth via the existing note state layer; no canvas-side caching).
- Save behavior matches main editor (debounced writes to disk).
- Only the focused card holds an editor instance. Other cards render markdown read-only. This bounds memory and CPU on canvases with many note embeds.

This requires extracting the existing markdown editor into a reusable component if it is currently route-coupled. The extraction is part of canvas v1 scope.

### Concurrency

Canvas concurrency matches note concurrency: last-write-wins on the file. Two users dragging different cards on the same shared canvas simultaneously will result in whoever saves last winning; the other's positional edits are lost.

This is a known limitation, accepted for v1. Realtime collaborative editing (CRDT-based) is filed as [#87](https://github.com/azrtydxb/mnemo/issues/87) and should land for notes and canvases together.

### Plugin Extensibility

A new slot is added to the existing client `PluginSlotRegistry`:

```ts
interface CanvasNodeRendererRegistration {
  type: string;                    // e.g. "kanban", "code-playground"
  pluginId: string;                // null for built-in
  component: ComponentType<{
    node: CanvasNode;
    canvasPath: string;
    readonly: boolean;
    onChange: (patch: Partial<CanvasNode>) => void;
  }>;
  defaultSize?: { width: number; height: number };
  toolbarLabel?: string;           // shown in canvas "Add node" menu
  toolbarIcon?: string;
}

class PluginSlotRegistry {
  // ...existing slots...
  registerCanvasNodeType(reg: CanvasNodeRendererRegistration): void;
  getCanvasNodeRenderer(type: string): CanvasNodeRendererRegistration | undefined;
  getCanvasNodeToolbarEntries(): CanvasNodeRendererRegistration[];
}
```

Built-in node renderers (`text`, `file`, `link`, `group`) register through this slot at app boot using a stable plugin id (e.g. `"core"`). Plugins register their own types using the same surface.

A canvas with a node of type `kanban` will render the kanban renderer if the kanban plugin is loaded; otherwise it renders a placeholder card showing the node type name and a tooltip (`This node type requires plugin "kanban"`). The node's data is preserved through serialization — disabling and re-enabling a plugin does not lose canvas content.

The client-side `ClientPluginAPI.ui` gains a corresponding registration method that delegates to the slot.

### Graph View → Canvas

The graph view gains lasso selection (drag to draw a rectangle, nodes inside become selected). With nodes selected, a "Create canvas from selection" button becomes available in the graph toolbar.

Click flow:

1. Path picker dialog ("Save canvas to: ___.canvas")
2. Server endpoint `POST /api/canvas/from-graph` receives `{ path, nodeIds, positions: { [id]: { x, y } } }`
3. Server reads each note's `noteId → notePath` mapping, constructs a JSON Canvas:
   - One `file` node per selected note, positioned per `positions`
   - One `link` edge for each `GraphEdge` whose endpoints are both in the selection
4. Server writes the `.canvas` file (existing security/path checks apply)
5. Client navigates to the canvas editor

Edges added by the promotion are real canvas edges (visual). They do not back-write into `GraphEdge` (those edges already exist as wikilinks — no duplication).

### Search

Each canvas indexes as one `SearchIndex` entry, scoped by user. Indexed content:

- Canvas filename / title
- All `text` node markdown content concatenated
- Titles (not bodies) of all note-embed nodes — bodies are already indexed under the notes themselves

A search hit on a canvas opens the canvas as a whole; per-card deep-linking is deferred to [#89](https://github.com/azrtydxb/mnemo/issues/89).

Reindexing hooks into the same path used for note saves (extension to `writeNote` / equivalent for `.canvas` files).

### Mobile

V1 is view-only on mobile. Mobile clients can:

- See `.canvas` files in the file tree
- Open a canvas (renders nodes, edges, groups)
- Tap a note-embed card → navigate to the underlying note (where mobile editing already works)
- Tap a text card → see its content in a simple read-only modal
- Create an empty canvas at a path (file-level operation)
- Delete a canvas (file-level operation)

Mobile cannot drag, resize, create non-empty canvases, or edit cards in place. The desktop-only authoring experience is intentional — see [#88](https://github.com/azrtydxb/mnemo/issues/88) for tablet full-edit parity.

### Sharing

Canvases share through the existing `NoteShare` table — path-based, identical to notes. Shared canvases:

- Render with the share badge in the file tree
- Honor the existing read/write permission level
- Honor existing access-request flow

Sharing a canvas does not implicitly share the notes embedded on it. If the recipient lacks access to an embedded note, that note's card renders as "No access" placeholder rather than failing the canvas open. This matches the existing behavior pattern (broken wikilink → broken-link styling, not error).

### History

Canvases get history snapshots on save through the existing `historyService.saveHistorySnapshot` extended to handle JSON content. Diff display in history view falls back to JSON-aware diff for canvases (vs. line-diff for markdown).

## Changes

| File / Area | Change |
|------|--------|
| `packages/server/prisma/schema.prisma` | Add `CanvasContainment` model |
| `packages/server/src/services/canvasService.ts` (new) | Read/write `.canvas` files, parse JSON Canvas, update `CanvasContainment` and `SearchIndex` indexes |
| `packages/server/src/services/noteService.ts` | File operations (rename, delete) update `CanvasContainment` references |
| `packages/server/src/services/searchService.ts` | Extend indexer to handle `.canvas` files |
| `packages/server/src/routes/canvas.ts` (new) | `POST /api/canvas/from-graph`, `GET /api/canvas/:path`, `PUT /api/canvas/:path`, etc. |
| `packages/server/src/services/historyService.ts` | Snapshot canvas files alongside notes |
| `packages/client/src/components/Canvas/` (new) | Canvas editor: viewport, pan/zoom, node renderers, edge renderers, drag/resize, edge drawing, lasso selection, group container, toolbar |
| `packages/client/src/components/Editor/` | Extract markdown editor into a reusable mount-anywhere component (used by main editor and by canvas note embeds) |
| `packages/client/src/components/Graph/GraphPanel.tsx` | Lasso selection, "Create canvas from selection" toolbar button |
| `packages/client/src/plugins/PluginSlotRegistry.ts` | Add `registerCanvasNodeType` slot |
| `packages/client/src/plugins/types.ts` | Add `CanvasNodeRendererRegistration` and corresponding `ClientPluginAPI.ui` method |
| `packages/client/src/components/Sidebar/` | "New canvas" menu entry; `.canvas` file icon |
| `packages/client/src/components/Backlinks/` | Show "Appears on canvases:" section sourced from `CanvasContainment` |
| `packages/mobile/app/...` | View-only canvas screen (renders JSON Canvas read-only); file tree shows `.canvas` files |

## Not Changing

- Existing graph view layout / behavior in non-canvas paths (only adds lasso + promotion button)
- `GraphEdge` schema or semantics (canvas edges do not flow into it)
- Wikilink parsing / authoring
- Note storage model
- Sharing / permissions model
- Plugin runtime architecture (only adds one slot type to the existing registry)
- Mobile editing of notes (unchanged)

## Deferred (filed)

- [#87](https://github.com/azrtydxb/mnemo/issues/87) — Realtime collaborative editing (CRDT) for notes and canvases
- [#88](https://github.com/azrtydxb/mnemo/issues/88) — Full canvas editing parity on tablets and large mobile screens
- [#89](https://github.com/azrtydxb/mnemo/issues/89) — Per-card search indexing with deep-link to node

## Open Items for Implementation Plan

These are deliberately not decided in the spec; the implementation plan should resolve:

- Specific JSON Canvas reader/writer library vs. hand-rolled parser
- Viewport / pan-zoom library (e.g. `react-flow`, `tldraw` primitives, or custom on top of SVG/canvas)
- Performance ceiling — measure node count at which the canvas degrades; document the limit
- Whether `link` nodes (URL embeds) use sandboxed iframes or render link-card previews only at v1
