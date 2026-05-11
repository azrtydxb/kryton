# Kryton Mobile App Implementation Plan

> **⚠️ SUPERSEDED — Historical record only.**
> This plan describes the WatermelonDB-based approach that was implemented in March 2026 but later replaced.
> The current mobile architecture is documented in:
> - Spec: [`docs/superpowers/specs/2026-04-30-mobile-core-migration-design.md`](../specs/2026-04-30-mobile-core-migration-design.md)
> - Plan: [`docs/superpowers/plans/2026-04-30-mobile-core-migration.md`](2026-04-30-mobile-core-migration.md)
>
> Mobile now consumes `@azrtydxb/core` + `@azrtydxb/core-react`, syncs via `/api/sync/v2`, and uses Yjs for note content. WatermelonDB has been removed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React Native mobile app with offline-first sync, full feature parity with the web app, using WatermelonDB and WebView for the editor/graph.

**Architecture:** Expo managed workflow with Expo Router for navigation. WatermelonDB manages local SQLite with bidirectional sync via `POST /api/sync/pull` and `/api/sync/push`. CodeMirror editor and D3 graph run in WebViews with postMessage bridges. Auth uses API keys stored in expo-secure-store.

**Tech Stack:** Expo SDK 53, Expo Router, WatermelonDB, React Native WebView, expo-secure-store, react-native-toast-message

**Spec:** `docs/superpowers/specs/2026-03-26-mobile-app-design.md`
**Prerequisite:** `docs/superpowers/plans/2026-03-26-server-sync-endpoints.md` must be implemented first

---

## File Structure

```
packages/mobile/
├── app/
│   ├── _layout.tsx                 # Root layout — DatabaseProvider + AuthGuard
│   ├── (auth)/
│   │   ├── _layout.tsx             # Auth layout
│   │   ├── server.tsx              # Server URL input screen
│   │   ├── login.tsx               # Email/password login
│   │   ├── register.tsx            # Registration form
│   │   └── two-factor.tsx          # TOTP input screen
│   └── (app)/
│       ├── _layout.tsx             # App layout with auth guard
│       ├── (tabs)/
│       │   ├── _layout.tsx         # Tab bar config
│       │   ├── notes.tsx           # File tree + favorites
│       │   ├── search.tsx          # Full-text search
│       │   ├── graph.tsx           # Graph in WebView
│       │   ├── tags.tsx            # Tag list
│       │   └── settings.tsx        # Settings + account
│       ├── note/[...path].tsx      # Note view/edit
│       ├── daily.tsx               # Daily note
│       ├── templates.tsx           # Template picker
│       ├── trash.tsx               # Trash list
│       ├── history/[...path].tsx   # Version history
│       ├── sharing.tsx             # Shares management
│       └── admin.tsx               # Admin panel
├── src/
│   ├── db/
│   │   ├── index.ts               # Database initialization
│   │   ├── schema.ts              # WatermelonDB schema
│   │   ├── models/
│   │   │   ├── Note.ts
│   │   │   ├── Setting.ts
│   │   │   ├── NoteShareModel.ts
│   │   │   └── TrashItemModel.ts
│   │   └── sync.ts                # WatermelonDB sync adapter
│   ├── components/
│   │   ├── FileTree.tsx
│   │   ├── NoteListItem.tsx
│   │   ├── FavoritesSection.tsx
│   │   ├── Breadcrumbs.tsx
│   │   ├── OfflineBanner.tsx
│   │   ├── SyncStatus.tsx
│   │   ├── TagBadge.tsx
│   │   └── FrontmatterBlock.tsx
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useSync.ts
│   │   ├── useNotes.ts
│   │   ├── useNetworkStatus.ts
│   │   └── useServerUrl.ts
│   ├── lib/
│   │   ├── api.ts                  # HTTP client
│   │   ├── theme.ts                # Colors + typography
│   │   ├── storage.ts              # expo-secure-store wrapper
│   │   └── frontmatter.ts          # Frontmatter parser (copy from web)
│   └── webview/
│       ├── editor.html             # CodeMirror bundle
│       ├── graph.html              # D3 graph bundle
│       └── EditorBridge.tsx        # WebView + postMessage wrapper
├── assets/                         # App icon, splash
├── app.json                        # Expo config
├── babel.config.js                 # Babel for WatermelonDB
├── metro.config.js                 # Metro bundler config
├── package.json
└── tsconfig.json
```

---

### Task 1: Expo Project Scaffold

**Files:**
- Create: `packages/mobile/package.json`
- Create: `packages/mobile/app.json`
- Create: `packages/mobile/tsconfig.json`
- Create: `packages/mobile/babel.config.js`
- Create: `packages/mobile/metro.config.js`
- Create: `packages/mobile/app/_layout.tsx`

- [ ] **Step 1: Initialize Expo project**

```bash
cd packages && npx create-expo-app mobile --template blank-typescript
cd mobile
```

- [ ] **Step 2: Install core dependencies**

```bash
npx expo install expo-router expo-secure-store expo-web-browser expo-linking react-native-webview react-native-toast-message @nozbe/watermelondb @nozbe/with-observables expo-build-properties
npm install --save-dev @babel/plugin-proposal-decorators
```

- [ ] **Step 3: Configure babel.config.js for WatermelonDB**

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [["@babel/plugin-proposal-decorators", { legacy: true }]],
  };
};
```

- [ ] **Step 4: Configure app.json**

```json
{
  "expo": {
    "name": "Kryton",
    "slug": "kryton",
    "version": "1.0.0",
    "scheme": "kryton",
    "platforms": ["ios", "android"],
    "icon": "./assets/icon.png",
    "splash": { "image": "./assets/splash.png", "backgroundColor": "#0d1117" },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      ["expo-build-properties", {
        "android": { "kotlinVersion": "1.9.25" },
        "ios": { "deploymentTarget": "15.1" }
      }]
    ]
  }
}
```

- [ ] **Step 5: Create root layout**

```typescript
// app/_layout.tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 6: Verify it runs**

```bash
npx expo start
```
Expected: Expo dev server starts, app loads blank screen

- [ ] **Step 7: Commit**

```bash
git add packages/mobile/
git commit -m "feat(mobile): scaffold Expo project with dependencies"
```

---

### Task 2: Theme, Storage, and API Client

**Files:**
- Create: `packages/mobile/src/lib/theme.ts`
- Create: `packages/mobile/src/lib/storage.ts`
- Create: `packages/mobile/src/lib/api.ts`

- [ ] **Step 1: Create theme**

```typescript
// src/lib/theme.ts
export const colors = {
  background: "#0d1117",
  surface: "#111827",
  surfaceLight: "#1a1f2e",
  primary: "#7c3aed",
  primaryHover: "#6d28d9",
  text: "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
  border: "#374151",
  error: "#ef4444",
  success: "#22c55e",
  warning: "#eab308",
  star: "#eab308",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const fontSize = { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 };
export const borderRadius = { sm: 6, md: 8, lg: 12 };
```

- [ ] **Step 2: Create storage wrapper**

```typescript
// src/lib/storage.ts
import * as SecureStore from "expo-secure-store";

const KEYS = {
  serverUrl: "kryton_server_url",
  apiKey: "kryton_api_key",
  lastSyncAt: "kryton_last_sync_at",
};

export const storage = {
  getServerUrl: () => SecureStore.getItemAsync(KEYS.serverUrl),
  setServerUrl: (url: string) => SecureStore.setItemAsync(KEYS.serverUrl, url),
  getApiKey: () => SecureStore.getItemAsync(KEYS.apiKey),
  setApiKey: (key: string) => SecureStore.setItemAsync(KEYS.apiKey, key),
  clearAuth: async () => {
    await SecureStore.deleteItemAsync(KEYS.apiKey);
  },
  getLastSyncAt: async () => {
    const val = await SecureStore.getItemAsync(KEYS.lastSyncAt);
    return val ? parseInt(val, 10) : 0;
  },
  setLastSyncAt: (ts: number) =>
    SecureStore.setItemAsync(KEYS.lastSyncAt, String(ts)),
};
```

- [ ] **Step 3: Create API client**

```typescript
// src/lib/api.ts
import { storage } from "./storage";

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const serverUrl = await storage.getServerUrl();
  const apiKey = await storage.getApiKey();
  if (!serverUrl) throw new Error("Server URL not configured");

  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (!headers["Content-Type"] && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${serverUrl}${path}`, { ...options, headers });
  if (!res.ok && res.status === 401) {
    await storage.clearAuth();
    throw new Error("Unauthorized");
  }
  return res;
}

export const api = {
  health: () => fetch(`${arguments[0]}/api/health`).then((r) => r.ok),

  // Auth
  login: async (serverUrl: string, email: string, password: string) => {
    const res = await fetch(`${serverUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return res.json();
  },

  register: async (serverUrl: string, name: string, email: string, password: string, inviteCode?: string) => {
    const body: Record<string, string> = { name, email, password };
    if (inviteCode) body.inviteCode = inviteCode;
    const res = await fetch(`${serverUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },

  createApiKey: async (serverUrl: string, sessionCookie: string) => {
    const res = await fetch(`${serverUrl}/api/api-keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ name: "Mobile App", scope: "read-write" }),
    });
    return res.json();
  },

  // Sync
  syncPull: (lastPulledAt: number) =>
    apiFetch("/api/sync/pull", {
      method: "POST",
      body: JSON.stringify({ last_pulled_at: lastPulledAt }),
    }).then((r) => r.json()),

  syncPush: (changes: unknown, lastPulledAt: number) =>
    apiFetch("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ changes, last_pulled_at: lastPulledAt }),
    }).then((r) => r.json()),

  // Notes (online-only operations)
  getSession: () => apiFetch("/api/auth/get-session").then((r) => r.json()),
  listVersions: (path: string) => apiFetch(`/api/history/${encodeURIComponent(path)}`).then((r) => r.json()),
  getVersion: (path: string, ts: number) => apiFetch(`/api/history-version/${encodeURIComponent(path)}?ts=${ts}`).then((r) => r.json()),
  restoreVersion: (path: string, ts: number) => apiFetch(`/api/history-restore/${encodeURIComponent(path)}?ts=${ts}`, { method: "POST" }).then((r) => r.json()),
  uploadFile: (formData: FormData) => apiFetch("/api/files", { method: "POST", body: formData }).then((r) => r.json()),
  listTrash: () => apiFetch("/api/trash").then((r) => r.json()),
  restoreFromTrash: (path: string) => apiFetch(`/api/trash/restore/${encodeURIComponent(path)}`, { method: "POST" }).then((r) => r.json()),
  emptyTrash: () => apiFetch("/api/trash-empty", { method: "DELETE" }).then((r) => r.json()),

  // Admin
  listUsers: () => apiFetch("/api/admin/users").then((r) => r.json()),
  listAccessRequests: () => apiFetch("/api/access-requests").then((r) => r.json()),
};
```

- [ ] **Step 4: Commit**

```bash
git add packages/mobile/src/lib/
git commit -m "feat(mobile): add theme, secure storage, and API client"
```

---

### Task 3: WatermelonDB Setup

**Files:**
- Create: `packages/mobile/src/db/schema.ts`
- Create: `packages/mobile/src/db/models/Note.ts`
- Create: `packages/mobile/src/db/models/Setting.ts`
- Create: `packages/mobile/src/db/models/NoteShareModel.ts`
- Create: `packages/mobile/src/db/models/TrashItemModel.ts`
- Create: `packages/mobile/src/db/index.ts`
- Create: `packages/mobile/src/db/sync.ts`

- [ ] **Step 1: Define schema**

```typescript
// src/db/schema.ts
import { appSchema, tableSchema } from "@nozbe/watermelondb";

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: "notes",
      columns: [
        { name: "path", type: "string" },
        { name: "title", type: "string" },
        { name: "content", type: "string" },
        { name: "tags", type: "string" }, // JSON array
        { name: "modified_at", type: "number" },
      ],
    }),
    tableSchema({
      name: "settings",
      columns: [
        { name: "key", type: "string" },
        { name: "value", type: "string" },
      ],
    }),
    tableSchema({
      name: "note_shares",
      columns: [
        { name: "owner_user_id", type: "string" },
        { name: "path", type: "string" },
        { name: "is_folder", type: "boolean" },
        { name: "permission", type: "string" },
        { name: "shared_with_user_id", type: "string" },
      ],
    }),
    tableSchema({
      name: "trash_items",
      columns: [
        { name: "original_path", type: "string" },
        { name: "trashed_at", type: "number" },
      ],
    }),
  ],
});
```

- [ ] **Step 2: Create model classes**

```typescript
// src/db/models/Note.ts
import { Model } from "@nozbe/watermelondb";
import { field, date } from "@nozbe/watermelondb/decorators";

export default class Note extends Model {
  static table = "notes";

  @field("path") path!: string;
  @field("title") title!: string;
  @field("content") content!: string;
  @field("tags") tags!: string;
  @date("modified_at") modifiedAt!: Date;
}
```

Create similar classes for Setting, NoteShareModel, TrashItemModel.

- [ ] **Step 3: Create database instance**

```typescript
// src/db/index.ts
import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import { schema } from "./schema";
import Note from "./models/Note";
import Setting from "./models/Setting";
import NoteShareModel from "./models/NoteShareModel";
import TrashItemModel from "./models/TrashItemModel";

const adapter = new SQLiteAdapter({
  schema,
  jsi: true,
  onSetUpError: (error) => {
    console.error("WatermelonDB setup error:", error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [Note, Setting, NoteShareModel, TrashItemModel],
});
```

- [ ] **Step 4: Create sync adapter**

```typescript
// src/db/sync.ts
import { synchronize } from "@nozbe/watermelondb/sync";
import { database } from "./index";
import { api } from "../lib/api";
import { storage } from "../lib/storage";

export async function syncWithServer(): Promise<void> {
  const lastPulledAt = await storage.getLastSyncAt();

  await synchronize({
    database,
    pullChanges: async ({ lastPulledAt: lpa }) => {
      const response = await api.syncPull(lpa || 0);
      return {
        changes: response.changes,
        timestamp: response.timestamp,
      };
    },
    pushChanges: async ({ changes, lastPulledAt: lpa }) => {
      await api.syncPush(changes, lpa || 0);
    },
    migrationsEnabledAtVersion: 1,
  });

  await storage.setLastSyncAt(Date.now());
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/src/db/
git commit -m "feat(mobile): add WatermelonDB schema, models, and sync adapter"
```

---

### Task 4: Auth Screens

**Files:**
- Create: `packages/mobile/app/(auth)/_layout.tsx`
- Create: `packages/mobile/app/(auth)/server.tsx`
- Create: `packages/mobile/app/(auth)/login.tsx`
- Create: `packages/mobile/app/(auth)/register.tsx`
- Create: `packages/mobile/app/(auth)/two-factor.tsx`
- Create: `packages/mobile/src/hooks/useAuth.ts`

- [ ] **Step 1: Create auth hook**

Manages server URL, API key, and login/register/logout flows. Stores credentials in expo-secure-store. Creates an API key on successful login.

- [ ] **Step 2: Create server URL screen**

Simple input + "Connect" button. Validates with `/api/health`. Navigates to login on success.

- [ ] **Step 3: Create login screen**

Email + password form. Handles 2FA redirect. On success, creates API key, stores it, navigates to app.

Dark theme matching web: surface-950 background, violet primary buttons, Inter-style text.

- [ ] **Step 4: Create register screen**

Name, email, password, invite code (optional). Same styling as login.

- [ ] **Step 5: Create 2FA screen**

6-digit code input. Backup code option. Verifies with better-auth endpoint.

- [ ] **Step 6: Create auth layout**

Stack navigator for auth screens. No header.

- [ ] **Step 7: Update root layout with auth guard**

Check for stored API key on launch. If present and valid → app screens. If not → auth screens.

- [ ] **Step 8: Commit**

```bash
git add packages/mobile/app/(auth)/ packages/mobile/src/hooks/useAuth.ts
git commit -m "feat(mobile): add auth screens with login, register, 2FA"
```

---

### Task 5: Tab Navigation and Notes Screen

**Files:**
- Create: `packages/mobile/app/(app)/_layout.tsx`
- Create: `packages/mobile/app/(app)/(tabs)/_layout.tsx`
- Create: `packages/mobile/app/(app)/(tabs)/notes.tsx`
- Create: `packages/mobile/src/components/FileTree.tsx`
- Create: `packages/mobile/src/components/FavoritesSection.tsx`
- Create: `packages/mobile/src/components/OfflineBanner.tsx`
- Create: `packages/mobile/src/hooks/useNotes.ts`
- Create: `packages/mobile/src/hooks/useNetworkStatus.ts`
- Create: `packages/mobile/src/hooks/useSync.ts`

- [ ] **Step 1: Create tab layout**

5 tabs: Notes, Search, Graph, Tags, Settings. Use lucide icons. Dark tab bar matching web theme.

- [ ] **Step 2: Create useSync hook**

Triggers sync on app foreground, pull-to-refresh, and manual button. Shows sync status.

- [ ] **Step 3: Create useNotes hook**

Queries WatermelonDB for notes. Provides file tree structure, favorites, CRUD operations.

- [ ] **Step 4: Create FileTree component**

Expandable/collapsible folder tree built from note paths. Long-press for move (drag-and-drop equivalent). Swipe-to-delete.

- [ ] **Step 5: Create FavoritesSection**

Reads starred notes from Setting records. Shows at top of notes tab.

- [ ] **Step 6: Create OfflineBanner**

Shows "Offline" banner when no network. Uses `useNetworkStatus` hook.

- [ ] **Step 7: Create notes screen**

Combines FavoritesSection + FileTree + FAB (new note / daily note). Pull-to-refresh triggers sync.

- [ ] **Step 8: Commit**

```bash
git add packages/mobile/app/(app)/ packages/mobile/src/
git commit -m "feat(mobile): add tab navigation and notes screen with file tree"
```

---

### Task 6: Note Viewer/Editor with WebView

**Files:**
- Create: `packages/mobile/app/(app)/note/[...path].tsx`
- Create: `packages/mobile/src/webview/EditorBridge.tsx`
- Create: `packages/mobile/src/webview/editor.html`
- Create: `packages/mobile/src/components/Breadcrumbs.tsx`
- Create: `packages/mobile/src/components/FrontmatterBlock.tsx`
- Create: `packages/mobile/src/lib/frontmatter.ts`

- [ ] **Step 1: Create editor HTML bundle**

Bundle CodeMirror 6 with markdown support, vim mode, and the same extensions as the web app into a standalone HTML file. The HTML communicates with React Native via `window.ReactNativeWebView.postMessage()`.

- [ ] **Step 2: Create EditorBridge component**

React Native component wrapping WebView. Handles:
- Sending content to WebView
- Receiving content changes via postMessage
- Auto-save with 2s debounce
- Theme and vim mode toggles

- [ ] **Step 3: Create note screen**

Header with breadcrumbs + edit/preview toggle + overflow menu (star, share, history, trash, export).
Preview mode: WebView rendering markdown.
Edit mode: EditorBridge with CodeMirror.

- [ ] **Step 4: Create Breadcrumbs and FrontmatterBlock**

Port from web app, adapted for React Native (StyleSheet instead of Tailwind).

- [ ] **Step 5: Copy frontmatter parser**

Copy `packages/client/src/lib/frontmatter.ts` to `packages/mobile/src/lib/frontmatter.ts` (pure JS, no web dependencies).

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/app/(app)/note/ packages/mobile/src/webview/ packages/mobile/src/components/ packages/mobile/src/lib/frontmatter.ts
git commit -m "feat(mobile): add note viewer/editor with WebView CodeMirror bridge"
```

---

### Task 7: Search, Tags, and Graph Screens

**Files:**
- Create: `packages/mobile/app/(app)/(tabs)/search.tsx`
- Create: `packages/mobile/app/(app)/(tabs)/tags.tsx`
- Create: `packages/mobile/app/(app)/(tabs)/graph.tsx`
- Create: `packages/mobile/src/webview/graph.html`

- [ ] **Step 1: Create search screen**

Search input at top. Queries WatermelonDB Note records locally (title + content LIKE search). Shows results list with title, path, snippet. Tap to open note.

- [ ] **Step 2: Create tags screen**

Query notes locally, parse `#tags` from content. Show tag list with counts. Tap tag to see filtered note list.

- [ ] **Step 3: Create graph screen**

Bundle the D3 force-directed graph from the web app into `graph.html`. Load in WebView. Parse `[[wiki-links]]` from local note content to build nodes/edges. Tap node to open note.

- [ ] **Step 4: Commit**

```bash
git add packages/mobile/app/(app)/(tabs)/ packages/mobile/src/webview/graph.html
git commit -m "feat(mobile): add search, tags, and graph screens"
```

---

### Task 8: Settings, Daily Notes, Templates, Trash, History, Sharing, Admin

**Files:**
- Create: `packages/mobile/app/(app)/(tabs)/settings.tsx`
- Create: `packages/mobile/app/(app)/daily.tsx`
- Create: `packages/mobile/app/(app)/templates.tsx`
- Create: `packages/mobile/app/(app)/trash.tsx`
- Create: `packages/mobile/app/(app)/history/[...path].tsx`
- Create: `packages/mobile/app/(app)/sharing.tsx`
- Create: `packages/mobile/app/(app)/admin.tsx`
- Create: `packages/mobile/src/components/SyncStatus.tsx`

- [ ] **Step 1: Settings screen**

Sections: Account (email, change password, 2FA, API keys), Sync (last sync time, sync now button, SyncStatus component), Theme, Admin link (if admin role). Logout button.

- [ ] **Step 2: Daily notes screen**

Calendar date picker. Creates daily note at `Daily/YYYY-MM-DD.md` with template. Navigates to the note.

- [ ] **Step 3: Templates screen**

Lists templates from `Templates/` folder in WatermelonDB. Tap to create new note from template.

- [ ] **Step 4: Trash screen**

Lists TrashItem records from WatermelonDB. Restore and permanent delete buttons. Empty trash button. Requires online for restore/empty (calls server API).

- [ ] **Step 5: History screen**

Online-only. Fetches versions from `GET /api/history/:path`. Shows version list with relative timestamps. Tap to preview, restore button.

- [ ] **Step 6: Sharing screen**

Online-only. Lists shares from NoteShare records. Create share (search user by email). Access requests management.

- [ ] **Step 7: Admin screen**

Online-only. User list, invite codes, registration mode toggle. Same functionality as web admin panel.

- [ ] **Step 8: Commit**

```bash
git add packages/mobile/app/(app)/ packages/mobile/src/components/SyncStatus.tsx
git commit -m "feat(mobile): add settings, daily, templates, trash, history, sharing, admin screens"
```

---

### Task 9: Image Upload and Toast Notifications

**Files:**
- Modify: `packages/mobile/src/webview/EditorBridge.tsx`
- Create: `packages/mobile/src/hooks/useImagePicker.ts`

- [ ] **Step 1: Add image picker**

Use `expo-image-picker` to select from camera or gallery. Upload via `POST /api/files` (FormData). Insert `![image](attachments/filename)` into editor via WebView bridge.

- [ ] **Step 2: Add toast notifications**

Configure `react-native-toast-message` in root layout. Use throughout app for success/error/info feedback.

- [ ] **Step 3: Commit**

```bash
git add packages/mobile/
git commit -m "feat(mobile): add image upload and toast notifications"
```

---

### Task 10: Polish and Final Testing

- [ ] **Step 1: Add app icons and splash screen**

Create icon (1024x1024) and splash using the Kryton logo. Dark background (#0d1117).

- [ ] **Step 2: Test on iOS simulator**

```bash
npx expo run:ios
```

Verify: auth flow, sync, note CRUD, search, graph, all tabs work.

- [ ] **Step 3: Test on Android emulator**

```bash
npx expo run:android
```

Verify same as iOS.

- [ ] **Step 4: Test offline mode**

Enable airplane mode. Verify: can read notes, create notes, edit notes. Re-enable — verify sync pushes changes.

- [ ] **Step 5: Add to monorepo workspace**

Update root `package.json` to include `packages/mobile` in workspaces.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(mobile): complete mobile app with offline sync and full feature parity"
```
