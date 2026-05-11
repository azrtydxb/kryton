# Editor Cross-Platform Renderer

**Date**: 2026-05-08
**Status**: Draft

> ⚠️ **Scope warning** — This replaces CodeMirror 6 across the entire stack with an in-house editor. The work spans editor data model, parser integration, two view implementations (web contenteditable, native iOS+Android), Yjs collab rebinding, and a new plugin API. Read the "Scope and risk" section before approving direction.

## Problem

The note editor today is **CodeMirror 6**: `@codemirror/state` (data model) + `@codemirror/view` (DOM-bound `contenteditable` editing surface) + a stack of `@codemirror/*` extensions (markdown lang, vim, autocomplete, search, theme, commands).

This works in the browser and inside Tauri (a webview), but it cannot run on **kryton-mobile** (React Native): `@codemirror/view` directly creates `contenteditable` divs, listens to `selectionchange` / `beforeinput` / `compositionend`, and integrates with browser IME. None of that exists on RN.

The 2026-04-30 plan ([webview-codemirror-bundle.md](../plans/2026-04-30-webview-codemirror-bundle.md)) patched the gap by bundling CM6 inside a WebView on mobile. That ships a browser inside the native app for the editor screen — exactly what the rest of kryton-mobile is designed to avoid. The editor there feels foreign, not native, and the IME path goes through a webview's text-input emulation rather than the OS text system.

Per the same direction taken for the graph (zero d3, zero WebView shims), we are removing the entire `@codemirror/*` family. **No CM6 anywhere in the production dependency graph.**

## Targets

- **kryton (web)** — browser, native `contenteditable`, no CM6.
- **kryton-desktop** — Tauri, hosts the web build of the editor unchanged.
- **kryton-mobile** — React Native, native `UITextView` / `EditText`, no WebView shim for the editor.

## Design

### Architecture: state / parser / view / gestures, no CM6, no WebView

```
packages/ui/src/editor/
  state/                           pure JS, no DOM, no React
    document.ts                    Document, Selection, Transaction, applyTransaction()
    operations.ts                  Insert / Delete / Replace / SetSelection
    history.ts                     Undo/redo stack on transactions
    parser.ts                      @lezer/markdown wrapper, incremental parse
    decorations.ts                 parse-tree → DecorationSpec[] (renderer-agnostic)
    plugins.ts                     Plugin interface: (state) => DecorationSpec[] / commands / suggestions
    yjsBinding.ts                  Yjs Y.Text ↔ Document, with cursor awareness
    commands.ts                    Bold, italic, link, heading, list, etc. — pure transaction factories
    types.ts
  view/
    web/
      EditorView.web.tsx           contenteditable shell, applies DecorationSpec[]
      ime.ts                       beforeinput / compositionstart / compositionend handling
      selection.ts                 DOM Range ↔ Document Selection
      paste.ts                     clipboard → markdown normalisation
    native/
      EditorView.native.tsx        thin React wrapper around the native module
      bridge.ts                    JS ↔ native: send DecorationSpec[], receive text/selection deltas
      ios/
        KrytonEditor.swift         UITextView subclass + RCTViewManager
        AttributedStringMapper.swift  DecorationSpec[] → NSAttributedString
      android/
        KrytonEditor.kt            EditText subclass + ViewManager
        SpannableMapper.kt         DecorationSpec[] → SpannableStringBuilder
  gestures/
    useShortcuts.web.ts            keyboard shortcuts → commands
    useShortcuts.native.ts         hardware-keyboard support on iPad/Android
  index.ts
```

Four independent layers, each replaceable in isolation:

1. **State** — pure JS, no dependencies on any view library. `Document` is an immutable rope-backed string + structured ranges. `Transaction` is the only way to mutate state. This is the entire editor's source of truth.
2. **Parser** — `@lezer/markdown` (standalone, *not* `@codemirror/lang-markdown`). Lezer is an incremental parser library; it predates CM and works without it. Produces a parse tree that `decorations.ts` walks to emit `DecorationSpec[]` — flat ranges of `{from, to, kind, attrs}` describing what styling to apply. Fully renderer-agnostic.
3. **View — web** — thin `contenteditable` shell that:
   - Renders the document with spans carrying `data-kind` / inline styles per `DecorationSpec`.
   - Translates `beforeinput` events into `Transaction`s (does *not* let the browser mutate the DOM directly — we own the model, the DOM is a projection).
   - Handles IME composition explicitly: keep the browser's composition span, defer transaction creation until `compositionend`.
   - Handles selection via DOM Range ↔ document offsets.
4. **View — native** — RN native module (Swift on iOS, Kotlin on Android) wrapping the OS text view:
   - JS sends a `DecorationSpec[]` for the current document.
   - Native side maps it to `NSAttributedString` (iOS) / `SpannableStringBuilder` (Android) and applies via `setAttributedText` / `setText`.
   - Native side emits text-change deltas back to JS, which become `Transaction`s on the JS-side `Document`.
   - IME, autocorrect, voice input, suggestion strip, dictation, accessibility, emoji panel — all handled by the OS text view for free. We never reimplement these.

### Why "no CM6" works architecturally

The objection to CM6 is that **`@codemirror/view` is the DOM-bound half**, and we can't share it with mobile. The argument for keeping CM6 on web while only replacing the mobile view is "we lose nothing on web". But:

- Two view implementations means two sets of plugin APIs — the renderer-agnostic plugin API we want would always be a subset of CM6's, and CM6 plugins would never run on mobile anyway.
- The CM6 dependency surface (15+ `@codemirror/*` packages) is sizeable bundle and audit weight for what is, post-split, just one of two view implementations.
- Owning the data model means the Yjs binding is one piece of code, not two (CM6's `y-codemirror.next` for web + a separate Yjs↔native-text binding for mobile).

So we own the state layer. Both view layers are then thin projections of it. CM6 isn't replaced by another browser-editor framework — it's replaced by an in-house view that talks to our own `Document`.

### Parsing: `@lezer/markdown`, not `@codemirror/lang-markdown`

`@lezer/markdown` is a standalone CommonMark-compatible incremental parser. It has no dependency on `@codemirror/*`. We use it directly:

- One-shot parse for initial render.
- `parser.parse(input, fragments)` for incremental reparse on each transaction — fragments are reused parse-tree pieces from the previous parse, so typing a character touches a tiny subtree.
- The parse tree is walked once per change to emit `DecorationSpec[]`; downstream consumers (decorations, plugins, wikilink extraction, autocomplete trigger detection) work off the tree, not the source string.

Wikilinks (`[[Note Title]]`) are not in CommonMark; they're added via Lezer's grammar extension API. The existing CM6-based wikilink parsing logic ports cleanly — same Lezer node names, same range outputs.

### Yjs collab — v1 scope (per spec answer)

Yjs is bound at the **state** layer, not the view layer:

- `yjsBinding.ts` reflects local `Transaction`s into Yjs ops (insert/delete on `Y.Text`) and reflects remote Yjs ops back into `Transaction`s applied to the local `Document`.
- Cursor awareness uses Yjs's `awareness` protocol; cursors are rendered by each view from the awareness state (web: caret overlays; native: a sibling caret view positioned by character index → CGRect / Layout coordinates).
- Both views are passive — they observe `Document` changes and rerender. They don't see Yjs at all.
- The existing `y-codemirror.next` dependency is removed.

This is meaningful new code (~1500 LOC including tests). It is in v1 per the earlier spec answer; if scope pressure builds, the fallback is "v1 read-only on mobile, v2 native collab" — flag this honestly when planning.

### Plugin API — renderer-agnostic (per spec answer)

Plugins implement an interface defined in `state/plugins.ts`:

```ts
interface EditorPlugin {
  name: string;
  decorations?(state: EditorState): DecorationSpec[];
  commands?: Record<string, (state: EditorState) => Transaction>;
  suggestions?(state: EditorState, trigger: SuggestionTrigger): Promise<Suggestion[]>;
  onTransaction?(tr: Transaction, state: EditorState): Transaction | null;
}
```

This is deliberately a **strict subset of what CM6 plugins can do.** Plugins cannot:

- Mount arbitrary DOM (web) or arbitrary native views (mobile) — they emit `DecorationSpec` only.
- Hook into IME or selection — only into transactions.
- Render block widgets (inline tables, embedded images) in v1 — these need per-platform native renderers and are deferred.

Existing kryton plugins ([PLUGINS.md](../../PLUGINS.md)) that decorate the editor will need to migrate. Plugins outside the editor (commands palette entries, sidebar items, etc.) are untouched.

### What we lose vs CM6

Honest list, so reviewers know what they're approving:

- **Vim mode** — not in v1 on either platform. `@codemirror/vim` is a 5k-LOC extension built against CM's view; rewriting it against our editor is its own project. Mobile users don't use vim mode anyway; web vim users are a known small group.
- **Multi-cursor** — out on mobile (native text views don't support it) and out on web in v1 (it's a substantial extension to write against contenteditable). Could be added on web later.
- **Block widgets** — inline tables, embedded image blocks, math blocks — deferred. Markdown source is editable; rendering as native widgets needs per-platform code that's out of v1.
- **`@codemirror/search`** — replaced by a simple `Cmd-F` find-in-document over the `Document` rope. No regex tokenisation niceties out of the gate.
- **CM6 themes** — irrelevant; we style decorations directly via tokens.

### What we keep (or rebuild minimally)

- Markdown syntax styling (bold/italic/code/link/quote/heading/list/codeblock/wikilink/tag).
- Wikilink tap → navigate.
- Backlink extraction (Lezer parse output feeds the existing backlinks pipeline; no editor-view dependency).
- Autocomplete (`[[`, `#`, `/`-commands) — own popup widget on web, OS suggestion view on mobile.
- Keyboard shortcuts for the common formatting commands (Cmd-B, Cmd-I, Cmd-K, etc.).
- Yjs realtime collab (v1, per answer).
- Renderer-agnostic plugin API (v1, per answer).

## Scope and risk

| Component | Approx LOC | Risk |
|---|---|---|
| `state/` (Document, Selection, Transaction, History) | ~1500 | medium — rope perf at large notes; well-trodden ground |
| `state/parser.ts` + `state/decorations.ts` | ~400 | low — Lezer does the heavy lifting |
| `state/yjsBinding.ts` | ~800 | **high** — bidirectional CRDT integration is where editors usually hit walls |
| `state/plugins.ts` + plugin migrations | ~600 + per-plugin work | medium |
| `view/web/` (contenteditable + IME + selection + paste) | ~2500 | **high** — IME edge cases, undo behaviour, copy/paste, accessibility |
| `view/native/` iOS + Android | ~2000 each | high — native bridge for incremental attribute-run updates without flicker |
| `gestures/` keyboard | ~300 | low |
| Tests | ~3000 | n/a |
| **Total** | **~13–14k LOC** | |

Optional scope reductions, listed for visibility (not in the spec's recommended v1 per the prior answers):

- **Defer collab** — drops `state/yjsBinding.ts` (the highest-risk component) and its tests; v1 mobile is solo-edit only.
- **Defer Android** — iOS-only mobile v1; halves the native-bridge surface and removes one OS's IME edge-case set.
- **Defer plugin API** — plugins stay web-only on the *old* CM6 path during a transition window where both editors coexist; removes plugin-API design and per-plugin migration from v1.

## Changes

| File / package | Change |
|---|---|
| `packages/client/package.json` | Remove all `@codemirror/*`, `codemirror`, `@replit/codemirror-vim`, `y-codemirror.next`. Add `@lezer/markdown`, `@lezer/highlight`. |
| `packages/ui/package.json` | Same removals. Add same lezer deps. Add native peer deps: `react-native-reanimated`, optional iOS/Android Swift/Kotlin source files. |
| `packages/client/src/components/Editor/**` | Migrated to import from `@kryton/ui/editor` instead of CM6 directly. |
| `packages/ui/src/editor/state/**` | New: `document.ts`, `operations.ts`, `history.ts`, `parser.ts`, `decorations.ts`, `plugins.ts`, `yjsBinding.ts`, `commands.ts`, `types.ts`. |
| `packages/ui/src/editor/view/web/**` | New: contenteditable view + IME + selection + paste handling. |
| `packages/ui/src/editor/view/native/**` | New: RN bridge + Swift + Kotlin native modules. |
| `packages/ui/src/editor/gestures/**` | New: keyboard shortcut hooks per platform. |
| `kryton-plugins/*` (editor-decorating plugins) | Migrated to new `EditorPlugin` interface. Audit per-plugin. |
| `docs/superpowers/plans/2026-04-30-webview-codemirror-bundle.md` | Marked superseded — no WebView editor bundle ships. |
| `kryton-mobile/...editor screen` | (When mobile scaffold lands) imports `<EditorView>` from `@kryton/ui` instead of WebView. |
| `kryton-desktop/...` | No editor-specific changes; Tauri picks up the web build. |

## Not Changing

- Note storage format (markdown source on disk, unchanged).
- Yjs document schema (`Y.Doc` shape, room IDs, sync transport).
- Plugin discovery / lifecycle ([PLUGINS.md](../../PLUGINS.md)) — only the *editor-facing* plugin API surface changes.
- Tauri as the desktop wrapper.
- The graph view spec ([2026-05-08-graph-cross-platform-renderer.md](./2026-05-08-graph-cross-platform-renderer.md)) — independent track.

## Risks & Open Questions

1. **IME on web is the single hardest bit of writing an editor.** CM6 has many iterations of edge-case handling baked in. We will hit Korean Hangul composition, dead-key sequences on Linux, Android Chrome's gboard quirks. Plan for a dedicated IME-hardening track late in v1.
2. **Yjs binding correctness.** Bidirectional reflection between `Document` transactions and `Y.Text` ops has subtle ordering issues (concurrent local edits during a remote sync, undo of remote ops, awareness during composition). The `y-codemirror.next` source is the reference; we re-implement against our own state but keep the same algorithm.
3. **Native attribute-run updates without flicker.** Mobile editors can flash on every keystroke if attribute-run replacement isn't done with proper batching (`UITextView.beginUpdates` / `EditText.setText` with span preservation). This is bridge-level work and needs to be addressed early in the native-view track, not as a polish pass.
4. **Undo across collab.** If the user types locally, gets a remote edit applied, then hits undo — what undoes? Yjs's undo manager defines the answer; we wire to it.
5. **Selection model on mobile.** Native text views give us a single selection range. We do not support multi-cursor on mobile; design must avoid features that require it (e.g. multi-line vim, multi-select edit).
6. **Plugin migration cost.** Existing editor-decorating plugins must be ported. The new API is intentionally a subset, so some plugin features will not survive the migration. Audit per-plugin before commit.
7. **Vim mode users.** A real loss. Acknowledge in release notes; offer no replacement in v1.
8. **kryton-mobile and kryton-desktop scaffolds are empty.** This spec is editor-only; integration is gated on the mobile/desktop scaffold plans.

## Acceptance

- `grep -r "@codemirror" packages/` returns zero hits in source (excluding node_modules).
- No `@codemirror/*` or `codemirror` package appears in any `package.json` under `packages/`.
- `y-codemirror.next` is removed; the new `yjsBinding.ts` passes the existing collab integration tests.
- Web/Tauri editor renders the same markdown styling as today's CM6 setup on a fixture set of 50 representative notes (visual snapshot diff acceptable for token spacing only).
- Mobile editor renders the same markdown styling natively, no embedded WebView.
- IME smoke tests pass on web for: Japanese (IME), Korean (Hangul composition), French (dead keys / option-e), Chinese Pinyin.
- Yjs collab integration tests pass on web ↔ web, web ↔ iOS, web ↔ Android with concurrent edits and offline reconnect.
- Plugin API: at least one existing kryton-plugin is ported to the new interface and runs identically on web and mobile.
- `state/` has unit tests covering: document ops, history, transaction merging, parse-incrementality, decoration emission. Pure JS, no DOM, no jsdom.
- `view/web/` has IME + selection + paste integration tests in a real browser via Playwright.
- `view/native/` has snapshot + interaction tests on the iOS simulator and Android emulator.
