# Mobile Core Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `kryton-mobile`'s bespoke `expo-sqlite` data layer and hand-rolled sync with `@azrtydxb/core` + `@azrtydxb/core-react`. Migrate all UI screens to read via hooks; rewrite the WebView CodeMirror editor to source from `core.notes.openDocument` (Yjs).

**Architecture:** No new architecture; consume the published `@azrtydxb/core` package. First-launch flow detects the legacy DB, deletes it, runs `core.sync.full()`, sets a "migrated" sentinel.

**Tech Stack:** Expo SDK 55, React Native 0.83, expo-router, react-native-webview, `@azrtydxb/core`, `@azrtydxb/core-react`, `yjs`, `y-codemirror.next` (inside the WebView bundle).

**Spec:** [`docs/superpowers/specs/2026-04-30-mobile-core-migration-design.md`](../specs/2026-04-30-mobile-core-migration-design.md)

**Repository:** `azrtydxb/kryton-mobile` (separate repo).

**Phase mapping:** Phase 3 streams 3A, 3B, 3C.

---

## File ownership

**Stream 3A (Wiring + migration) — tasks MOB-1 through MOB-9:**
- `src/core.ts`
- `app/_layout.tsx` (provider wrap only)
- `src/lib/storage.ts` (simplification)
- `src/lib/api.ts` (sync methods removed)
- `package.json`
- `scripts/dev-link.js` (already from PUB-10)
- `.npmrc`
- `.husky/pre-commit`
- `src/__tests__/core-init.test.ts`

**Stream 3B (UI hooks migration) — tasks MOB-10 through MOB-22:**
- All `app/**/*.tsx` files that currently read from `db.*`
- `src/components/**/*.tsx` similarly

**Stream 3C (WebView Yjs editor) — tasks MOB-23 through MOB-32:**
- `src/webview/EditorBridge.tsx`
- `src/webview/PreviewBridge.tsx`
- `src/webview/codemirror-bundle/`
- `src/__tests__/webview-bridge.test.ts`

---

# Stream 3A — Wiring + first-launch migration

## Task MOB-1: Add deps and update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update dependencies**

Edit `kryton-mobile/package.json`:

```json
"dependencies": {
  ...,
  "@azrtydxb/core": "4.4.0-pre.1",
  "@azrtydxb/core-react": "4.4.0-pre.1",
  "yjs": "^13.6.0"
}
```

Add `dev:link/unlink/verify` scripts already added in PUB-10.

- [ ] **Step 2: Install**

Run: `GITHUB_TOKEN=$GITHUB_TOKEN npm install`
Expected: installs.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @azrtydxb/core, @azrtydxb/core-react, yjs dependencies"
```

---

## Task MOB-2: Write `src/core.ts` — Kryton init + migration logic

**Files:**
- Create: `src/core.ts`
- Test: `src/__tests__/core-init.test.ts`

- [ ] **Step 1: Test (mock SecureStore + FileSystem)**

```ts
// src/__tests__/core-init.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn(),
}));
vi.mock("expo-file-system", () => ({
  documentDirectory: "/tmp/test-",
  deleteAsync: vi.fn(async () => {}),
}));
vi.mock("@azrtydxb/core/adapters/expo-sqlite", () => ({
  ExpoSqliteAdapter: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@azrtydxb/core", () => ({
  Kryton: { init: vi.fn(async () => ({ sync: { full: vi.fn(), startAuto: vi.fn() } })) },
}));

import { initCore } from "../core";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system";

describe("initCore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes legacy DB on first launch", async () => {
    (SecureStore.getItemAsync as any).mockResolvedValue(null);
    await initCore("https://srv");
    expect(FileSystem.deleteAsync).toHaveBeenCalled();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("kryton.coreMigrationDone", "true");
  });

  it("skips deletion when already migrated", async () => {
    (SecureStore.getItemAsync as any).mockResolvedValue("true");
    await initCore("https://srv");
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/core.ts
import { Kryton } from "@azrtydxb/core";
import { ExpoSqliteAdapter } from "@azrtydxb/core/adapters/expo-sqlite";
import * as FileSystem from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { storage } from "./lib/storage";

const MIGRATION_DONE_KEY = "kryton.coreMigrationDone";
const LEGACY_DB_NAME = "kryton.db";
const NEW_DB_NAME = "kryton-core.db";

export async function initCore(serverUrl: string): Promise<Kryton> {
  const migrated = await SecureStore.getItemAsync(MIGRATION_DONE_KEY);

  if (migrated !== "true") {
    const legacyPath = `${FileSystem.documentDirectory}SQLite/${LEGACY_DB_NAME}`;
    try { await FileSystem.deleteAsync(legacyPath, { idempotent: true }); } catch {}
  }

  const core = await Kryton.init({
    adapter: new ExpoSqliteAdapter(NEW_DB_NAME),
    serverUrl,
    authToken: () => storage.getToken(),
  });

  if (migrated !== "true") {
    try { await core.sync.full(); }
    catch (err) { console.warn("Initial sync failed; will retry on next foreground", err); }
    await SecureStore.setItemAsync(MIGRATION_DONE_KEY, "true");
  }

  core.sync.startAuto({ intervalMs: 60_000 });
  return core;
}
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add src/core.ts src/__tests__/core-init.test.ts
git commit -m "feat: src/core.ts with first-launch migration"
```

---

## Task MOB-3: Wrap app in KrytonProvider

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Read the file**

Run: `cat app/_layout.tsx`

- [ ] **Step 2: Add provider wrap**

```tsx
// app/_layout.tsx (top-level)
import { useEffect, useState } from "react";
import { KrytonProvider } from "@azrtydxb/core-react";
import type { Kryton } from "@azrtydxb/core";
import { initCore } from "@/core";
import { useServerUrl } from "@/hooks/useServerUrl";

export default function RootLayout() {
  const serverUrl = useServerUrl();
  const [core, setCore] = useState<Kryton | null>(null);

  useEffect(() => {
    if (!serverUrl) return;
    let cancelled = false;
    initCore(serverUrl).then(c => { if (!cancelled) setCore(c); });
    return () => { cancelled = true; core?.close(); };
  }, [serverUrl]);

  if (!core) return <SplashScreen />;
  return (
    <KrytonProvider core={core}>
      {/* existing layout content */}
    </KrytonProvider>
  );
}
```

- [ ] **Step 3: Smoke test**

Run: `npx expo start --ios` (or simulator). Expected: app boots through splash, reaches main view.

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat: wrap app in KrytonProvider with core init lifecycle"
```

---

## Task MOB-4: Simplify `src/lib/storage.ts`

**Files:**
- Modify: `src/lib/storage.ts`

- [ ] **Step 1: Remove last-sync helpers (now in core)**

Strip `getLastSyncAt` / `setLastSyncAt` if they exist. Keep token helpers.

- [ ] **Step 2: Run any existing storage tests**

Run: `npm test -- storage` (if such tests exist)
Expected: passes (or no tests, fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/storage.ts
git commit -m "refactor: remove last-sync helpers from storage (moved to core)"
```

---

## Task MOB-5: Strip sync methods from `src/lib/api.ts`

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Remove sync methods**

Delete `syncPull` and `syncPush` from the api module. Keep auth (login/register/2fa), version probe (still useful for pre-login compat checks).

- [ ] **Step 2: Verify references**

Run: `grep -rn "api.syncPull\|api.syncPush" src app`
Expected: no matches (callers replaced by core).

If there are residual references, they're from screens not yet migrated; mark them as MOB-23/etc and proceed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "refactor: remove sync methods from api.ts (moved to core)"
```

---

## Task MOB-6: Delete `src/db/` and `src/lib/versionCheck.ts`

**Files:**
- Delete: `src/db/schema.ts`, `src/db/index.ts`, `src/db/sync.ts`, `src/lib/versionCheck.ts`

- [ ] **Step 1: Verify no remaining imports**

Run: `grep -rn "from.*src/db\|from \"@/db\|from.*versionCheck" src app`
Expected: no matches. If any, fix the importer first (point to core).

- [ ] **Step 2: Delete**

Run:
```bash
rm src/db/schema.ts src/db/index.ts src/db/sync.ts src/lib/versionCheck.ts
rmdir src/db
```

- [ ] **Step 3: Verify build still works**

Run: `npx expo prebuild --clean` (or just typecheck): `npx tsc --noEmit`
Expected: clean. If errors, fix them.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete src/db and versionCheck (replaced by @azrtydxb/core)"
```

---

## Task MOB-7: Logout + reset-on-logout flow

**Files:**
- Modify: existing logout handler (likely in `src/lib/api.ts` or settings screen)

- [ ] **Step 1: Replace logout with core-aware version**

```ts
async function logout(core: Kryton) {
  await core.sync.stopAuto();
  await core.close();
  storage.clear();
  await SecureStore.deleteItemAsync("kryton.coreMigrationDone");
  // Delete the new SQLite file
  await FileSystem.deleteAsync(`${FileSystem.documentDirectory}SQLite/kryton-core.db`, { idempotent: true });
}
```

- [ ] **Step 2: Wire into settings/logout button**

The logout button now calls `logout(core)` (`core` from `useKryton()`).

- [ ] **Step 3: Smoke test**

Manual: log in, log out, log in again — confirm fresh state.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: logout closes core and clears migration sentinel"
```

---

## Task MOB-8: Sync UI affordances

**Files:**
- Modify: existing top bar / status indicator components (location varies; find via grep for "online" or "sync")

- [ ] **Step 1: Replace existing sync status code with hook**

```tsx
import { useSyncStatus } from "@azrtydxb/core-react";

function SyncBanner() {
  const status = useSyncStatus();
  if (!status.online) return <Banner>Offline — changes saved locally</Banner>;
  if (status.pending > 0) return <Banner>Syncing {status.pending} changes…</Banner>;
  return null;
}
```

- [ ] **Step 2: Replace pull-to-refresh in note list**

```tsx
const core = useKryton();
const onRefresh = async () => { await core.sync.full(); };
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: useSyncStatus-driven sync banner + pull-to-refresh via core"
```

---

## Task MOB-9: Stream 3A gate

- [ ] **Step 1: Run mobile tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Run app smoke**

Manual: install on simulator, log in, see notes, see sync banner. Logout/login cycle.

Stream 3A complete.

---

# Stream 3B — UI hooks migration

For each screen / component currently calling `db.getAllSync` or `db.runSync`, replace with hooks. Below is the canonical migration pattern, followed by per-file tasks.

## Migration pattern

Before (typical):
```tsx
import { getDatabase } from "@/db";
const [notes, setNotes] = useState<NoteRow[]>([]);
useEffect(() => {
  setNotes(getDatabase().getAllSync("SELECT * FROM notes WHERE path LIKE ?", [`${folder}/%`]));
}, [folder]);
```

After:
```tsx
import { useNotes, useKryton } from "@azrtydxb/core-react";
const notes = useNotes(); // or core.notes.listByFolder(folder) if filter not in hook
const core = useKryton();
const filtered = useMemo(() => core.notes.listByFolder(folder), [core, folder, /*re-run on change*/notes]);
```

Mutations:
```tsx
// Before
db.runSync("UPDATE notes SET title=? WHERE id=?", [title, id]);
// After
core.notes.update(id, { title });
```

## Task MOB-10: Migrate `app/(app)/(tabs)/notes.tsx`

**Files:**
- Modify: `app/(app)/(tabs)/notes.tsx`

- [ ] **Step 1: Locate db.* calls**

Run: `grep -n "db\.\|getDatabase()" app/(app)/(tabs)/notes.tsx`

- [ ] **Step 2: Replace with hooks**

Apply migration pattern above.

- [ ] **Step 3: Manual smoke**

Run app, navigate to Notes tab; list should populate.

- [ ] **Step 4: Commit**

```bash
git add app/(app)/(tabs)/notes.tsx
git commit -m "refactor(notes-tab): migrate to @azrtydxb/core-react hooks"
```

---

## Task MOB-11 through MOB-22: Migrate remaining UI files (one task per file)

For each of the following, apply the same migration pattern in its own task with its own commit:

- `app/(app)/(tabs)/search.tsx` (MOB-11)
- `app/(app)/(tabs)/graph.tsx` (MOB-12)
- `app/(app)/(tabs)/note/[...path].tsx` (MOB-13)
- `app/(app)/(tabs)/_layout.tsx` (MOB-14)
- `src/components/NoteList.tsx` or equivalent (MOB-15)
- `src/components/FileTree.tsx` (MOB-16)
- `src/components/FavoritesSection.tsx` (MOB-17)
- `src/components/Breadcrumbs.tsx` (MOB-18)
- `src/components/OfflineBanner.tsx` (MOB-19)
- `src/components/SyncStatus.tsx` (MOB-20)
- Any settings screen (MOB-21)
- Any sharing screen (MOB-22)

Per file:

- [ ] **Step 1:** `grep -n "db\.\|getDatabase()" <file>`
- [ ] **Step 2:** Replace each call with the appropriate hook or `core.*` invocation. Use `useNotes`, `useFolders`, `useTags`, `useSettings` for reads; use `core.notes.update` etc. for writes.
- [ ] **Step 3:** Manual smoke (navigate to screen).
- [ ] **Step 4:** Commit one file per task: `git add <file> && git commit -m "refactor(<area>): migrate to @azrtydxb/core-react hooks"`

After all files migrated:

- [ ] **Final check:** `grep -rn "db\.\|getDatabase()" src app` returns nothing.

Stream 3B complete.

---

# Stream 3C — WebView Yjs editor

The WebView CodeMirror editor previously read note content from the column on open and wrote it back on debounced save. New flow: editor receives Yjs document state on mount, applies updates from Yjs as remote changes arrive, and emits Yjs updates back through the bridge.

## Task MOB-23: WebView bundle — add y-codemirror.next binding

**Files:**
- Modify: `src/webview/codemirror-bundle/index.ts` (or whatever the bundle entry is)
- Add: `src/webview/codemirror-bundle/yjs-binding.ts`

- [ ] **Step 1: Add y-codemirror.next dep**

Inside the WebView bundle's package.json (likely a separate inner package; check existing structure):

```json
"dependencies": {
  ...,
  "y-codemirror.next": "^0.3.5",
  "yjs": "^13.6.0"
}
```

- [ ] **Step 2: Implement binding**

```ts
// src/webview/codemirror-bundle/yjs-binding.ts
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import type { Extension } from "@codemirror/state";

export interface YjsBindingHandles {
  doc: Y.Doc;
  yText: Y.Text;
  extension: Extension;
  applyRemoteUpdate(update: Uint8Array): void;
  destroy(): void;
}

export function createYjsBinding(initialState?: Uint8Array): YjsBindingHandles {
  const doc = new Y.Doc();
  if (initialState) Y.applyUpdate(doc, initialState);
  const yText = doc.getText("body");
  const extension = yCollab(yText, /*awareness*/ null);
  return {
    doc, yText, extension,
    applyRemoteUpdate: (u) => Y.applyUpdate(doc, u, "remote"),
    destroy: () => doc.destroy(),
  };
}

export function listenLocalUpdates(doc: Y.Doc, callback: (update: Uint8Array) => void): () => void {
  const handler = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return; // don't echo remote updates back
    callback(update);
  };
  doc.on("update", handler);
  return () => doc.off("update", handler);
}
```

- [ ] **Step 3: Wire into editor mount**

In the existing CodeMirror init code inside the bundle, replace the "init from text content" path with "init from Yjs binding":

```ts
const { doc, yText, extension, applyRemoteUpdate, destroy } = createYjsBinding();
const view = new EditorView({
  state: EditorState.create({
    extensions: [...existingExtensions, extension],
  }),
  parent: editorRoot,
});
const unsubscribe = listenLocalUpdates(doc, (u) => postMessageToRn({ type: "yjs:update", payload: base64Encode(u) }));
window.applyRemoteYjsUpdate = (b64: string) => applyRemoteUpdate(base64Decode(b64));
```

- [ ] **Step 4: Build the bundle**

The mobile project has a build step for the WebView bundle (likely `npm run build:webview`). Run it.

- [ ] **Step 5: Commit**

```bash
git add src/webview/codemirror-bundle/
git commit -m "feat(webview): y-codemirror.next binding inside the bundle"
```

---

## Task MOB-24: WebView bridge — RN side wiring

**Files:**
- Modify: `src/webview/EditorBridge.tsx`

- [ ] **Step 1: Replace content-channel wiring**

Strip code that reads `note.content` and writes it back. Replace with:

```tsx
import { useYjsDoc } from "@azrtydxb/core-react";
import * as Y from "yjs";

function EditorBridge({ noteId }: { noteId: string }) {
  const yDoc = useYjsDoc(noteId);
  const webviewRef = useRef<WebView>(null);

  // On mount: send full Yjs state to webview after it loads.
  const onWebviewLoad = () => {
    if (!yDoc) return;
    const state = Y.encodeStateAsUpdate(yDoc);
    webviewRef.current?.postMessage(JSON.stringify({
      type: "yjs:initial-state",
      payload: btoa(String.fromCharCode(...state)),
    }));
  };

  // Local Yjs updates from RN side flow to WebView
  useEffect(() => {
    if (!yDoc) return;
    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === "webview") return;
      webviewRef.current?.postMessage(JSON.stringify({
        type: "yjs:remote-update",
        payload: btoa(String.fromCharCode(...update)),
      }));
    };
    yDoc.on("update", handler);
    return () => yDoc.off("update", handler);
  }, [yDoc]);

  // WebView → RN: apply local edits to the Yjs doc, propagate via core
  const onWebviewMessage = (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data);
    if (msg.type === "yjs:update" && yDoc) {
      const bytes = Uint8Array.from(atob(msg.payload), c => c.charCodeAt(0));
      Y.applyUpdate(yDoc, bytes, "webview");
    }
  };

  return (
    <WebView
      ref={webviewRef}
      onLoad={onWebviewLoad}
      onMessage={onWebviewMessage}
      source={{ uri: "asset://codemirror.html" }}
    />
  );
}
```

- [ ] **Step 2: Smoke test**

Open a note in mobile, type in the editor, observe the change persist (close/reopen note → text retained). Open the same note via web client → text appears.

- [ ] **Step 3: Commit**

```bash
git add src/webview/EditorBridge.tsx
git commit -m "feat(webview): RN-side Yjs bridge to/from WebView CodeMirror"
```

---

## Task MOB-25: PreviewBridge — read-only via core.notes.readContent

**Files:**
- Modify: `src/webview/PreviewBridge.tsx`

- [ ] **Step 1: Replace content read**

```tsx
const core = useKryton();
const content = useMemo(() => core.notes.readContent(noteId) ?? "", [core, noteId]);
```

(`readContent` is a synchronous helper in core that returns the current Yjs text without opening a WS subscription. If not yet implemented in core, add it as a quick task there.)

- [ ] **Step 2: Pass to WebView**

```tsx
webviewRef.current?.postMessage(JSON.stringify({ type: "preview:content", payload: content }));
```

- [ ] **Step 3: Smoke**

Open the preview view of a note; rendered markdown matches editor.

- [ ] **Step 4: Commit**

```bash
git add src/webview/PreviewBridge.tsx
git commit -m "feat(webview): PreviewBridge sources content from core (read-only)"
```

---

## Task MOB-26: Awareness — show "X is editing" badges

**Files:**
- Modify: `app/(app)/(tabs)/note/[...path].tsx`

- [ ] **Step 1: Subscribe to Yjs awareness via core**

Add a helper hook in the mobile project (since it's mobile-specific UI):

```ts
// src/hooks/useEditorAwareness.ts
import { useEffect, useState } from "react";
import { useKryton } from "@azrtydxb/core-react";
import * as Y from "yjs";

export function useEditorAwareness(noteId: string) {
  const core = useKryton();
  const [peers, setPeers] = useState<Array<{ kind: "user" | "agent"; label: string }>>([]);

  useEffect(() => {
    let active = true;
    let yDoc: Y.Doc | null = null;
    let manager: any = null;

    (async () => {
      yDoc = await core.yjs.openDocument(noteId);
      // Get awareness instance from core internals (exposed for this purpose)
      const awareness = core.yjs.getAwareness(noteId);
      if (!awareness) return;
      const update = () => {
        if (!active) return;
        const states = [...awareness.getStates().values()] as any[];
        setPeers(states.filter(s => s.kind).map(s => ({ kind: s.kind, label: s.label ?? "?" })));
      };
      awareness.on("update", update);
      update();
      manager = () => awareness.off("update", update);
    })();

    return () => {
      active = false;
      manager?.();
      core.yjs.closeDocument(noteId);
    };
  }, [core, noteId]);

  return peers;
}
```

(`core.yjs.getAwareness` is a method to be added to core's YjsManager; trivial — return the entry's awareness.)

- [ ] **Step 2: Render badges**

```tsx
const peers = useEditorAwareness(noteId);
return (
  <View>
    {peers.map(p => <Badge key={p.label} kind={p.kind}>{p.label}</Badge>)}
    <EditorBridge noteId={noteId} />
  </View>
);
```

- [ ] **Step 3: Smoke**

Open the same note on mobile + web client; badges show "User: Pascal" on each side.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useEditorAwareness.ts app/(app)/(tabs)/note/
git commit -m "feat(webview): awareness badges for connected peers"
```

---

## Task MOB-27: Stream 3C gate

- [ ] **Step 1: Run mobile tests**

Run: `npm test`

- [ ] **Step 2: End-to-end manual smoke**

- Install fresh on iOS sim (or device): goes through migration on first launch.
- Log in: notes appear.
- Open a note, type text — saved locally.
- Open same note on web: see text.
- Edit on web — see updates appear in mobile editor live.
- Disconnect network, edit on mobile, reconnect — changes propagate.

Stream 3C complete; Phase 3 gate satisfied.

---

# Phase 4 — Hardening (subset relevant to mobile)

## Task MOB-28: E2E tests with Detox

**Files:**
- Create: `e2e/sync-convergence.test.ts`
- Create: `e2e/migration-resilience.test.ts`

- [ ] **Step 1: Install Detox**

Run: `npm install --save-dev detox @types/detox jest-circus`

- [ ] **Step 2: Detox config (`.detoxrc.js`)**

(Standard Detox setup; see Detox docs.)

- [ ] **Step 3: Write convergence test**

```ts
// e2e/sync-convergence.test.ts
describe("sync convergence", () => {
  it("note created on mobile appears after pull", async () => {
    await loginAsTestUser();
    await element(by.id("new-note-btn")).tap();
    await element(by.id("note-title-input")).typeText("e2e-test-note");
    await element(by.id("save-btn")).tap();
    // Pull-to-refresh
    await element(by.id("notes-list")).swipe("down", "fast");
    await expect(element(by.text("e2e-test-note"))).toBeVisible();
  });
});
```

- [ ] **Step 4: Run E2E in CI**

Add a workflow that runs Detox on a macOS runner with iOS simulator.

- [ ] **Step 5: Commit**

```bash
git add e2e/ .detoxrc.js .github/workflows/e2e.yml
git commit -m "test: Detox E2E convergence + migration suites"
```

---

## Task MOB-29: Final sweep — strip legacy assumptions

**Files:** ad-hoc

- [ ] **Step 1: Search for stale references**

Run:
```bash
grep -rn "kryton\.db\|expo-sqlite\|getDatabase()" src app
```
Expected: only references inside `src/core.ts` (the migration deletion path) and inside core-react bindings (acceptable).

- [ ] **Step 2: Search for any leftover sync code**

Run: `grep -rn "syncPull\|syncPush\|/api/sync/pull\|/api/sync/push" src app`
Expected: no matches (legacy endpoints not referenced from mobile).

- [ ] **Step 3: Commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final sweep removes any leftover legacy data-layer references"
```

---

## Self-review

- [ ] Every step has actual code or actual command.
- [ ] All UI files that read from `db.*` are migrated to hooks (Stream 3B's task list explicit).
- [ ] WebView Yjs binding is the new content channel; old text content channel removed.
- [ ] First-launch migration deletes legacy DB and sets sentinel.
- [ ] Logout flow clears the sentinel so next login re-migrates a fresh DB.

## Open implementation questions deferred to execution

1. The "y-codemirror.next" version pinned in the bundle must match `@codemirror/state` and `@codemirror/view` versions used by Kryton's editor — confirm at execution.
2. `core.yjs.getAwareness(noteId)` method on YjsManager — small extension to core, add as task CORE-44 (parking lot during execution).
3. WebView postMessage size limits: large initial Yjs states (multi-MB notes) may need chunking. Profile during smoke; if hit, add chunking.
4. Detox iOS-only initially; Android E2E added later.
5. The exact list of UI files to migrate (MOB-11 through MOB-22) needs finalization at execution time after running `grep -rn "db\." src app` against the real repo.
