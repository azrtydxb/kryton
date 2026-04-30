# Mobile Migration to `@kryton/core` — Design Spec

**Status:** Approved for implementation planning.
**Sub-project:** 4 of 5.
**Repository:** [`azrtydxb/kryton-mobile`](https://github.com/azrtydxb/kryton-mobile) (separate repo).
**Depends on:** kryton-core spec, server-sync-v2 spec, core-publishing spec.

## Purpose

Replace mobile's bespoke `expo-sqlite` + sync code with `@kryton/core`. Mobile keeps its UI, navigation, auth flow, and Expo platform integrations; only the data layer changes.

## Scope

This spec covers code changes within `kryton-mobile` only. Server changes are in the v2 sync spec; the published library is in the kryton-core spec.

## Current state (pre-migration)

```
kryton-mobile/
├── src/
│   ├── db/
│   │   ├── schema.ts       # raw SQL DDL for 4 tables
│   │   ├── index.ts        # expo-sqlite open + helpers
│   │   └── sync.ts         # hand-rolled pull/push to /api/sync
│   ├── lib/
│   │   ├── api.ts          # HTTP client + auth
│   │   ├── storage.ts      # secure-store wrapper for token + last-sync
│   │   ├── versionCheck.ts # server compatibility check
│   │   └── ...
│   ├── components/         # NoteList, FileTree, ... directly call db helpers
│   ├── hooks/              # useNotes, useFolderTree call db.getAllSync(...)
│   ├── screens/            # via expo-router
│   └── webview/            # CodeMirror + graph WebView bridges
├── app/                    # expo-router file-based routes
└── package.json
```

Notes about the current implementation:
- No reactive layer; screens manually call `db.getAllSync(...)` on mount and on focus.
- Sync triggered on app foreground + on a 60 s timer.
- Notes are stored as full content in `notes.content TEXT` column.
- Editor is a WebView running CodeMirror; current state is read out of the column on open and written back on debounced save.

## Target state (post-migration)

```
kryton-mobile/
├── src/
│   ├── core.ts             # NEW: instantiates Kryton + ExpoSqliteAdapter
│   ├── lib/
│   │   ├── api.ts          # KEPT (auth-only HTTP, login/register/logout)
│   │   ├── storage.ts      # KEPT (secure-store wrapper, simplified)
│   │   └── ...
│   ├── components/         # MIGRATED: use @kryton/core-react hooks
│   ├── hooks/              # REMOVED: replaced by core-react hooks
│   ├── screens/            # MIGRATED
│   └── webview/            # MIGRATED: editor sources content from Y.Doc, not column
└── package.json            # adds @kryton/core, @kryton/core-react
```

`src/db/`, `src/lib/sync.ts` (if exists), `src/lib/versionCheck.ts` are deleted.

## Migration approach

Per the architectural decision: **wipe and re-sync** on first launch with the new build. No legacy data preservation; the userbase is dev-only.

### First-launch flow

```
App start
  ├─ Detect version of installed app
  ├─ Read sentinel from SecureStore: kryton.coreMigrationDone
  │    ├─ true  → normal startup
  │    └─ false (or missing) → migration mode
  │         ├─ Show splash: "Updating Kryton — please wait"
  │         ├─ Delete old kryton.db file
  │         ├─ Initialize Kryton.init() (creates new schema)
  │         ├─ Trigger core.sync.full()
  │         ├─ Set kryton.coreMigrationDone = true
  │         └─ Continue to normal startup
```

This logic lives in `src/core.ts`. If the user is offline and the migration runs, the app proceeds with an empty local DB; sync happens when network returns. The splash includes a "Skip and sync later" option after 10 s.

## Code changes by area

### `src/core.ts` (new file)

```ts
import { Kryton } from "@kryton/core";
import { ExpoSqliteAdapter } from "@kryton/core/adapters/expo-sqlite";
import * as FileSystem from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { storage } from "./lib/storage";

const MIGRATION_DONE_KEY = "kryton.coreMigrationDone";
const OLD_DB_NAME = "kryton.db";

export async function initCore(serverUrl: string): Promise<Kryton> {
  const migrated = await SecureStore.getItemAsync(MIGRATION_DONE_KEY);

  if (migrated !== "true") {
    // Wipe legacy DB
    const dbPath = `${FileSystem.documentDirectory}SQLite/${OLD_DB_NAME}`;
    try { await FileSystem.deleteAsync(dbPath, { idempotent: true }); } catch {}
  }

  const core = await Kryton.init({
    adapter: new ExpoSqliteAdapter("kryton-core.db"),
    serverUrl,
    authToken: () => storage.getToken(),
  });

  if (migrated !== "true") {
    try {
      await core.sync.full();
    } catch (err) {
      // Non-fatal — user may be offline. Will retry on app foreground.
      console.warn("Initial sync failed; will retry", err);
    }
    await SecureStore.setItemAsync(MIGRATION_DONE_KEY, "true");
  }

  core.sync.startAuto({ intervalMs: 60_000 });
  return core;
}
```

### `App.tsx` / root `_layout.tsx`

Wrap the app in `KrytonProvider`:

```tsx
import { KrytonProvider } from "@kryton/core-react";
import { initCore } from "@/core";

const [core, setCore] = useState<Kryton | null>(null);
useEffect(() => { initCore(serverUrl).then(setCore); }, [serverUrl]);
if (!core) return <SplashScreen />;
return <KrytonProvider core={core}>{children}</KrytonProvider>;
```

### Components and screens

For each screen/component currently doing `db.getAllSync(...)`:

```tsx
// Before
const [notes, setNotes] = useState<NoteRow[]>([]);
useEffect(() => {
  setNotes(db.getAllSync("SELECT * FROM notes WHERE path LIKE ?", [`${folder}/%`]));
}, [folder]);

// After
import { useNotes } from "@kryton/core-react";
const notes = useNotes({ folderPath: folder });
```

For mutations:

```tsx
// Before
db.runSync("UPDATE notes SET title=?, _status='updated' WHERE id=?", [newTitle, id]);

// After
import { useKryton } from "@kryton/core-react";
const core = useKryton();
core.notes.update(id, { title: newTitle });
```

Mutations remain on the imperative `core.*` API per the architectural decision (write paths shouldn't go through React hooks).

### Editor (WebView CodeMirror bridge)

Current: editor message bus reads/writes the note's `content` column on open/save.

New: editor opens a Yjs document via `core.notes.openDocument(noteId)`. Yjs CodeMirror binding (`y-codemirror.next`) wires the doc to the editor inside the WebView. The bridge no longer ferries content text — it ferries Yjs updates.

WebView changes (separate from this spec's scope but tracked here):
- Bundle `y-codemirror.next` into the WebView's CodeMirror build.
- WebView ↔ RN bridge sends Yjs updates as binary base64 in both directions.
- On editor mount: WebView requests "give me the doc state vector"; RN side returns Yjs sync step 1 from `core.notes.openDocument(...).getState()`.
- On disconnect (screen unmount): RN calls `core.notes.closeDocument(noteId)`.

The `react-native-webview` payload limits (~MB-ish for postMessage) are fine for normal note editing; pathological cases (10MB notes with high op rates) may need chunking — flagged as future work.

### Auth flow

Login still uses `src/lib/api.ts`. After login success:

```ts
storage.setToken(token);
await core.sync.full(); // populate fresh user data
```

Logout:

```ts
core.sync.stopAuto();
await core.close();
storage.clear();
await SecureStore.deleteItemAsync(MIGRATION_DONE_KEY); // re-trigger migration on next login
// Delete the SQLite file so next login starts clean
```

### Sync UI affordances

- Online/offline banner: `useSyncStatus().online`.
- "Last synced: 2m ago": `useSyncStatus().lastPullAt`.
- Pending changes badge: `useSyncStatus().pending`.
- Pull-to-refresh in note list: calls `core.sync.full()`.

These are minor UI adjustments to existing components, not new screens.

### Yjs awareness UI (cursors / "X is editing")

Mobile editor displays awareness state from other connected clients in a top bar:

- Avatars/initials of other connected human users.
- Agent indicators with label ("Claude analyzing...").
- Live cursor positions are out of scope for v1 (mobile screen real estate makes this awkward); only presence is shown.

## `package.json` changes

```json
{
  "dependencies": {
    "@kryton/core": "^4.4.0",
    "@kryton/core-react": "^4.4.0",
    "yjs": "^13.6.0"
  },
  "scripts": {
    "dev:link": "node scripts/dev-link.js link",
    "dev:unlink": "node scripts/dev-link.js unlink"
  }
}
```

`scripts/dev-link.js` swaps `@kryton/core` and `@kryton/core-react` between published versions and `file:../kryton/packages/core` paths. Defaults to `../kryton/` relative to the mobile repo (the standard sibling layout under `Kryton/`); overridable via `KRYTON_LOCAL_PATH=/some/abs/path`. Implementation uses `npm pkg set` and `npm install` under the hood.

A `.npmrc` in the mobile repo configures the GitHub Packages registry for `@kryton`:

```
@kryton:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

CI sets `GITHUB_TOKEN`; developers set it in their shell.

## Files to delete

- `src/db/schema.ts`
- `src/db/index.ts`
- `src/db/sync.ts`
- `src/lib/versionCheck.ts` (now in core)
- Any helper functions in `src/lib/` that wrap raw SQL.

## Files to update

- All screens under `app/`.
- Components in `src/components/` that read or write notes/settings/shares/trash directly.
- `src/lib/api.ts` — strip out sync endpoints, keep only auth + version probe (the version probe moves into core, but api.ts may still call it during login pre-flight).
- `src/lib/storage.ts` — remove `getLastSyncAt`/`setLastSyncAt` (now in core's `sync_state`); keep token storage.
- WebView bridge code — Yjs integration described above.
- `App.tsx` / root `_layout.tsx` — Provider setup.

## Testing strategy

- **Smoke:** new install → login → see notes synced from server → create a note → see it on web client.
- **Migration:** install old version, create some notes, install new version → confirm migration runs, old notes appear (they will, because they came from server originally).
- **Offline:** disconnect network → edit a note → reconnect → confirm push.
- **Yjs convergence:** open same note on mobile + web client (once web supports Yjs editing — not in v1 of this spec); concurrent edits should converge.
- **Migration failure:** simulate network failure during initial sync → confirm "Skip" path works → confirm app remains functional with empty local data → confirm subsequent sync recovers.

Existing Jest test infra is preserved; new tests added per migrated component.

## Performance notes

- App cold-start time: should not regress. Migration only runs once; subsequent launches go through the normal core init path which mirrors current `getDatabase()` cost.
- Memory: Yjs documents in memory cost ~1.5x the text size. For users with many open notes, mobile should aggressively close docs (already implemented as "close on screen blur"). Cap concurrent open docs at 5.
- WebView ↔ RN message frequency for Yjs: throttled to 10 ops/sec on the WebView side (CodeMirror's debounced updates) so postMessage isn't saturated.

## Out of scope for v1

- Shared multi-user editing of the same note (server-side spec doesn't support yet).
- Live cursor display in mobile editor.
- Offline-first attachment downloads (attachments fetch on demand via core's tier 2 cache).
- Replacing the auth flow (passkeys, 2FA) — those still use existing `api.ts` paths.
- Adopting `@kryton/core` for non-data UI state (settings panel form state, navigation state, etc.) — those stay in local component state.

## Risks

1. **Yjs WebView integration is the biggest unknown.** The current editor is a CodeMirror bundle in a WebView with a custom bridge; replacing the content channel with Yjs binary updates is non-trivial. Mitigation: prototype in a branch before declaring this work "done."
2. **`expo-sqlite` adapter performance** under heavy reactive subscription churn — many `useNotes()` calls all re-evaluating on every change event. Mitigation: profile at the end of implementation; if hot, add coarse-grained invalidation buckets in core.
3. **Bundle size impact:** `@kryton/core` + Yjs + dependencies likely add 200-400 KB to the JS bundle. Within Expo's typical envelope but worth measuring.

## Open implementation questions

1. Should `dev:link` be in `kryton-mobile/scripts/` or in a shared dev tool that future kryton-desktop also uses? (Probably the latter — small CLI in `@kryton/dev-tools` package.)
2. Do we want a dedicated migration screen or fold the splash into the existing one?
3. Should agent management UI (create agents, manage policies) live in mobile, or only in the web client? (Probably web only for v1; mobile read-only views agents.)
