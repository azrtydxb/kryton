# Editor Plugin Migration & CM6 Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`).

**Goal:** Migrate every existing editor-decorating plugin and the kryton client off CodeMirror 6 onto the in-house `EditorView`, then remove all `@codemirror/*`, `codemirror`, `@replit/codemirror-vim`, and `y-codemirror.next` dependencies from the monorepo.

**Architecture:** Audit each call site that imports `@codemirror/*` and replace with `@azrtydxb/ui/editor`. The new editor's prop surface is intentionally narrower — anywhere a CM6 `Extension` is currently passed, identify whether it (a) emits decorations (port to `EditorPlugin.decorations`), (b) defines commands (port to `EditorPlugin.commands`), (c) provides autocomplete (port to `EditorPlugin.suggestions`), or (d) is unsupported (vim mode, multi-cursor — document the gap and remove the call site).

**Tech Stack:** TypeScript. Depends on every prior editor sub-plan landing first.

**Spec:** [`docs/superpowers/specs/2026-05-08-editor-cross-platform.md`](../specs/2026-05-08-editor-cross-platform.md)

**Depends on:** [`2026-05-08-editor-state-core.md`](./2026-05-08-editor-state-core.md), [`2026-05-08-editor-yjs-binding.md`](./2026-05-08-editor-yjs-binding.md), [`2026-05-08-editor-web-view.md`](./2026-05-08-editor-web-view.md)

---

## File ownership

- `packages/client/src/components/Editor/Editor.tsx` (modify)
- `packages/client/src/components/Editor/EditorToolbar.tsx` (modify)
- `packages/client/src/components/Views/EditModeView.tsx` (modify)
- `packages/client/src/hooks/useAppState.ts` (modify)
- `packages/client/src/plugins/types.ts` (modify)
- `packages/client/src/App.tsx` (modify — drops CM6 `Extension` import)
- `packages/client/package.json` (modify — drop CM deps)
- `packages/ui/package.json` (modify — drop CM deps)
- `packages/ui/src/**` (modify — any remaining CM6 references)

Out of scope: native iOS/Android views (already migrated by prior sub-plans); plugins outside the editor decoration path.

---

## Task EM-1: Inventory CM6 import sites

**Files:** none modified — investigation only.

- [ ] **Step 1: List every CM6 import**

Run: `grep -rn "from ['\"]@codemirror\\|from ['\"]codemirror\\|from ['\"]@replit/codemirror-vim\\|from ['\"]y-codemirror" packages/client/src packages/ui/src 2>/dev/null > /tmp/cm6-sites.txt && cat /tmp/cm6-sites.txt`
Expected: a complete file:line list. Save it.

- [ ] **Step 2: Categorise each site by replacement strategy**

For each line, write one of: **`replace`** (import from `@azrtydxb/ui/editor`), **`port`** (file is a plugin — port to `EditorPlugin`), **`drop`** (vim/multi-cursor: remove the call site), **`infra`** (toolbar undo/redo etc., wire to the new history).

Save categorisation as `notes/cm6-migration-inventory.md` (committed for the record).

- [ ] **Step 3: Commit the inventory**

```bash
git add notes/cm6-migration-inventory.md
git commit -m "docs(editor): CM6 import-site inventory and migration categorisation"
```

---

## Task EM-2: Update `plugins/types.ts` to use `EditorPlugin`

**Files:**
- Modify: `packages/client/src/plugins/types.ts`

- [ ] **Step 1: Replace the CM6-typed plugin contract**

```ts
// packages/client/src/plugins/types.ts
import type { EditorPlugin } from "@azrtydxb/ui/editor";

export type KrytonEditorPlugin = EditorPlugin;
// ...keep any non-editor plugin types unchanged.
```

- [ ] **Step 2: Run typecheck on the client**

Run: `cd packages/client && npx tsc --noEmit`
Expected: errors ONLY at remaining call sites — those are the next tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/plugins/types.ts
git commit -m "refactor(client/plugins): re-export EditorPlugin from new editor"
```

---

## Task EM-3: Migrate the Editor component

**Files:**
- Modify: `packages/client/src/components/Editor/Editor.tsx`

- [ ] **Step 1: Replace the CM6 mount with EditorView**

Replace the existing CM6 setup (loading state, extensions array, `useCodeMirror` or equivalent) with:

```tsx
// packages/client/src/components/Editor/Editor.tsx
import { EditorView, type EditorPlugin, type EditorState } from "@azrtydxb/ui/editor";

export interface EditorProps {
  initialDoc: string;
  plugins?: readonly EditorPlugin[];
  onChange?: (state: EditorState) => void;
  onWikilinkClick?: (target: string) => void;
  className?: string;
}

export function Editor(props: EditorProps) {
  return (
    <EditorView
      initialDoc={props.initialDoc}
      plugins={props.plugins}
      onChange={props.onChange}
      onWikilinkClick={props.onWikilinkClick}
      className={props.className ?? "kryton-editor"}
    />
  );
}
```

> Remove the `EditorView` type import from `@codemirror/view` and the `Extension` import from `@codemirror/state`. If the previous component owned a `EditorView | null` ref, replace its consumers (toolbar, hotkeys) with the props-driven API or with `useImperativeHandle` exposing `state`/`dispatch`.

- [ ] **Step 2: Run client typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: errors only at toolbar / EditModeView / hooks — addressed next.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Editor/Editor.tsx
git commit -m "refactor(client/Editor): mount @azrtydxb/ui EditorView in place of CM6"
```

---

## Task EM-4: Migrate EditorToolbar (undo/redo)

**Files:**
- Modify: `packages/client/src/components/Editor/EditorToolbar.tsx`

- [ ] **Step 1: Replace `undo`/`redo` from `@codemirror/commands`**

Switch the toolbar to drive undo/redo through the new editor's history. Two paths — pick one based on how the toolbar is wired to the editor today:

(a) If toolbar receives an `EditorView` ref: change to a `History` ref or callbacks `onUndo` / `onRedo` exposed by `<EditorView>`. (Update `EditorView` props to expose them — already foreseen in the web-view plan.)

(b) If toolbar dispatches keyboard shortcuts: rely on the `Cmd-Z` / `Cmd-Shift-Z` handling already in `EditorView.web.tsx` — remove the toolbar imports entirely.

Concrete change:

```tsx
// packages/client/src/components/Editor/EditorToolbar.tsx
// REMOVE:
//   import type { EditorView } from "@codemirror/view";
//   import { undo, redo } from "@codemirror/commands";

import type { Selection } from "@azrtydxb/ui/editor";

interface ToolbarProps {
  onCommand: (id: "undo" | "redo" | "bold" | "italic" | "wikilink") => void;
  selection?: Selection;
}

// Buttons call onCommand("undo") etc.; the parent wires this to the editor's
// history (EditorView exposes onUndo/onRedo as callbacks the parent supplies).
```

- [ ] **Step 2: Run client typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: errors reduced; only EditModeView and useAppState remain.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Editor/EditorToolbar.tsx
git commit -m "refactor(client/EditorToolbar): drop CM6 undo/redo, use command callbacks"
```

---

## Task EM-5: Migrate EditModeView

**Files:**
- Modify: `packages/client/src/components/Views/EditModeView.tsx`

- [ ] **Step 1: Drop the CM6 imports and pass `EditorPlugin[]`**

Replace the `Extension` array assembly (`const extensions = [oneDark, markdown(), …]`) with `EditorPlugin[]`:

```tsx
// packages/client/src/components/Views/EditModeView.tsx
// REMOVE:
//   import { Extension } from "@codemirror/state";
//   import { EditorView } from "@codemirror/view";

import { Editor } from "../Editor/Editor";
import type { EditorPlugin } from "@azrtydxb/ui/editor";

const plugins: readonly EditorPlugin[] = [
  // Concrete plugins are added in EM-7. For now: empty list — the markdown
  // parser already runs inside EditorView via emitDecorations.
];

export function EditModeView({ initialDoc, onChange }: { initialDoc: string; onChange?: (doc: string) => void }) {
  return <Editor initialDoc={initialDoc} plugins={plugins} onChange={(s) => onChange?.(s.doc)} />;
}
```

- [ ] **Step 2: Run client typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: only `useAppState.ts` and `App.tsx` remain.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Views/EditModeView.tsx
git commit -m "refactor(client/EditModeView): switch from CM6 Extensions to EditorPlugin[]"
```

---

## Task EM-6: Migrate useAppState + App.tsx

**Files:**
- Modify: `packages/client/src/hooks/useAppState.ts`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Drop CM6 `EditorView`/`Extension` imports**

In `useAppState.ts`: any `EditorView` ref becomes either a `EditorState` snapshot ref (for read access) or callback-driven communication. Concretely:

```ts
// packages/client/src/hooks/useAppState.ts
// REMOVE: import { EditorView } from "@codemirror/view";

import type { EditorState } from "@azrtydxb/ui/editor";

interface AppState {
  // ...
  editorState: EditorState | null;
  setEditorState: (s: EditorState) => void;
}
```

In `App.tsx`: drop `import type { Extension } from '@codemirror/state'` and any `extensions` array threaded through. Pass `plugins` instead, defaulting to `[]`.

- [ ] **Step 2: Run client typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run client tests**

Run: `cd packages/client && npm test`
Expected: PASS — adjust any tests that mocked CM6 to mock `@azrtydxb/ui/editor` instead.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hooks/useAppState.ts packages/client/src/App.tsx
git commit -m "refactor(client): drop CM6 types from app state and App entry"
```

---

## Task EM-7: Port concrete plugins

**Files:** depend on the inventory from EM-1. Typical sites:
- Modify: each `packages/client/src/plugins/<plugin>/*.ts` that previously exported a CM6 `Extension`

- [ ] **Step 1: Per plugin, port to `EditorPlugin`**

Pattern: a CM6 plugin that emitted decorations via `ViewPlugin.fromClass(class { ... update(u) { … } decorations = … })` becomes:

```ts
// example: packages/client/src/plugins/wikilink-decorator/index.ts
import type { EditorPlugin, EditorState, DecorationSpec } from "@azrtydxb/ui/editor";

export const wikilinkDecorator: EditorPlugin = {
  name: "wikilink-decorator",
  decorations(state: EditorState): DecorationSpec[] {
    const out: DecorationSpec[] = [];
    state.tree.iterate({
      enter: (node) => {
        if (node.name === "WikiLink") {
          out.push({ from: node.from, to: node.to, kind: "wikilink" });
        }
      },
    });
    return out;
  },
};
```

CM6 commands → `EditorPlugin.commands` (a record mapping command name → `(state) => Transaction`).

CM6 autocomplete → `EditorPlugin.suggestions(state, trigger)` returning a `Promise<Suggestion[]>`.

CM6 vim mode plugin: **drop** — no v1 replacement; remove the import and the user-facing toggle.

- [ ] **Step 2: Per plugin, write a small unit test**

For each plugin, the test exercises its `decorations`, `commands`, or `suggestions` against a fixture `EditorState`. Use `createEditorState` from `@azrtydxb/ui/editor` to build fixtures.

- [ ] **Step 3: Wire ported plugins into `EditModeView` plugin list**

Update `packages/client/src/components/Views/EditModeView.tsx`'s `plugins` array to import and include each ported plugin.

- [ ] **Step 4: Commit per plugin**

```bash
git add packages/client/src/plugins/<plugin>/
git commit -m "refactor(plugin/<name>): port from CM6 Extension to EditorPlugin"
```

Repeat for each plugin in the inventory.

---

## Task EM-8: Remove CM6 dependencies

**Files:**
- Modify: `packages/client/package.json`
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Confirm no remaining CM6 imports**

Run: `grep -rn "from ['\"]@codemirror\\|from ['\"]codemirror\\|from ['\"]@replit/codemirror-vim\\|from ['\"]y-codemirror" packages/`
Expected: no output (excluding `node_modules` and previously-saved inventory file under `notes/`).

- [ ] **Step 2: Uninstall**

```bash
cd packages/client && npm uninstall \
  @codemirror/autocomplete @codemirror/commands @codemirror/lang-markdown \
  @codemirror/language @codemirror/search @codemirror/state \
  @codemirror/theme-one-dark @codemirror/view @replit/codemirror-vim \
  codemirror y-codemirror.next

cd ../../packages/ui && npm uninstall \
  @codemirror/autocomplete @codemirror/commands @codemirror/lang-markdown \
  @codemirror/language @codemirror/search @codemirror/state \
  @codemirror/theme-one-dark @codemirror/view codemirror
```

- [ ] **Step 3: Confirm absence in package-lock**

Run: `grep -E '"@codemirror|"codemirror"|"y-codemirror' package-lock.json | head`
Expected: no output.

- [ ] **Step 4: Build and run full test suite**

```bash
cd packages/ui && npm run build && npm test
cd ../../packages/client && npm run build && npm test
```

Expected: builds succeed; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/package.json packages/client/package.json package-lock.json
git commit -m "deps: remove all @codemirror/* and y-codemirror.next"
```

---

## Task EM-9: Mark the WebView CodeMirror plan superseded

**Files:**
- Modify: `docs/superpowers/plans/2026-04-30-webview-codemirror-bundle.md`

- [ ] **Step 1: Insert a superseded banner at the top of the file**

```markdown
> **STATUS — SUPERSEDED 2026-05-08.** Replaced by [`2026-05-08-editor-cross-platform.md`](../specs/2026-05-08-editor-cross-platform.md) and the editor sub-plans (state-core, yjs-binding, web-view, native-ios-view, native-android-view, plugin-migration). The WebView bundle approach is no longer pursued; mobile uses a native UITextView/EditText editor. **Do not implement this plan.**
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-04-30-webview-codemirror-bundle.md
git commit -m "docs: mark webview-codemirror-bundle plan superseded"
```

---

## Task EM-10: Acceptance — zero CM6, IME smoke, collab smoke

**Files:** none modified — verification only.

- [ ] **Step 1: Final CM6 grep**

Run: `grep -rn "@codemirror\\|y-codemirror" packages/ --include='*.ts' --include='*.tsx' --include='*.json'`
Expected: no output (the `notes/cm6-migration-inventory.md` file is allowed; everything else must be clean).

- [ ] **Step 2: Run all unit and integration suites**

Run from repo root: `npm test`
Expected: all PASS.

- [ ] **Step 3: Run the Playwright IME smoke tests against the running client**

```bash
cd packages/client && npm run dev &
DEV_PID=$!
sleep 5
cd ../ui && npm run test:e2e
kill $DEV_PID
```

Expected: all PASS — Japanese, dead-key, backspace.

- [ ] **Step 4: Manually open a vault with collab enabled and verify**

- Two browser windows pointed at the same note via Yjs sync.
- Type in window A → text appears in window B.
- Window B's cursor shows up in A's gutter (RemoteCursor rendering — implemented via the awareness API).

- [ ] **Step 5: Commit (no-op final marker)**

```bash
git commit --allow-empty -m "feat(editor): CM6 fully removed; in-house editor live on web; mobile + Android wired separately"
```
