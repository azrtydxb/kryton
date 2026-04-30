# WebView CodeMirror + Yjs Bundle — Design Spec

**Status:** Approved for implementation.
**Repository:** `azrtydxb/kryton-mobile`.
**Replaces:** the inline-HTML `<textarea>` editor + CDN-loaded Yjs UMD shipped during Phase 3 stream 3C as a temporary bridge.

## Purpose

Build a real CodeMirror 6 + `y-codemirror.next` editor inside the mobile WebView, bundled offline with all dependencies inlined. No network fetch on first load. Live cursors, vim mode, and code-fence syntax highlighting come for free with the binding.

Solves three real problems:
1. **CDN dependency** — the current bridge loads `yjs@13` from `cdn.jsdelivr.net` on every fresh editor mount. Offline first-launch can fail.
2. **Editor experience** — a `<textarea>` has no syntax highlighting, no proper undo, no vim mode, no live cursor presence rendering inside the editor.
3. **Pasted-image growth** — currently no interception; an image paste embeds base64 into the markdown source and the Yjs doc grows linearly with the image.

## Architecture

```
kryton-mobile/
├── src/
│   └── webview/
│       ├── codemirror-bundle/         # NEW: self-contained bundle
│       │   ├── package.json           # internal sub-package; not published
│       │   ├── tsconfig.json
│       │   ├── esbuild.config.mjs
│       │   ├── src/
│       │   │   ├── main.ts            # entry: CodeMirror + Yjs binding + bridge
│       │   │   ├── template.html      # shell with mount point
│       │   │   ├── theme.ts           # dark/light tokens
│       │   │   ├── paste-handler.ts   # paste-to-attachment upload
│       │   │   └── chunked-postmessage.ts  # >64KB chunking protocol
│       │   └── dist/
│       │       └── editor.html        # COMMITTED build output
│       ├── EditorBridge.tsx           # MODIFIED: load editor.html, drop CDN
│       └── PreviewBridge.tsx          # UNCHANGED
```

### Bundle output

`dist/editor.html` is a single self-contained HTML file. esbuild bundles `main.ts` + all node_modules into IIFE JavaScript, then a post-build step inlines the IIFE into `<script>` tags inside `template.html`. The result has zero external URLs.

### Build flow

```bash
cd src/webview/codemirror-bundle
npm install        # runs once when the bundle's deps change
npm run build      # esbuild → editor.html, committed
```

Mobile root `package.json` adds `"build:webview": "npm run build --prefix src/webview/codemirror-bundle"` for convenience.

The `dist/editor.html` is **committed to the repo** so simulator runs and EAS builds don't need a separate pre-build pipeline. CI verifies freshness via a hash check (build → diff against committed → fail if drifted).

### Bridge protocol (extends Phase 3C protocol with chunking)

Messages from RN → WebView and WebView → RN go through `WebView.postMessage`. The base protocol (already implemented in 3C):

| Type | Direction | Payload |
|---|---|---|
| `yjs:initial-state` | RN → WV | base64 of `Y.encodeStateAsUpdate(doc)` |
| `yjs:remote-update` | RN → WV | base64 of an incoming Yjs update |
| `yjs:update` | WV → RN | base64 of a local Yjs update |
| `awareness:update` | both | base64 of awareness encoding |
| `paste:image` | WV → RN | `{ filename, mimeType, base64 }` (uploaded by RN, replaced inline) |
| `paste:image:resolved` | RN → WV | `{ pasteId, attachmentRef }` (RN tells WV what URL to insert) |

**Chunking** for any binary payload >64KB:

```ts
// Sender:
{ type: "<original-type>:chunk", chunkId: "abc", seq: 0, total: 3, payload: "..." }
{ type: "<original-type>:chunk", chunkId: "abc", seq: 1, total: 3, payload: "..." }
{ type: "<original-type>:chunk", chunkId: "abc", seq: 2, total: 3, payload: "..." }

// Receiver: buffer by chunkId, reassemble when seq=total-1 received,
// emit synthetic non-chunked message to higher-level handler.
// Timeout: 30s; partial assembly drops with a console.warn.
```

### Paste-image handler

CodeMirror's `EditorView` accepts a `domEventHandlers` config. The paste handler:

```ts
EditorView.domEventHandlers({
  paste(event, view) {
    const items = event.clipboardData?.items ?? [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const pasteId = String(Math.random()).slice(2);
          const base64 = String(reader.result).split(",")[1] ?? "";
          // Insert placeholder in doc immediately
          const placeholder = `![](uploading:${pasteId})`;
          view.dispatch({ changes: { from: view.state.selection.main.from, insert: placeholder } });
          // Tell RN to upload
          postToRn({ type: "paste:image", pasteId, filename: file.name || "pasted.png", mimeType: file.type, base64 });
        };
        reader.readAsDataURL(file);
        return true;
      }
    }
    return false;
  }
})
```

RN side handles `paste:image`, calls `POST /api/attachments`, then sends `paste:image:resolved` back. WebView replaces the placeholder text `![](uploading:<id>)` → `![](attachment://<contentHash>)`.

### Editor configuration

```ts
const view = new EditorView({
  state: EditorState.create({
    doc: "",
    extensions: [
      basicSetup,
      markdown({ codeLanguages: languages }),  // @codemirror/language-data
      vim(),                                    // @codemirror/vim
      yCollab(yText, awareness),                // y-codemirror.next; live cursors
      EditorView.domEventHandlers({ paste: pasteHandler }),
      EditorView.theme(themeTokens),
    ],
  }),
  parent: document.getElementById("editor")!,
});
```

`yCollab(yText, awareness)` automatically renders other peers' cursors and selections inside the editor based on the Awareness instance. RN side passes Awareness state via the existing `awareness:update` messages.

### Initialization sequence

1. RN renders `<WebView source={{ html: bundledHtml }} />` (the html string is loaded from `editor.html` once at module init via `Asset.fromModule(require(...)).downloadAsync()`).
2. WebView fires `onLoad`. RN calls `core.yjs.openDocument(noteId)`, gets a `Y.Doc`, sends `yjs:initial-state` (chunked if needed).
3. WebView's `main.ts` receives initial-state, applies to local Y.Doc, mounts the EditorView.
4. WebView's local Y.Doc emits `update` events; bundle filters out remote-origin updates and sends `yjs:update` to RN.
5. RN forwards updates between the local Y.Doc (managed by `core.yjs`) and the WebView.
6. On WebView unmount, RN calls `core.yjs.closeDocument(noteId)`.

## Out of scope

- Drag-and-drop image upload (paste handles 95% of cases; drag is incremental).
- PreviewBridge changes (separate file, unchanged).
- Note-size chunking beyond paste-image — addressed by the paste-image interceptor preventing inline binary growth at the source. Long-form text doc growth is bounded by reasonable user note size.
- Cursor-color customization per peer (default y-codemirror.next colors are fine).

## Bundle size budget

Target: <800KB minified, gzipped <300KB.

| Component | Approx minified |
|---|---|
| `@codemirror/{state,view,commands}` + basic-setup | ~150KB |
| `@codemirror/lang-markdown` + `@codemirror/language-data` | ~250KB |
| `yjs` + `y-protocols` | ~100KB |
| `y-codemirror.next` | ~30KB |
| `@codemirror/vim` | ~50KB |
| Glue code (main.ts, paste, chunking, theme) | ~10KB |
| **Total** | **~590KB** |

Within budget. If we exceed 800KB on first build, drop `language-data` (lose per-language code-fence highlighting, fall back to plain `markdown()`).

## Testing strategy

- **Bundle smoke:** `node -e "require('./dist/editor.html')"` returns a string >100KB.
- **TS typecheck:** `tsc --noEmit` from inside the bundle dir passes.
- **Build determinism:** `npm run build` twice produces byte-identical `editor.html`. Hash committed to a `BUILD_HASH` file for CI verification.
- **Manual smoke (operator):** install on simulator, open a note, type, paste an image, observe attachment upload + ref insertion, observe vim mode toggle.

## Open implementation questions

1. Does `Asset.fromModule(require("./editor.html"))` work with metro for HTML strings, or do we need a custom `metro.config.js` rule? Probable answer: yes via `assetExts` config addition. Implementer to verify.
2. Vim mode default-off vs on? Proposed: off; toggle via `:set` from the keybar (CodeMirror's built-in vim implements this).
3. Theme: light only initially, dark mode follows in a follow-up. Proposed: read system color scheme from `Appearance` (RN side) and pass via init message.
