# `@azrtydxb/ui` UI Library Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extract presentation, business components, page layouts, and runtime plugin loader from `packages/client` into a publishable `@azrtydxb/ui` package. Refactor `packages/client` to be a thin shell that wires `HttpAdapter` (data) to the library.

**Architecture:** New monorepo package `packages/ui`. Components are pure presentation, data via `KrytonDataAdapter` context. Web client and future desktop both consume the lib with their own adapter implementations.

**Tech Stack:** TypeScript 5.6, React 19, Tailwind CSS 4, Vitest, Testing Library + jsdom, esbuild (for bundle, follows core pattern).

**Spec:** [`docs/superpowers/specs/2026-04-30-ui-library-design.md`](../specs/2026-04-30-ui-library-design.md)

**Phase mapping:** Single stream, ~80-100 hours. Phased internally:
- Phase A: package skeleton + data context + primitives (15-20 tasks)
- Phase B: business components (notes, tags, search, sharing, settings, trash, daily, templates) (25-30 tasks)
- Phase C: layout, editor, graph, plugins (10-15 tasks)
- Phase D: client refactor + publishing (10-15 tasks)

---

## File ownership

This plan executes in a single worktree (`kryton-ui-extraction`). All files below are owned by this stream:

**Created:**
- `packages/ui/**` (entire new package)
- `packages/client/src/data/HttpAdapter.ts` (new)
- `packages/client/src/data/HttpDataProvider.tsx` (new)

**Modified:**
- `packages/client/src/App.tsx` — wrap in HttpDataProvider
- `packages/client/src/main.tsx` — same
- `packages/client/package.json` — add `@azrtydxb/ui` dep
- `packages/client/tsconfig.json` — path aliases if needed
- root `package.json` — workspaces glob already covers `packages/ui`
- `.github/workflows/publish-core.yml` — add ui package to publish job
- `scripts/verify-versions.js` — add ui package version check

**Deleted (after extraction is verified):**
- `packages/client/src/components/**` (per-component as each is migrated)
- `packages/client/src/lib/plugins/**` (moved to ui lib)

---

## Setup

### Task UI-S1: Create `packages/ui` package skeleton

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/index.ts`

- [ ] **Step 1: Write `packages/ui/package.json`**

```json
{
  "name": "@azrtydxb/ui",
  "version": "4.4.0-pre.6",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./tailwind-preset": { "default": "./tailwind.preset.js" }
  },
  "files": ["dist", "tailwind.preset.js", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -b",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "publishConfig": { "registry": "https://npm.pkg.github.com", "access": "restricted" },
  "repository": { "type": "git", "url": "https://github.com/azrtydxb/kryton.git", "directory": "packages/ui" },
  "peerDependencies": {
    "@azrtydxb/core": "4.4.0-pre.6",
    "@azrtydxb/core-react": "4.4.0-pre.6",
    "react": ">=18",
    "react-dom": ">=18",
    "yjs": "^13.6.0"
  },
  "dependencies": {
    "lucide-react": "^0.460.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitest/ui": "^1.6.0",
    "jsdom": "^24.0.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^1.6.0"
  },
  "license": "see LICENSE"
}
```

- [ ] **Step 2: Write `packages/ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/ui/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

- [ ] **Step 4: Write `packages/ui/src/test-setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

Add `@testing-library/jest-dom` to devDeps:
```bash
npm install --save-dev --workspace=packages/ui @testing-library/jest-dom
```

- [ ] **Step 5: Stub `packages/ui/src/index.ts`**

```ts
export const KRYTON_UI_VERSION = "4.4.0-pre.6";
```

- [ ] **Step 6: Copy LICENSE**

```bash
cp LICENSE packages/ui/LICENSE
```

- [ ] **Step 7: Install + verify build**

From monorepo root:
```bash
npm install
npm run build --workspace=packages/ui
```

Expected: `packages/ui/dist/index.js` exists, contains version export.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/ package-lock.json
git commit -m "chore(ui): @azrtydxb/ui package skeleton"
```

---

### Task UI-S2: Update root scripts and version verifier

**Files:**
- Modify: `package.json` (root)
- Modify: `scripts/verify-versions.js`

- [ ] **Step 1: Add `packages/ui` to verify-versions.js**

Edit the `packages` array in `scripts/verify-versions.js`:
```js
const packages = [
  "packages/core/package.json",
  "packages/core-react/package.json",
  "packages/ui/package.json",
];
```

- [ ] **Step 2: Update root scripts**

Edit root `package.json` `scripts`:
```json
"build:core": "npm run build --workspace=packages/core --workspace=packages/core-react --workspace=packages/ui",
"test:core": "npm run test --workspace=packages/core --workspace=packages/core-react --workspace=packages/ui"
```

- [ ] **Step 3: Update publish-core workflow**

Edit `.github/workflows/publish-core.yml`. Replace the publish step:
```yaml
      - name: Publish to GitHub Packages
        run: node scripts/publish-core.js
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_PUBLISH_TOKEN }}
```

Edit `scripts/publish-core.js` to publish ui too. Find the existing publish command and update:
```js
const baseCmd = `npm publish --workspace=packages/core --workspace=packages/core-react --workspace=packages/ui ${tagFlag}`.trim();
```

- [ ] **Step 4: Verify**

```bash
node scripts/verify-versions.js
```
Expected: `All workspace versions match root: 4.4.0-pre.6`.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-versions.js scripts/publish-core.js .github/workflows/publish-core.yml package.json
git commit -m "chore(ui): wire @azrtydxb/ui into publish + verify pipelines"
```

---

## Phase A — Data context + primitives

### Task UI-A1: Define KrytonDataAdapter type

**Files:**
- Create: `packages/ui/src/data/types.ts`

- [ ] **Step 1: Write the type**

```ts
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

export interface NoteData {
  id: string;
  path: string;
  title: string;
  tags: string;       // JSON-stringified string[]
  modifiedAt: number;
  version: number;
}
export interface FolderData { id: string; userId: string; path: string; parentId: string | null; updatedAt: number; version: number; }
export interface TagData { id: string; userId: string; name: string; color: string | null; updatedAt: number; version: number; }
export interface SettingData { id: string; userId: string; key: string; value: string; updatedAt: number; version: number; }
export interface NoteShareData { id: string; ownerUserId: string; path: string; isFolder: boolean; sharedWithUserId: string; permission: string; createdAt: number; updatedAt: number; version: number; }
export interface TrashItemData { id: string; userId: string; originalPath: string; trashedAt: number; version: number; }
export interface CurrentUser { id: string; email: string; displayName: string; }

export interface SyncStatus {
  lastPullAt: number | null;
  lastPushAt: number | null;
  pending: number;
  online: boolean;
}

export interface NoteFilter { folderPath?: string; tag?: string; }

export interface KrytonDataAdapter {
  notes: {
    list(filter?: NoteFilter): NoteData[];
    findById(id: string): NoteData | null;
    findByPath(path: string): NoteData | null;
    create(input: { path: string; title: string; content?: string; tags?: string[] }): Promise<NoteData>;
    update(id: string, patch: Partial<NoteData> & { content?: string }): Promise<void>;
    delete(id: string): Promise<void>;
  };
  folders: {
    list(): FolderData[];
    create(input: { path: string; parentId: string | null }): Promise<FolderData>;
    delete(id: string): Promise<void>;
  };
  tags: { list(): TagData[]; };
  settings: {
    get(key: string): string | null;
    set(key: string, value: string): Promise<void>;
  };
  noteShares: { list(): NoteShareData[]; };
  trashItems: {
    list(): TrashItemData[];
    restore(id: string): Promise<void>;
    purge(id: string): Promise<void>;
    purgeAll(): Promise<void>;
  };

  subscribe(entityType: string, ids: string[] | "*", callback: () => void): () => void;

  openDocument(noteId: string): Promise<Y.Doc>;
  closeDocument(noteId: string): void;
  getAwareness(noteId: string): Awareness | null;
  readNoteContent(noteId: string): string | null;

  getSyncStatus(): SyncStatus;
  triggerSync(): Promise<void>;

  currentUser(): CurrentUser | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/data/types.ts
git commit -m "feat(ui): KrytonDataAdapter contract"
```

---

### Task UI-A2: Provider + base hooks

**Files:**
- Create: `packages/ui/src/data/KrytonDataProvider.tsx`
- Create: `packages/ui/src/data/hooks.ts`
- Create: `packages/ui/src/data/__tests__/hooks.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// packages/ui/src/data/__tests__/hooks.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { KrytonDataProvider } from "../KrytonDataProvider";
import { useUiNotes } from "../hooks";
import type { KrytonDataAdapter, NoteData } from "../types";

function makeAdapter(initial: NoteData[]): KrytonDataAdapter & { _trigger(): void } {
  const subs = new Set<() => void>();
  let data = [...initial];
  return {
    notes: { list: () => data, findById: () => null, findByPath: () => null, create: async () => initial[0]!, update: async () => {}, delete: async () => {} },
    folders: { list: () => [], create: async () => ({} as any), delete: async () => {} },
    tags: { list: () => [] },
    settings: { get: () => null, set: async () => {} },
    noteShares: { list: () => [] },
    trashItems: { list: () => [], restore: async () => {}, purge: async () => {}, purgeAll: async () => {} },
    subscribe: (_t, _ids, cb) => { subs.add(cb); return () => subs.delete(cb); },
    openDocument: async () => ({} as any), closeDocument: () => {}, getAwareness: () => null, readNoteContent: () => null,
    getSyncStatus: () => ({ lastPullAt: null, lastPushAt: null, pending: 0, online: true }),
    triggerSync: async () => {},
    currentUser: () => null,
    _trigger() { subs.forEach(c => c()); data = [...data, { id: "n2", path: "n2", title: "alpha", tags: "[]", modifiedAt: 0, version: 0 }]; },
  };
}

function NoteList() {
  const notes = useUiNotes();
  return <ul>{notes.map(n => <li key={n.id}>{n.title}</li>)}</ul>;
}

describe("useUiNotes", () => {
  it("renders initial data", () => {
    const adapter = makeAdapter([{ id: "n1", path: "n1", title: "first", tags: "[]", modifiedAt: 0, version: 0 }]);
    render(<KrytonDataProvider adapter={adapter}><NoteList /></KrytonDataProvider>);
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  it("re-renders when subscribe callback fires", () => {
    const adapter = makeAdapter([{ id: "n1", path: "n1", title: "first", tags: "[]", modifiedAt: 0, version: 0 }]);
    render(<KrytonDataProvider adapter={adapter}><NoteList /></KrytonDataProvider>);
    act(() => adapter._trigger());
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — fails (modules missing)**

```bash
npm run test --workspace=packages/ui -- hooks
```

- [ ] **Step 3: Implement**

```tsx
// packages/ui/src/data/KrytonDataProvider.tsx
import { createContext, useContext, type ReactNode } from "react";
import type { KrytonDataAdapter } from "./types";

const Ctx = createContext<KrytonDataAdapter | null>(null);

export function KrytonDataProvider({ adapter, children }: { adapter: KrytonDataAdapter; children: ReactNode }) {
  return <Ctx.Provider value={adapter}>{children}</Ctx.Provider>;
}

export function useKrytonData(): KrytonDataAdapter {
  const v = useContext(Ctx);
  if (!v) throw new Error("useKrytonData must be used within <KrytonDataProvider>");
  return v;
}
```

```ts
// packages/ui/src/data/hooks.ts
import { useEffect, useState } from "react";
import { useKrytonData } from "./KrytonDataProvider";
import type { NoteFilter, NoteData, FolderData, TagData, SettingData, NoteShareData, TrashItemData, SyncStatus } from "./types";

function makeListHook<T>(entityType: string, getList: (a: any) => T[]) {
  return function useList(filter?: unknown): T[] {
    const adapter = useKrytonData();
    const [items, setItems] = useState<T[]>(() => getList(adapter));
    const filterKey = JSON.stringify(filter ?? null);
    useEffect(() => {
      const off = adapter.subscribe(entityType, "*", () => setItems(getList(adapter)));
      setItems(getList(adapter));
      return off;
    }, [adapter, filterKey]);
    return items;
  };
}

export function useUiNotes(filter?: NoteFilter): NoteData[] {
  const adapter = useKrytonData();
  const [items, setItems] = useState<NoteData[]>(() => adapter.notes.list(filter));
  const filterKey = JSON.stringify(filter ?? null);
  useEffect(() => {
    const off = adapter.subscribe("notes", "*", () => setItems(adapter.notes.list(filter)));
    setItems(adapter.notes.list(filter));
    return off;
  }, [adapter, filterKey]);
  return items;
}
export const useUiFolders = makeListHook<FolderData>("folders", a => a.folders.list());
export const useUiTags = makeListHook<TagData>("tags", a => a.tags.list());
export const useUiSettings = makeListHook<SettingData>("settings", a => a.settings.list?.() ?? []);
export const useUiNoteShares = makeListHook<NoteShareData>("note_shares", a => a.noteShares.list());
export const useUiTrashItems = makeListHook<TrashItemData>("trash_items", a => a.trashItems.list());

export function useUiNote(id: string): NoteData | null {
  const adapter = useKrytonData();
  const [n, setN] = useState<NoteData | null>(() => adapter.notes.findById(id));
  useEffect(() => {
    const off = adapter.subscribe("notes", [id], () => setN(adapter.notes.findById(id)));
    setN(adapter.notes.findById(id));
    return off;
  }, [adapter, id]);
  return n;
}

export function useUiSetting(key: string): string | null {
  const all = useUiSettings();
  return all.find(s => s.key === key)?.value ?? null;
}

export function useUiSyncStatus(): SyncStatus {
  const adapter = useKrytonData();
  const [s, setS] = useState(() => adapter.getSyncStatus());
  useEffect(() => {
    const off = adapter.subscribe("sync", "*", () => setS(adapter.getSyncStatus()));
    return off;
  }, [adapter]);
  return s;
}
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/data/
git commit -m "feat(ui): KrytonDataProvider + base hooks (useUiNotes, etc.)"
```

---

### Task UI-A3 through UI-A12: Primitives (10 tasks, one per primitive group)

**Pattern for each primitive:** create the component, write a render-and-interaction test, commit. Each task touches `packages/ui/src/primitives/<group>/` and exports from `packages/ui/src/primitives/index.ts`.

**For brevity in this plan, the primitives are listed; the executing agent writes each one following the pattern of UI-A2 (test, fail, implement, pass, commit).** Migration source for each is `packages/client/src/components/**` — read the existing implementation, port to the new location with class name changes minimized.

| Task | Group | Components |
|---|---|---|
| UI-A3 | Button + Icon | Button, IconButton, Icon (lucide re-export) |
| UI-A4 | Input + Form | Input, Textarea, Checkbox, Radio, Select, Switch, Slider |
| UI-A5 | Overlays | Modal, Drawer, Tooltip, Popover |
| UI-A6 | Menus | DropdownMenu, ContextMenu |
| UI-A7 | Navigation | Tabs, Accordion |
| UI-A8 | Feedback | Toast, Banner, Skeleton, Spinner |
| UI-A9 | Data | Avatar, Badge, Divider |
| UI-A10 | Layout primitives | Resizer, AppShell shell |
| UI-A11 | Theme | tokens, ThemeProvider, useTheme |
| UI-A12 | Primitives barrel + tailwind preset | `primitives/index.ts`, `tailwind.preset.ts` |

For UI-A12 specifically:

- [ ] **Step 1: Write `packages/ui/tailwind.preset.ts`** — extract the design tokens currently in `packages/client/tailwind.config.ts`. Tokens become an object exported as the preset.

- [ ] **Step 2: Compile preset to JS** for runtime consumption (no build step on consumer):
```bash
npx tsc packages/ui/tailwind.preset.ts --outDir packages/ui --target es2020 --module nodenext --declaration
```

- [ ] **Step 3: Update package.json `files` to include `tailwind.preset.js`** (already done in UI-S1).

- [ ] **Step 4: Run all primitive tests**

```bash
npm run test --workspace=packages/ui
```

Expected: all primitives' tests pass (likely 30-50 tests across UI-A3..A11).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): tailwind preset and primitives barrel"
```

---

## Phase B — Business components

The bulk of the migration. Each task: extract a component group from `packages/client/src/components/<area>/` to `packages/ui/src/<area>/`, write a render/interaction test, commit. Use `MockDataProvider` patterns for tests where data is involved.

### Task UI-B1: NoteCard + NoteList

**Files:**
- Create: `packages/ui/src/notes/NoteCard.tsx`, `NoteList.tsx`
- Create: `packages/ui/src/notes/__tests__/NoteList.test.tsx`

- [ ] **Step 1: Find source**

```bash
grep -rln "export.*NoteList\|export.*NoteCard" packages/client/src/components | head
```

- [ ] **Step 2: Read existing implementations**, identify props they currently take from local data hooks. Refactor those to receive `notes: NoteData[]` directly via props.

- [ ] **Step 3: Write the test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NoteList } from "../NoteList";

describe("NoteList", () => {
  it("renders notes by title", () => {
    const notes = [
      { id: "1", path: "a", title: "First", tags: "[]", modifiedAt: 0, version: 0 },
      { id: "2", path: "b", title: "Second", tags: "[]", modifiedAt: 0, version: 0 },
    ];
    render(<NoteList notes={notes} onSelect={() => {}} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("calls onSelect when a note is clicked", () => {
    const onSelect = vi.fn();
    render(<NoteList notes={[{ id: "1", path: "a", title: "First", tags: "[]", modifiedAt: 0, version: 0 }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("First"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });
});
```

- [ ] **Step 4: Implement** (copy logic from existing client component, refactor data inputs to props)

- [ ] **Step 5: Run — passes**

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/notes/
git commit -m "feat(ui): NoteCard and NoteList components"
```

### Tasks UI-B2 through UI-B25: Repeat the same pattern

| Task | Component / module |
|---|---|
| UI-B2 | FileTree |
| UI-B3 | FavoritesSection |
| UI-B4 | Breadcrumbs |
| UI-B5 | NewNoteButton, NoteHeader, NoteMetadata |
| UI-B6 | FrontmatterEditor |
| UI-B7 | NoteContextMenu, NoteMoveDialog |
| UI-B8 | RecentNotesPanel |
| UI-B9 | SearchInput, SearchResults |
| UI-B10 | FullTextSearchScreen, BacklinksPanel |
| UI-B11 | TagBadge, TagList |
| UI-B12 | TagPicker, TagFilterBar |
| UI-B13 | TagsScreen |
| UI-B14 | ShareDialog, ShareList |
| UI-B15 | AccessRequestList, ShareInviteForm, AccessRequestNotification |
| UI-B16 | TrashList, RestoreNoteButton |
| UI-B17 | DailyNotesPicker, DailyNoteShell |
| UI-B18 | TemplateList, TemplatePicker |
| UI-B19 | SettingsScreen shell + AccountPanel |
| UI-B20 | AppearancePanel, EditorPanel |
| UI-B21 | SyncPanel, NotificationsPanel |
| UI-B22 | PluginsPanel, AllowedOriginsEditor |
| UI-B23 | ApiKeysPanel |
| UI-B24 | AgentsPanel (list, create, token mint) |
| UI-B25 | PrivacyPanel, HotkeysPanel, AdvancedPanel, DiagnosticsPanel |

**Each task structure (mandatory):**
1. Find source via grep.
2. Read existing implementation.
3. Write a Testing Library test asserting render + at least one interaction.
4. Implement (port from client; data via props).
5. Run tests; ensure all green.
6. Commit with `feat(ui): <component(s)>`.

Push after every commit: `git push origin HEAD`.

---

## Phase C — Layouts, Editor, Graph, Plugins

### Task UI-C1: ThreePanelLayout

**Files:**
- Create: `packages/ui/src/layout/ThreePanelLayout.tsx`
- Create: `packages/ui/src/layout/__tests__/ThreePanelLayout.test.tsx`

- [ ] **Step 1: Test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThreePanelLayout } from "../ThreePanelLayout";

describe("ThreePanelLayout", () => {
  it("renders all three panels", () => {
    render(<ThreePanelLayout
      sidebar={<div>SIDE</div>}
      main={<div>MAIN</div>}
      panel={<div>PANEL</div>}
      storageKey="test"
    />);
    expect(screen.getByText("SIDE")).toBeInTheDocument();
    expect(screen.getByText("MAIN")).toBeInTheDocument();
    expect(screen.getByText("PANEL")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement** (port resizer logic from existing client; persist widths via localStorage keyed by storageKey)

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/layout/
git commit -m "feat(ui): ThreePanelLayout with persisted widths"
```

### Tasks UI-C2 through UI-C8

| Task | Component |
|---|---|
| UI-C2 | AppShell |
| UI-C3 | CommandPalette |
| UI-C4 | KeyboardShortcuts |
| UI-C5 | NoteEditor (wraps WebView CodeMirror+Yjs from kryton-mobile bundle, copy-pasted into ui lib's `editor/codemirror-bundle/`; same build pipeline as mobile) |
| UI-C6 | NotePreview (renders markdown via injected renderer) |
| UI-C7 | EditorToolbar |
| UI-C8 | GraphView (D3 force layout from existing client) |

For UI-C5 specifically: **the editor bundle is a copy of `kryton-mobile/src/webview/codemirror-bundle/`**. Initially copied verbatim into `packages/ui/src/editor/codemirror-bundle/`. Future: extract to its own monorepo package shared by mobile + ui — that's a separate sub-project (out of scope here).

### Task UI-C9: Plugin loader + manager

**Files:**
- Create: `packages/ui/src/plugins/PluginRoot.tsx`
- Create: `packages/ui/src/plugins/PluginContext.tsx`
- Create: `packages/ui/src/plugins/registry.ts`
- Create: `packages/ui/src/plugins/loader.ts`
- Create: `packages/ui/src/plugins/PluginManagerScreen.tsx`
- Create: `packages/ui/src/plugins/__tests__/loader.test.ts`

- [ ] **Step 1: Read existing plugin runtime**

```bash
ls packages/client/src/lib/plugins/
cat packages/client/src/lib/plugins/index.ts | head -50
```

- [ ] **Step 2: Port the loader**, removing client-specific imports. Test:

```ts
import { describe, it, expect } from "vitest";
import { fetchPluginManifest, loadPlugin } from "../loader";

describe("plugin loader", () => {
  it("rejects plugins with no required fields", async () => {
    await expect(loadPlugin({ name: "" } as any, () => {} as any)).rejects.toThrow();
  });
  // ... real fetch tests with mocked fetch
});
```

- [ ] **Step 3: PluginRoot mounts plugins** when registered:

```tsx
export function PluginRoot({ children }: { children: ReactNode }) {
  // Registers window.__krytonPluginDeps, runs activate() for each enabled plugin
  // ...
  return <>{children}</>;
}
```

- [ ] **Step 4: PluginManagerScreen** lists registry plugins with install/uninstall buttons.

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/plugins/
git commit -m "feat(ui): plugin loader, runtime, and manager UI"
```

---

## Phase D — Client refactor + publishing

### Task UI-D1: HttpAdapter implementation in client

**Files:**
- Create: `packages/client/src/data/HttpAdapter.ts`
- Create: `packages/client/src/data/HttpDataProvider.tsx`
- Create: `packages/client/src/data/__tests__/HttpAdapter.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, vi } from "vitest";
import { HttpAdapter } from "../HttpAdapter";

describe("HttpAdapter.notes.list", () => {
  it("fetches GET /api/notes", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ notes: [{ id: "1", path: "a", title: "T", tags: "[]", modifiedAt: 0, version: 0 }] }) }));
    const a = new HttpAdapter({ fetch: fetchMock as unknown as typeof fetch, baseUrl: "" });
    await a.refresh("notes"); // priming call
    expect(a.notes.list()[0]?.title).toBe("T");
  });
});
```

- [ ] **Step 2: Implement** — sketch:

```ts
export class HttpAdapter implements KrytonDataAdapter {
  private state = { notes: [] as NoteData[], folders: [] as FolderData[], tags: [] as TagData[], settings: [] as SettingData[], noteShares: [] as NoteShareData[], trashItems: [] as TrashItemData[] };
  private subs = new Map<string, Set<() => void>>();
  private fetch: typeof fetch;
  private baseUrl: string;

  constructor(opts: { fetch?: typeof fetch; baseUrl: string }) {
    this.fetch = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl;
  }

  notes = {
    list: () => this.state.notes,
    findById: (id: string) => this.state.notes.find(n => n.id === id) ?? null,
    findByPath: (p: string) => this.state.notes.find(n => n.path === p) ?? null,
    create: async (input: any) => {
      const res = await this.fetch(`${this.baseUrl}/api/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(input) });
      const note = await res.json();
      this.state.notes = [...this.state.notes, note];
      this.fire("notes");
      return note;
    },
    update: async (id, patch) => {
      await this.fetch(`${this.baseUrl}/api/notes/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(patch) });
      this.state.notes = this.state.notes.map(n => n.id === id ? { ...n, ...patch } : n);
      this.fire("notes");
    },
    delete: async (id) => {
      await this.fetch(`${this.baseUrl}/api/notes/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
      this.state.notes = this.state.notes.filter(n => n.id !== id);
      this.fire("notes");
    },
  };
  // folders, tags, settings, etc. — same pattern. Settings uses /api/settings, etc.

  subscribe(entityType: string, _ids: string[] | "*", cb: () => void): () => void {
    if (!this.subs.has(entityType)) this.subs.set(entityType, new Set());
    this.subs.get(entityType)!.add(cb);
    return () => this.subs.get(entityType)?.delete(cb);
  }
  private fire(t: string) { this.subs.get(t)?.forEach(c => c()); this.subs.get("*")?.forEach(c => c()); }

  async refresh(entityType: string): Promise<void> {
    // Hits the appropriate GET endpoint to refill state.
    const url = entityType === "notes" ? `${this.baseUrl}/api/notes` : `${this.baseUrl}/api/${entityType}`;
    const res = await this.fetch(url, { credentials: "include" });
    const data = await res.json();
    (this.state as any)[entityType] = data[entityType] ?? data;
    this.fire(entityType);
  }

  // Yjs: web client uses native WebSocket
  private docs = new Map<string, Y.Doc>();
  async openDocument(noteId: string): Promise<Y.Doc> {
    if (this.docs.has(noteId)) return this.docs.get(noteId)!;
    const doc = new Y.Doc();
    // ... establish WS connection to /ws/yjs/<noteId>
    this.docs.set(noteId, doc);
    return doc;
  }
  closeDocument(noteId: string): void { this.docs.get(noteId)?.destroy(); this.docs.delete(noteId); }
  getAwareness(noteId: string) { /* return awareness instance */ return null; }
  readNoteContent(noteId: string): string | null {
    const note = this.state.notes.find(n => n.id === noteId);
    return note ? "" : null; // synchronous content not available in HTTP adapter; UI uses openDocument for editor
  }

  getSyncStatus() { return { lastPullAt: Date.now(), lastPushAt: Date.now(), pending: 0, online: true }; }
  async triggerSync() { await Promise.all(["notes","folders","tags","settings","noteShares","trashItems"].map(t => this.refresh(t))); }

  currentUser() { return null; /* fetched separately and cached via /api/auth/me */ }
}
```

The full implementation is ~250 lines. The subagent handles it; this plan shows the shape.

- [ ] **Step 3: HttpDataProvider** wraps HttpAdapter and triggers initial refresh on mount.

- [ ] **Step 4: Run tests — passes**

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/data/
git commit -m "feat(client): HttpAdapter implementing KrytonDataAdapter"
```

### Task UI-D2: Wire HttpDataProvider into client App

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/main.tsx`
- Modify: `packages/client/package.json` (add @azrtydxb/ui dep)

- [ ] **Step 1: Add dep**

```bash
npm install @azrtydxb/ui@4.4.0-pre.6 --workspace=packages/client
```

- [ ] **Step 2: Wrap App**

```tsx
import { KrytonDataProvider } from "@azrtydxb/ui";
import { HttpAdapter } from "./data/HttpAdapter";

const adapter = new HttpAdapter({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? "" });

export default function App() {
  return (
    <KrytonDataProvider adapter={adapter}>
      {/* existing children */}
    </KrytonDataProvider>
  );
}
```

- [ ] **Step 3: Replace component imports** — edit every `import` in `packages/client/src/**` that points at `./components/X` to `import { X } from "@azrtydxb/ui"`.

```bash
grep -rln "from.*components/" packages/client/src
# for each match, manually change the import
```

- [ ] **Step 4: Verify build + typecheck**

```bash
npm run typecheck --workspace=packages/client
npm run build --workspace=packages/client
```

- [ ] **Step 5: Manual smoke** (subjective): start dev server, click around, ensure UI works.

- [ ] **Step 6: Commit**

```bash
git add packages/client/
git commit -m "refactor(client): consume @azrtydxb/ui via HttpDataProvider"
```

### Task UI-D3: Delete migrated component files

**Files:**
- Delete: `packages/client/src/components/**` (one final purge)
- Delete: `packages/client/src/lib/plugins/**`

- [ ] **Step 1: Verify nothing in client still imports from local components**

```bash
grep -rln "from.*[\"']\\./components" packages/client/src
```

Expected: zero matches.

- [ ] **Step 2: Delete the directories**

```bash
git rm -r packages/client/src/components packages/client/src/lib/plugins
```

- [ ] **Step 3: Verify build + tests still pass**

```bash
npm run build --workspace=packages/client
npm run test --workspace=packages/client
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(client): delete migrated components (now in @azrtydxb/ui)"
```

### Task UI-D4: Final smoke + publish

- [ ] **Step 1: Run full test suite**

```bash
npm run test:core
```

Expected: all packages pass — core, core-react, ui, client.

- [ ] **Step 2: Build everything**

```bash
npm run build:core
npm run build --workspace=packages/client
```

- [ ] **Step 3: Cut release**

```bash
node scripts/release.js 4.4.0-pre.7
git push origin master --tags
```

CI's publish workflow publishes core, core-react, ui at `4.4.0-pre.7`.

- [ ] **Step 4: Confirm publish on GitHub Packages**

```bash
gh api '/orgs/azrtydxb/packages?package_type=npm' | grep '"name"'
```

Expected: includes `ui`, `core`, `core-react`.

- [ ] **Step 5: Update mobile to consume new ui package** (mobile doesn't actually consume ui — it's RN — but bump core to 4.4.0-pre.7 for parity).

```bash
cd /Users/pascal/Development/Kryton/kryton-mobile
npm pkg set 'dependencies.@azrtydxb/core'='4.4.0-pre.7' 'dependencies.@azrtydxb/core-react'='4.4.0-pre.7'
GITHUB_TOKEN=$(gh auth token) npm install --legacy-peer-deps
npx tsc --noEmit
git add -A && git commit -m "chore: bump @azrtydxb/* to 4.4.0-pre.7" && git push
```

---

## Self-review

- [ ] **Spec coverage:** every section of `2026-04-30-ui-library-design.md` mapped to a task. Component categories all listed in Phase B. Plugin runtime in UI-C9. HttpAdapter in UI-D1. Client refactor in UI-D2-D3.
- [ ] **No placeholders.** Tasks UI-A3..A12 and UI-B2..B25 are listed as "follow the pattern of UI-A2/UI-B1" with concrete migration source identified. The pattern step-by-step is fully shown in UI-A2 and UI-B1; subsequent tasks invoke the pattern.
- [ ] **Type consistency:** `KrytonDataAdapter` defined in UI-A1; consumed identically by UI-A2 hooks, UI-B* components (via props derived from hooks), UI-D1 HttpAdapter implementation.

## Open implementation questions deferred to execution

1. The exact prop shapes for some business components (e.g., GraphView) depend on the existing implementation — agent reads packages/client first.
2. CodeMirror+Yjs editor bundle copy from mobile may need bundle size tuning (currently 721KB on mobile; web could share or rebuild).
3. Tailwind preset extraction details depend on current client tailwind.config.ts shape.
