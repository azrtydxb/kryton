# Client Code Quality Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix client-side code quality: decompose god components, unify state management, extract shared utilities, clean up dead code.

**Architecture:** Break AppContent into focused sub-components, migrate useNotes to TanStack Query, extract DataviewBlock and graph rendering, remove dead code.

**Tech Stack:** React 19, TypeScript, Zustand, TanStack Query, D3.js, CodeMirror 6

**Closes:** #28, #35, #40, #41, #46 (partial)

**Independent of:** Plans 1 and 2 (touches only client code).

---

## File Structure

### New Files
- `packages/client/src/lib/noteTreeUtils.ts` — Shared FileNode tree traversal
- `packages/client/src/lib/htmlUtils.ts` — HTML escaping utility (shared)
- `packages/client/src/components/Preview/DataviewBlock.tsx` — Extracted from Preview.tsx
- `packages/client/src/components/Preview/parseDataviewQuery.ts` — Extracted query parser
- `packages/client/src/components/Graph/useD3Graph.ts` — Extracted D3 logic from GraphView
- `packages/client/src/components/Graph/graphConfig.ts` — Graph visual constants

### Modified Files
- `packages/client/src/components/Preview/Preview.tsx` — Extract DataviewBlock, use shared utils
- `packages/client/src/components/Graph/GraphView.tsx` — Extract into custom hook + config
- `packages/client/src/components/Editor/Editor.tsx` — Use shared noteTreeUtils
- `packages/client/src/hooks/useNotes.ts` — Migrate to TanStack Query
- `packages/client/src/hooks/useNotesQuery.ts` — Absorb tree/activeNote, remove dead useUpdateStarred
- `packages/client/src/hooks/useAppState.ts` — Simplify selectors
- `packages/client/src/hooks/useAppCallbacks.ts` — Use store compound actions, remove dead code
- `packages/client/src/stores/uiStore.ts` — Clean up unused actions

---

### Task 1: Extract shared noteTreeUtils (#46 partial)

**Files:**
- Create: `packages/client/src/lib/noteTreeUtils.ts`

- [ ] **Step 1: Create the shared utility**

```typescript
import type { FileNode } from "./api";

/**
 * Collect all note names and paths from a file tree.
 * Returns a Set of lowercase note names and their paths (without .md extension).
 */
export function collectNoteNames(nodes: FileNode[]): Set<string> {
  const names = new Set<string>();
  for (const node of nodes) {
    if (node.type === "file" && node.name.endsWith(".md")) {
      const nameWithoutExt = node.name.replace(/\.md$/, "");
      names.add(nameWithoutExt.toLowerCase());
      const pathWithoutExt = node.path.replace(/\.md$/, "");
      names.add(pathWithoutExt.toLowerCase());
    }
    if (node.children) {
      for (const name of collectNoteNames(node.children)) {
        names.add(name);
      }
    }
  }
  return names;
}

/**
 * Collect all note paths (without extension) from a file tree.
 * Returns an array suitable for autocomplete.
 */
export function collectNotePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === "file" && node.name.endsWith(".md")) {
      paths.push(node.path.replace(/\.md$/, ""));
    }
    if (node.children) {
      paths.push(...collectNotePaths(node.children));
    }
  }
  return paths;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/lib/noteTreeUtils.ts
git commit -m "feat(client): extract shared noteTreeUtils for tree traversal"
```

---

### Task 2: Extract DataviewBlock from Preview.tsx (#41)

**Files:**
- Create: `packages/client/src/components/Preview/parseDataviewQuery.ts`
- Create: `packages/client/src/components/Preview/DataviewBlock.tsx`
- Modify: `packages/client/src/components/Preview/Preview.tsx`

- [ ] **Step 1: Read Preview.tsx fully**

Read `packages/client/src/components/Preview/Preview.tsx` fully to understand the DataviewBlock and parseDataviewQuery code.

- [ ] **Step 2: Create parseDataviewQuery.ts**

Extract the `parseDataviewQuery` function and its types into a separate file. Copy lines ~42-73 from Preview.tsx.

- [ ] **Step 3: Create DataviewBlock.tsx**

Extract the `DataviewBlock` component (lines ~75-198) into its own file, importing `parseDataviewQuery` from the new module.

- [ ] **Step 4: Update Preview.tsx**

Replace the inline DataviewBlock and parseDataviewQuery with imports:

```typescript
import { DataviewBlock } from "./DataviewBlock";
```

Also replace `collectNoteNames` with import from shared utils:

```typescript
import { collectNoteNames } from "../../lib/noteTreeUtils";
```

Remove the local `collectNoteNames` function.

- [ ] **Step 5: Verify build**

```bash
npm run build --workspace=packages/client
```

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/Preview/
git commit -m "refactor(client): extract DataviewBlock and parseDataviewQuery from Preview.tsx

Closes #41"
```

---

### Task 3: Extract GraphView D3 logic into custom hook (#40)

**Files:**
- Create: `packages/client/src/components/Graph/graphConfig.ts`
- Create: `packages/client/src/components/Graph/useD3Graph.ts`
- Modify: `packages/client/src/components/Graph/GraphView.tsx`

- [ ] **Step 1: Read GraphView.tsx fully**

Read `packages/client/src/components/Graph/GraphView.tsx` fully.

- [ ] **Step 2: Create graphConfig.ts with extracted constants**

```typescript
export const GRAPH_CONFIG = {
  // Simulation
  linkDistance: 100,
  chargeStrength: -200,
  collisionRadius: 30,

  // Node radii
  nodeRadius: { large: 10, medium: 8, small: 6 },

  // Star (favorited) nodes
  starInnerRadiusRatio: 0.4,

  // Labels
  fontSize: { primary: 12, secondary: 11 },
  labelTruncateLength: 20,
  labelMaxWidth: 18,
  labelOffset: 4,

  // Interaction
  hitTestRadiusSq: 100, // squared for performance

  // Colors
  colors: {
    link: { light: "#cbd5e1", dark: "#475569" },
    node: { light: "#3b82f6", dark: "#60a5fa" },
    active: { light: "#ef4444", dark: "#f87171" },
    starred: { light: "#f59e0b", dark: "#fbbf24" },
    shared: { light: "#8b5cf6", dark: "#a78bfa" },
    text: { light: "#1e293b", dark: "#e2e8f0" },
    bg: { light: "#ffffff", dark: "#0f172a" },
  },
} as const;
```

- [ ] **Step 3: Create useD3Graph.ts custom hook**

Extract the D3 simulation setup, draw function, and event handling from the 275-line useEffect into a custom hook:

```typescript
import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import { GRAPH_CONFIG } from "./graphConfig";
// ... types and interfaces

export function useD3Graph(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  nodes: GraphNode[],
  links: GraphLink[],
  options: {
    activeNoteId?: string;
    starredPaths?: Set<string>;
    isDark: boolean;
    onNodeClick?: (nodeId: string) => void;
  }
) {
  // Move the entire useEffect body here, broken into:
  // - setupCanvas(): DPI scaling, resize observer
  // - createSimulation(): D3 force simulation
  // - draw(): Canvas rendering
  // - setupInteraction(): Mouse/drag handlers
  // Return cleanup function
}
```

- [ ] **Step 4: Simplify GraphView.tsx**

Replace the 275-line useEffect with the custom hook call:

```typescript
import { useD3Graph } from "./useD3Graph";
import { GRAPH_CONFIG } from "./graphConfig";

export function GraphView({ ... }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useD3Graph(canvasRef, graphData.nodes, graphData.links, {
    activeNoteId: activeNote?.path,
    starredPaths: new Set(starredPaths),
    isDark,
    onNodeClick: handleNodeClick,
  });

  return <canvas ref={canvasRef} className="w-full h-full" />;
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build --workspace=packages/client
```

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/Graph/
git commit -m "refactor(client): extract D3 graph logic into useD3Graph hook with config constants

Closes #40"
```

---

### Task 4: Update Editor.tsx to use shared noteTreeUtils

**Files:**
- Modify: `packages/client/src/components/Editor/Editor.tsx`

- [ ] **Step 1: Read Editor.tsx**

Read `packages/client/src/components/Editor/Editor.tsx` fully.

- [ ] **Step 2: Replace local collectNotePaths with import**

```typescript
import { collectNotePaths } from "../../lib/noteTreeUtils";
```

Remove the local `collectNotePaths` function definition.

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=packages/client
```

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/Editor/Editor.tsx
git commit -m "refactor(client): use shared noteTreeUtils in Editor"
```

---

### Task 5: Clean up dead code and store inconsistencies (#46 partial)

**Files:**
- Modify: `packages/client/src/hooks/useNotesQuery.ts`
- Modify: `packages/client/src/hooks/useAppCallbacks.ts`
- Modify: `packages/client/src/stores/uiStore.ts`

- [ ] **Step 1: Read all three files**

Read each file fully.

- [ ] **Step 2: Remove dead useUpdateStarred from useNotesQuery.ts**

Delete the unused `useUpdateStarred` mutation hook (lines ~63-92). It's fully implemented but never imported anywhere.

- [ ] **Step 3: Use compound store actions in useAppCallbacks**

In `useAppCallbacks.ts`, replace manual edit state manipulation:

```typescript
// Before (manual):
setOriginalContent(content);
setEditContent(content);
setEditing(true);

// After (compound action):
const enterEditMode = useUIStore((s) => s.enterEditMode);
enterEditMode(content);
```

Similarly for `cancelEdit`.

- [ ] **Step 4: Fix fire-and-forget error swallowing**

Replace:
```typescript
api.updateSetting('starred', ...).catch(() => {})
```

With proper error handling:
```typescript
api.updateSetting('starred', ...).catch((err) => {
  console.error("[starred] Failed to persist:", err);
  // Revert optimistic update
  setStarredPaths(previousPaths);
});
```

- [ ] **Step 5: Verify build**

```bash
npm run build --workspace=packages/client
```

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/ packages/client/src/stores/
git commit -m "refactor(client): remove dead code, use compound store actions, fix error swallowing

Closes #46 (partial)"
```

---

### Task 6: Simplify useAppState Zustand selectors (#35)

**Files:**
- Modify: `packages/client/src/hooks/useAppState.ts`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Read both files**

Read `packages/client/src/hooks/useAppState.ts` and `packages/client/src/App.tsx` fully.

- [ ] **Step 2: Group related selectors into slices**

Instead of 32 individual selectors, group them:

```typescript
// Instead of 32 individual useUIStore calls:
const editorState = useUIStore((s) => ({
  editing: s.editing,
  editContent: s.editContent,
  originalContent: s.originalContent,
  cursorLine: s.cursorLine,
  cursorCol: s.cursorCol,
}));

const sidebarState = useUIStore((s) => ({
  sidebarWidth: s.sidebarWidth,
  sidebarOpen: s.sidebarOpen,
  setSidebarWidth: s.setSidebarWidth,
  setSidebarOpen: s.setSidebarOpen,
}));

// etc.
```

Note: This changes re-render behavior. Each grouped selector causes re-render when ANY value in the group changes. This is acceptable since `AppContent` already re-renders on every change. The real fix is Task 7 (breaking up AppContent), but this is a stepping stone.

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=packages/client
```

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hooks/useAppState.ts
git commit -m "refactor(client): group Zustand selectors into logical slices

Closes #35 (partial)"
```

---

### Task 7: Break up AppContent god component (#35)

**Files:**
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Identify extraction candidates**

The 223-line `AppContent` can be broken into:
- `MainEditor` — editor + preview area (subscribes to editor state)
- `AppModals` — all modal rendering (subscribes to modal state)
- `AppStatusBar` — status bar (subscribes to cursor/editing state)

Each sub-component subscribes to its own Zustand slice directly.

- [ ] **Step 2: Extract sub-components within App.tsx**

Start by extracting as components within the same file (to minimize risk), then move to separate files if desired:

```typescript
function AppModals() {
  const { showShareDialog, showAccessRequests, showQuickSwitcher, showTemplatePicker } = useUIStore((s) => ({
    showShareDialog: s.showShareDialog,
    showAccessRequests: s.showAccessRequests,
    showQuickSwitcher: s.showQuickSwitcher,
    showTemplatePicker: s.showTemplatePicker,
  }));
  // ... modal rendering only
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build --workspace=packages/client
```

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/App.tsx
git commit -m "refactor(client): decompose AppContent into focused sub-components

Closes #35"
```
