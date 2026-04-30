# WebView CodeMirror+Yjs Bundle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`).

**Goal:** Replace inline-HTML+CDN editor with a bundled CodeMirror 6 + `y-codemirror.next` editor in `kryton-mobile`. Single stream; ~half-day of focused work.

**Spec:** [`docs/superpowers/specs/2026-04-30-webview-codemirror-bundle-design.md`](../specs/2026-04-30-webview-codemirror-bundle-design.md)

**Repository:** `azrtydxb/kryton-mobile`. Branch: `feat/webview-bundle`.

---

## File ownership

This is a single-stream task. Files owned:

- `src/webview/codemirror-bundle/**` (new sub-package)
- `src/webview/EditorBridge.tsx` (modify: load bundled HTML, drop CDN bridge)
- `metro.config.js` (modify: add `html` to `assetExts` if needed)
- `package.json` root (modify: add `build:webview` script)
- `.github/workflows/ci.yml` (modify: add bundle freshness check)

Not touched: PreviewBridge, app/**, src/components/**, server-side code.

---

## Task WB-1: Create bundle sub-package

**Files:**
- Create `src/webview/codemirror-bundle/package.json`
- Create `src/webview/codemirror-bundle/tsconfig.json`
- Create `src/webview/codemirror-bundle/.gitignore`

- [ ] **Step 1:** Create the package.json:
```json
{
  "name": "kryton-webview-bundle",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@codemirror/commands": "^6.7.0",
    "@codemirror/lang-markdown": "^6.3.0",
    "@codemirror/language": "^6.10.3",
    "@codemirror/language-data": "^6.5.1",
    "@codemirror/state": "^6.4.1",
    "@codemirror/view": "^6.34.0",
    "@codemirror/vim": "^6.2.1",
    "codemirror": "^6.0.1",
    "y-codemirror.next": "^0.3.5",
    "y-protocols": "^1.0.6",
    "yjs": "^13.6.0"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2:** Create tsconfig.json:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3:** Create `.gitignore`:
```
node_modules/
*.tsbuildinfo
```

- [ ] **Step 4:** From the bundle dir, run `npm install`. Confirm node_modules created.

- [ ] **Step 5:** Commit: `git commit -m "chore(webview): bundle sub-package skeleton"`

---

## Task WB-2: Write the editor entry (`main.ts`)

**Files:**
- Create `src/webview/codemirror-bundle/src/main.ts`

- [ ] **Step 1:** Implement `main.ts` with this structure:

```ts
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { vim } from "@codemirror/vim";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import { setupChunkedReceiver, sendChunked } from "./chunked-postmessage";
import { makePasteHandler } from "./paste-handler";
import { lightTheme } from "./theme";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (msg: string) => void };
  }
}

const yDoc = new Y.Doc();
const yText = yDoc.getText("body");
const awareness = new Awareness(yDoc);

let view: EditorView | null = null;
let initialized = false;

function postToRn(obj: unknown) {
  const json = JSON.stringify(obj);
  // Chunk if >64KB
  if (json.length > 64 * 1024) {
    sendChunked(window.ReactNativeWebView!.postMessage.bind(window.ReactNativeWebView), obj);
  } else {
    window.ReactNativeWebView?.postMessage(json);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const chunkedReceiver = setupChunkedReceiver();

function handleMessage(msg: { type: string; [k: string]: unknown }) {
  // Reassemble chunks if applicable
  const reassembled = chunkedReceiver(msg);
  if (reassembled === null) return; // still buffering
  msg = reassembled;

  switch (msg.type) {
    case "yjs:initial-state": {
      const update = base64ToBytes(msg.payload as string);
      Y.applyUpdate(yDoc, update, "remote");
      if (!initialized) mountEditor();
      break;
    }
    case "yjs:remote-update": {
      const update = base64ToBytes(msg.payload as string);
      Y.applyUpdate(yDoc, update, "remote");
      break;
    }
    case "awareness:update": {
      // y-protocols/awareness applyAwarenessUpdate handles it
      const update = base64ToBytes(msg.payload as string);
      const { applyAwarenessUpdate } = require("y-protocols/awareness");
      applyAwarenessUpdate(awareness, update, "remote");
      break;
    }
    case "paste:image:resolved": {
      const { pasteId, attachmentRef } = msg as { pasteId: string; attachmentRef: string };
      replacePlaceholder(pasteId, attachmentRef);
      break;
    }
  }
}

function replacePlaceholder(pasteId: string, ref: string) {
  if (!view) return;
  const text = yText.toString();
  const placeholder = `![](uploading:${pasteId})`;
  const idx = text.indexOf(placeholder);
  if (idx < 0) return;
  yDoc.transact(() => {
    yText.delete(idx, placeholder.length);
    yText.insert(idx, `![](${ref})`);
  });
}

function mountEditor() {
  initialized = true;

  yDoc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    postToRn({ type: "yjs:update", payload: bytesToBase64(update) });
  });

  awareness.on("update", () => {
    const { encodeAwarenessUpdate } = require("y-protocols/awareness");
    const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);
    postToRn({ type: "awareness:update", payload: bytesToBase64(update) });
  });

  const pasteHandler = makePasteHandler((paste) => postToRn({ type: "paste:image", ...paste }));

  view = new EditorView({
    state: EditorState.create({
      doc: yText.toString(),
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ codeLanguages: languages }),
        vim(),
        yCollab(yText, awareness),
        EditorView.domEventHandlers({ paste: pasteHandler }),
        EditorView.lineWrapping,
        lightTheme,
      ],
    }),
    parent: document.getElementById("editor")!,
  });

  view.focus();
  postToRn({ type: "editor:ready" });
}

document.addEventListener("message", (e: MessageEvent | Event) => {
  try {
    const data = (e as MessageEvent).data;
    handleMessage(JSON.parse(typeof data === "string" ? data : ""));
  } catch (err) {
    console.error("editor message parse failed", err);
  }
});

// iOS uses window.addEventListener; Android sometimes uses document
window.addEventListener("message", (e) => {
  try { handleMessage(JSON.parse(e.data)); } catch {}
});
```

- [ ] **Step 2:** Acceptance: `npm run typecheck` from the bundle dir passes (after the helper files exist; defer until WB-3 and WB-4 complete).

---

## Task WB-3: Helper modules — chunking + paste-handler + theme

**Files:**
- Create `src/webview/codemirror-bundle/src/chunked-postmessage.ts`
- Create `src/webview/codemirror-bundle/src/paste-handler.ts`
- Create `src/webview/codemirror-bundle/src/theme.ts`

- [ ] **Step 1:** Write `chunked-postmessage.ts`:

```ts
const CHUNK_SIZE = 60 * 1024; // 60KB to leave headroom for JSON envelope
const CHUNK_TIMEOUT = 30_000;

export function sendChunked(postMessage: (s: string) => void, obj: { type: string; [k: string]: unknown }): void {
  const json = JSON.stringify(obj);
  if (json.length <= CHUNK_SIZE) {
    postMessage(json);
    return;
  }
  const chunkId = String(Math.random()).slice(2);
  const total = Math.ceil(json.length / CHUNK_SIZE);
  for (let seq = 0; seq < total; seq++) {
    const slice = json.slice(seq * CHUNK_SIZE, (seq + 1) * CHUNK_SIZE);
    postMessage(JSON.stringify({
      type: `${obj.type}:chunk`,
      chunkId,
      seq,
      total,
      payload: slice,
    }));
  }
}

interface PendingChunks {
  chunks: string[];
  total: number;
  received: number;
  type: string;
  startedAt: number;
}

export function setupChunkedReceiver() {
  const pending = new Map<string, PendingChunks>();

  // Janitor: drop expired buffers
  setInterval(() => {
    const now = Date.now();
    for (const [id, p] of pending) {
      if (now - p.startedAt > CHUNK_TIMEOUT) {
        console.warn(`Dropping incomplete chunk buffer ${id} (${p.received}/${p.total})`);
        pending.delete(id);
      }
    }
  }, 5_000);

  return function receive(msg: { type: string; [k: string]: unknown }): { type: string; [k: string]: unknown } | null {
    if (!msg.type.endsWith(":chunk")) return msg; // not a chunk

    const baseType = msg.type.slice(0, -":chunk".length);
    const chunkId = msg.chunkId as string;
    const seq = msg.seq as number;
    const total = msg.total as number;
    const payload = msg.payload as string;

    let p = pending.get(chunkId);
    if (!p) {
      p = { chunks: new Array(total), total, received: 0, type: baseType, startedAt: Date.now() };
      pending.set(chunkId, p);
    }
    if (p.chunks[seq] === undefined) {
      p.chunks[seq] = payload;
      p.received++;
    }
    if (p.received < p.total) return null; // incomplete

    pending.delete(chunkId);
    const reassembled = p.chunks.join("");
    try {
      return JSON.parse(reassembled);
    } catch {
      console.warn(`Failed to parse reassembled chunk ${chunkId}`);
      return null;
    }
  };
}
```

- [ ] **Step 2:** Write `paste-handler.ts`:

```ts
import type { EditorView } from "@codemirror/view";

interface PasteRequest {
  pasteId: string;
  filename: string;
  mimeType: string;
  base64: string;
}

export function makePasteHandler(onImagePaste: (req: PasteRequest) => void) {
  return function paste(event: ClipboardEvent, view: EditorView): boolean {
    const items = event.clipboardData?.items;
    if (!items) return false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.kind === "file" && item.type.startsWith("image/")) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result);
          const base64 = result.includes(",") ? result.split(",")[1]! : "";
          const pasteId = String(Math.random()).slice(2, 12);
          const placeholder = `![](uploading:${pasteId})`;
          const pos = view.state.selection.main.from;
          view.dispatch({ changes: { from: pos, insert: placeholder } });
          onImagePaste({
            pasteId,
            filename: file.name || "pasted-image.png",
            mimeType: file.type || "image/png",
            base64,
          });
        };
        reader.readAsDataURL(file);
        return true;
      }
    }
    return false;
  };
}
```

- [ ] **Step 3:** Write `theme.ts`:

```ts
import { EditorView } from "@codemirror/view";

export const lightTheme = EditorView.theme({
  "&": {
    fontSize: "16px",
    fontFamily: "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', Menlo, monospace",
    height: "100%",
  },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.5" },
  ".cm-content": { padding: "16px" },
  ".cm-focused": { outline: "none" },
});
```

- [ ] **Step 4:** Acceptance: `npm run typecheck` from bundle dir passes.

- [ ] **Step 5:** Commit: `git commit -m "feat(webview): editor entry with chunking + paste handler + theme"`

---

## Task WB-4: HTML template + esbuild config + build script

**Files:**
- Create `src/webview/codemirror-bundle/src/template.html`
- Create `src/webview/codemirror-bundle/esbuild.config.mjs`

- [ ] **Step 1:** Write `template.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Kryton Editor</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
  #editor { height: 100%; }
  .cm-editor { height: 100%; }
</style>
</head>
<body>
<div id="editor"></div>
<script>__BUNDLE_PLACEHOLDER__</script>
</body>
</html>
```

- [ ] **Step 2:** Write `esbuild.config.mjs`:

```js
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const __dirname = dirname(new URL(import.meta.url).pathname);

async function build() {
  const result = await esbuild.build({
    entryPoints: [resolve(__dirname, "src/main.ts")],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2020"],
    platform: "browser",
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
  });

  const js = result.outputFiles[0].text;
  const template = readFileSync(resolve(__dirname, "src/template.html"), "utf8");
  const html = template.replace("__BUNDLE_PLACEHOLDER__", js);

  const outDir = resolve(__dirname, "dist");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "editor.html"), html);

  const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);
  writeFileSync(resolve(outDir, "BUILD_HASH"), hash + "\n");

  const sizeKb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
  console.log(`built editor.html: ${sizeKb}KB, hash=${hash}`);
}

build().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3:** Run `npm run build`. Confirm `dist/editor.html` exists, size is between 300-900KB. Note size in commit message.

- [ ] **Step 4:** Commit (include `dist/editor.html` and `dist/BUILD_HASH`): `git commit -m "build(webview): esbuild bundle producing committed editor.html (<size>KB)"`

---

## Task WB-5: Wire EditorBridge to load bundled HTML

**Files:**
- Modify `src/webview/EditorBridge.tsx`
- Modify `metro.config.js` (if it exists; create a minimal one if not)

- [ ] **Step 1:** Inspect `metro.config.js`. If it doesn't include `html` in `assetExts`, add it:

```js
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("html");
module.exports = config;
```

- [ ] **Step 2:** Modify `EditorBridge.tsx`. Replace the inline-HTML string + CDN script logic with:

```tsx
// Top of file:
import editorHtml from "./codemirror-bundle/dist/editor.html";

// In the component, drop the old `inlineHtml` constant.
// Source:
<WebView
  ref={webviewRef}
  source={{ html: editorHtml as unknown as string, baseUrl: "" }}
  // ... existing onMessage / onLoad ...
/>
```

If metro can't import HTML as a string directly, fall back to:

```tsx
import { Asset } from "expo-asset";
import editorHtmlModule from "./codemirror-bundle/dist/editor.html";

const [editorHtml, setEditorHtml] = useState<string | null>(null);
useEffect(() => {
  (async () => {
    const asset = Asset.fromModule(editorHtmlModule);
    await asset.downloadAsync();
    const res = await fetch(asset.localUri ?? asset.uri);
    setEditorHtml(await res.text());
  })();
}, []);

if (!editorHtml) return null;
```

- [ ] **Step 3:** Add the paste-image handler on the RN side. When WV sends `{ type: "paste:image", pasteId, filename, mimeType, base64 }`:

```tsx
async function handlePasteImage(msg: PasteImageMsg, noteId: string) {
  try {
    const blob = base64ToBlob(msg.base64, msg.mimeType);
    const formData = new FormData();
    formData.append("file", blob as unknown as File, msg.filename);
    formData.append("notePath", noteId);
    const tok = await storage.getApiKey();
    const res = await fetch(`${serverUrl}/api/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
      body: formData,
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    const { contentHash } = await res.json();
    webviewRef.current?.postMessage(JSON.stringify({
      type: "paste:image:resolved",
      pasteId: msg.pasteId,
      attachmentRef: `attachment://${contentHash}`,
    }));
  } catch (err) {
    console.warn("paste-upload failed", err);
    webviewRef.current?.postMessage(JSON.stringify({
      type: "paste:image:resolved",
      pasteId: msg.pasteId,
      attachmentRef: "",  // empty ref → editor will leave the placeholder
    }));
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}
```

- [ ] **Step 4:** Drop the legacy `inlineHtml` constant and any CDN-loading code from EditorBridge.tsx.

- [ ] **Step 5:** `npx tsc --noEmit` should pass.

- [ ] **Step 6:** Commit: `git commit -m "feat(webview): EditorBridge loads bundled editor.html and handles paste-upload"`

---

## Task WB-6: Add `build:webview` script to mobile root + CI freshness check

**Files:**
- Modify `package.json` (root)
- Modify `.github/workflows/<existing-ci>.yml` if it exists

- [ ] **Step 1:** Add to root `package.json` scripts:
```json
"build:webview": "npm run build --prefix src/webview/codemirror-bundle",
"verify:webview-fresh": "npm run build:webview && diff <(cat src/webview/codemirror-bundle/dist/BUILD_HASH) <(git show HEAD:src/webview/codemirror-bundle/dist/BUILD_HASH)"
```

- [ ] **Step 2:** Check if there's a CI workflow in mobile repo. If yes, add a step running `npm run verify:webview-fresh` after install. If not, skip — CI doesn't block mobile builds.

- [ ] **Step 3:** Commit: `git commit -m "chore(webview): root scripts for build and freshness verification"`

---

## Task WB-7: Update mobile README

**Files:**
- Modify `README.md`

- [ ] **Step 1:** Update the "Status" section to remove the CDN bridge note. Replace with:

```markdown
- WebView editor: bundled CodeMirror 6 + y-codemirror.next, no CDN. Source in `src/webview/codemirror-bundle/`. Run `npm run build:webview` after editing.
- Pasted images upload to `/api/attachments` automatically; the markdown gets `![](attachment://<hash>)` instead of inline base64.
- Vim mode enabled; toggle via standard CodeMirror vim keybindings.
```

- [ ] **Step 2:** Commit: `git commit -m "docs: update README for bundled WebView editor"`

---

## Task WB-8: Final smoke

- [ ] **Step 1:** `cd src/webview/codemirror-bundle && npm run typecheck && npm run build`. Verify `dist/editor.html` exists.
- [ ] **Step 2:** From mobile root, `npx tsc --noEmit` passes.
- [ ] **Step 3:** Push branch and merge to master via fast-forward (no PR needed; this is a single-stream branch).
- [ ] **Step 4:** Document in commit log: bundle size, what's in it (codemirror, vim, lang-data, yjs).

---

## Self-review

- [ ] Every task has actual commands or actual code.
- [ ] No "TODO" or "TBD" placeholders.
- [ ] Cross-reference: editor.html freshness check and bundle build flow tied together via BUILD_HASH.
- [ ] Bridge protocol explicitly documented; chunking format spec'd.
- [ ] Paste handler RN-side base64-to-Blob conversion explicit (not all RN versions handle Blob from base64 cleanly; documented).

## Open implementation questions deferred to execution

1. Metro asset import of HTML — verify works, fall back to expo-asset if not.
2. Vim default-on may surprise users; ship default-on for power users, surface a toggle later if requested.
3. Awareness color customization — y-codemirror.next defaults are fine; revisit if multiple users complain about indistinct cursors.
