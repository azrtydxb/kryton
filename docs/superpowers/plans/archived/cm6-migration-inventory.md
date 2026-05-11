# CM6 Migration Inventory

Generated: 2026-05-08

## Raw import sites

### packages/client/src

| File | Line | Import | Category |
|------|------|--------|----------|
| `src/App.tsx` | 3 | `import type { Extension } from '@codemirror/state'` | **replace** — drop; cast `editorExtensions` to `EditorPlugin[]` |
| `src/main.tsx` | 3 | `import { vim, getCM } from '@replit/codemirror-vim'` | **drop** — vim mode not supported in v1; remove from `__krytonPluginDeps` |
| `src/plugins/types.ts` | 2 | `import { Extension } from "@codemirror/state"` | **replace** — swap `Extension` with `EditorPlugin` from `@azrtydxb/ui/editor` |
| `src/components/Editor/EditorToolbar.tsx` | 3 | `import type { EditorView } from '@codemirror/view'` | **infra** — toolbar held a CM6 viewRef; refactor to `onCommand` callbacks |
| `src/components/Editor/EditorToolbar.tsx` | 4 | `import { undo, redo } from '@codemirror/commands'` | **infra** — driven by new editor's Cmd-Z keyboard handling |
| `src/components/Editor/Editor.tsx` | 3 | `import type { EditorView } from '@codemirror/view'` | **replace** — drop; use new `EditorView` from `@azrtydxb/ui/editor` |
| `src/components/Editor/Editor.tsx` | 4 | `import type { Extension } from '@codemirror/state'` | **replace** — drop; use `EditorPlugin[]` |
| `src/components/Views/EditModeView.tsx` | 2 | `import { Extension } from '@codemirror/state'` | **replace** — drop; use `EditorPlugin[]` |
| `src/components/Views/EditModeView.tsx` | 3 | `import { EditorView } from '@codemirror/view'` | **replace** — drop; no direct CM6 view ref needed |
| `src/hooks/useAppState.ts` | 3 | `import { EditorView } from '@codemirror/view'` | **replace** — the `editorViewRef` becomes `React.MutableRefObject<EditorView | undefined>` typed to new UI EditorView; but since toolbar no longer needs it, the ref can be removed or kept as `unknown` |

### packages/ui/src

| File | Line | Import | Category |
|------|------|--------|----------|
| `src/editor/NoteEditorReact.tsx` | 3–25 | All CM6 imports | **replace** — `NoteEditorReact` is the old CM6 wrapper; client must stop using it and switch to the new `EditorView` directly |
| `src/editor/krytonCmTheme.ts` | 16–17 | `@codemirror/view`, `@codemirror/language` | **drop** — krytonCmTheme is only needed by `NoteEditorReact`; once NoteEditorReact is replaced on the client, this file becomes dead code |
| `src/editor/codemirror-bundle/src/main.ts` | 1–7 | Full CM6 stack + vim + y-codemirror | **drop** — the iframe-bundle approach is superseded by the native EditorView; these files remain but are no longer referenced by the client |
| `src/editor/codemirror-bundle/src/paste-handler.ts` | 1 | `@codemirror/view` | **drop** — bundle only, dead after switch |
| `src/editor/codemirror-bundle/src/theme.ts` | 1 | `@codemirror/view` | **drop** — bundle only, dead after switch |

## Migration strategy

### Client (`packages/client/src`)

1. **`plugins/types.ts`**: Replace `Extension` with `EditorPlugin` from `@azrtydxb/ui/editor` in `EditorExtensionRegistration` and `ClientPluginAPI.editor.registerExtension`.
2. **`components/Editor/Editor.tsx`**: Replace the `NoteEditorReact` mount with the new `EditorView`. Remove `viewRef`/`pluginExtensions`/`EditorView` CM6 ref props.
3. **`components/Editor/EditorToolbar.tsx`**: Replace the `viewRef: MutableRefObject<EditorView>` API with an `onCommand` callback + text mutation callbacks driven by the new editor's state/dispatch.
4. **`components/Views/EditModeView.tsx`**: Wire the new Editor + Toolbar together using a shared `onCommand` callback. Drop `editorViewRef` prop. Pass `EditorPlugin[]` instead of `Extension[]`.
5. **`hooks/useAppState.ts`**: Remove the CM6 `EditorView` import; the `editorViewRef` is no longer needed (toolbar no longer calls `view.dispatch`).
6. **`App.tsx`**: Drop `Extension` import; cast `editorExtensions` as `EditorPlugin[]`.
7. **`main.tsx`**: Remove vim import; remove from `__krytonPluginDeps`.

### Packages/ui

- `NoteEditorReact.tsx` and `krytonCmTheme.ts` remain in the tree (they are part of `@azrtydxb/ui`'s public API still used by third parties) but the client stops importing them.
- `codemirror-bundle/` is superseded (webview plan is marked superseded in EM-9).
- CM6 deps in `packages/ui/package.json` remain until `NoteEditorReact` is separately retired (out of scope for this sub-plan, which targets client-side removal only).

### Gap / Concerns

- **Toolbar text mutations**: The new `EditorView` does not expose an imperative `dispatch` or a ref. Toolbar commands like bold/italic/heading/insert that manipulate text need either:
  - (a) An `onCommand` callback wired through: parent holds a `commandRef` that the `EditorView` populates via `useImperativeHandle`, or
  - (b) The parent maintains the `doc` string in state and the toolbar performs string manipulation, then passes the result to the editor via a controlled `value` prop.
  - **Decision**: Use approach (a) — expose a `ref` handle from the new `Editor` wrapper component via `useImperativeHandle`, providing `insertText(text)`, `wrapSelection(before, after)`, `insertAtLineStart(prefix)`, `undo()`, `redo()` methods that delegate into the new editor's state.
- **`NoteEditorReact` in `@azrtydxb/ui`**: This file still uses CM6 and is exported publicly. Removing CM6 from `packages/ui/package.json` would break it. Option B applies for `packages/ui` CM6 deps — they stay until `NoteEditorReact` is separately migrated or removed.
- **Image upload**: The `handleUploadImage` in EditorToolbar uses `view.dispatch` to insert markdown. This must also go through the imperative handle.
- **Vim mode**: Dropped. Gap documented. The `vim` / `getCM` in `main.tsx` are removed.
