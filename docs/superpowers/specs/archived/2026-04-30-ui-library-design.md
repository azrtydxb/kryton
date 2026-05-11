# `@azrtydxb/ui` Shared UI Library — Design Spec

**Status:** Approved for implementation planning.
**Sub-project:** 1 of 3 in the desktop app track.
**Subsequent specs:**
- `2026-04-30-kryton-desktop-core-design.md` (consumer)
- `2026-04-30-kryton-desktop-complete-design.md` (consumer)

## Purpose

Extract presentation, business components, page layouts, and the runtime plugin loader from `packages/client` into a publishable npm package `@azrtydxb/ui`. Both `packages/client` (web) and the future `kryton-desktop` consume the library; data fetching and routing remain consumer-owned via React context.

## Why now

The desktop app needs offline data via `@azrtydxb/core-react`; the web client uses HTTP. Maintaining two complete UIs is unsustainable. Extracting a data-source-agnostic UI library lets each consumer wire its own data layer without forking presentation code.

The mobile app keeps its own React Native components — it cannot consume DOM components — and is not a consumer of this library.

## Package shape

`packages/ui/` in the kryton monorepo. Workspace dep already enabled. Published as `@azrtydxb/ui` to GitHub Packages, version-locked to monorepo root version (currently `4.4.0-pre.6`).

```
packages/ui/
├── package.json
├── tsconfig.json
├── tailwind.preset.ts                # exported preset for consumers
├── src/
│   ├── index.ts                      # public barrel
│   ├── data/                         # data context (no fetching, just typed shape)
│   │   ├── KrytonDataProvider.tsx    # generic provider; consumer supplies impl
│   │   ├── types.ts                  # NoteData, FolderData, ... shapes
│   │   └── hooks.ts                  # useUiNotes, useUiFolders ... read from context
│   ├── primitives/                   # Button, Input, Modal, Toast, Menu, Tabs, Sidebar, Tooltip, Resizer
│   ├── layout/                       # ThreePanel, AppShell, CommandPalette
│   ├── editor/                       # WebView CodeMirror+Yjs editor wrapper
│   ├── notes/                        # NoteList, FileTree, FavoritesSection, Breadcrumbs, NoteCard
│   ├── search/                       # SearchInput, SearchResults
│   ├── tags/                         # TagBadge, TagList, TagPicker
│   ├── graph/                        # GraphView (D3)
│   ├── sharing/                      # ShareDialog, AccessRequestList
│   ├── settings/                     # SettingsScreen and panels
│   ├── trash/                        # TrashList
│   ├── daily/                        # DailyNotesPicker
│   ├── templates/                    # TemplateList, TemplatePicker
│   ├── plugins/                      # PluginManager, plugin loader, PluginContext
│   └── theme/                        # design tokens, dark/light, useTheme hook
└── dist/                             # build output
```

## Data context — the key abstraction

`<KrytonDataProvider>` is a generic React context the library exposes. Consumers supply an implementation.

```ts
// packages/ui/src/data/types.ts
export interface KrytonDataAdapter {
  notes: {
    list(filter?: NoteFilter): NoteData[];
    findById(id: string): NoteData | null;
    findByPath(path: string): NoteData | null;
    create(input: NoteCreateInput): Promise<NoteData>;
    update(id: string, patch: Partial<NoteData>): Promise<void>;
    delete(id: string): Promise<void>;
  };
  folders: { ... };
  tags: { ... };
  settings: { get(key: string): string | null; set(key: string, value: string): Promise<void>; };
  noteShares: { ... };
  trashItems: { ... };

  // Reactive: subscribe to data changes; consumer wires this to its event source.
  subscribe(entityType: string, ids: string[] | "*", callback: () => void): () => void;

  // Yjs: opens a Y.Doc for live editing.
  openDocument(noteId: string): Promise<Y.Doc>;
  closeDocument(noteId: string): void;
  getAwareness(noteId: string): Awareness | null;
  readNoteContent(noteId: string): string | null;

  // Sync status (UI banners / pull-to-refresh)
  getSyncStatus(): SyncStatus;
  triggerSync(): Promise<void>;

  // Auth context (used by sharing UI, agent UI)
  currentUser(): { id: string; email: string; displayName: string } | null;
}
```

Two implementations in consumers:

- **`@azrtydxb/client`** (web): `HttpAdapter` — uses `fetch` against `/api/*`. Reactive via SSE or polling.
- **`kryton-desktop`**: `CoreAdapter` — wraps `Kryton` from `@azrtydxb/core` with the SqlJsAdapter underneath. Reactive via core's event bus.

Library hooks read from this context:

```ts
export function useUiNotes(filter?: NoteFilter): NoteData[] {
  const adapter = useKrytonData();
  const [notes, setNotes] = useState(() => adapter.notes.list(filter));
  useEffect(() => adapter.subscribe("notes", "*", () => setNotes(adapter.notes.list(filter))), [adapter, JSON.stringify(filter)]);
  return notes;
}
// useUiFolders, useUiTags, etc. follow same pattern.
```

## What's in the library

### Primitives (~25 components)

Button, Input, Textarea, Checkbox, Radio, Select, Switch, Slider, Modal, Drawer, Toast (provider+API), Tooltip, Popover, ContextMenu, DropdownMenu, Tabs, Accordion, Resizer, Skeleton, Spinner, Avatar, Badge, Banner, Divider, Icon (lucide-react re-export).

### Layout (~5 components)

`<AppShell>` — top-level shell with chrome slots (header, sidebar, main, panel).
`<ThreePanelLayout>` — sidebar + content + graph/outline with resizable splitters; persists widths via consumer-supplied storage key.
`<CommandPalette>` — ⌘K palette with extensible action registry.
`<ModalPortal>` — modal-stack manager.
`<KeyboardShortcuts>` — declarative shortcut registry, platform-correct (⌘ on macOS, Ctrl elsewhere).

### Notes UX (~12 components)

NoteList, NoteCard, FileTree, FavoritesSection, Breadcrumbs, NewNoteButton, NoteHeader, FrontmatterEditor, NoteMetadata, RecentNotesPanel, NoteContextMenu, NoteMoveDialog.

### Editor (~3 components)

`<NoteEditor noteId={...}>` — wraps the CodeMirror+Yjs WebView bundle from mobile (re-bundled for web; same source). Exposes paste-image, vim toggle, awareness presence rendering.
`<NotePreview noteId={...}>` — markdown renderer with wiki-link resolution via the data adapter.
`<EditorToolbar>` — formatting actions, view-mode toggle.

### Search (~4 components)

SearchInput, SearchResults, FullTextSearchScreen, BacklinksPanel.

### Tags (~5 components)

TagBadge, TagList, TagPicker, TagFilterBar, TagsScreen.

### Graph (~3 components)

GraphView (D3 force layout), GraphMiniature (sidebar mini), GraphScreen (full-screen with controls).

### Sharing (~5 components)

ShareDialog, ShareList, AccessRequestList, ShareInviteForm, AccessRequestNotification.

### Settings (~10 components)

SettingsScreen with panels: Account, Appearance, Editor, Sync, Plugins, ApiKeys, Agents, Privacy, Advanced. Each panel is a separate exported component the consumer composes.

### Trash, Daily, Templates (~6 components)

TrashList, RestoreNoteButton, DailyNotesPicker, DailyNoteShell, TemplateList, TemplatePicker.

### Plugins (~5 components + runtime)

PluginManager UI (install/enable/disable from registry), PluginSettingsPanel, PluginToolbarSlot (extension point), PluginSidebarSlot, PluginEditorSlot. Plus the plugin loader runtime that hydrates `__krytonPluginDeps`, fetches plugin code from the kryton-plugins registry, and sandboxes execution.

### Theme

Design tokens (color palette, spacing scale, typography), Tailwind preset, `useTheme()` + `<ThemeProvider>` for dark/light/system.

## What's NOT in the library

- **Routing** — consumer owns. Web uses React Router; desktop uses an in-app history stack synced to Tauri window state.
- **Data fetching** — adapter implementations live in consumers.
- **Auth flows** — login, register, 2FA, passkey enrollment, OAuth callbacks. These differ per surface (browser cookies vs. desktop secure storage vs. mobile keychain).
- **Tauri-specific code** — file dialogs, native menus, deep links, tray. All consumer-side.
- **Markdown-to-HTML rendering engine** — pinned via the consumer's bundle (likely `unified` + `remark` + `rehype`). The library exports `<NotePreview>` but expects the renderer instance to be passed in via props or context.

## Migration of `packages/client`

The web client refactor is an integral part of this sub-project, not a follow-up:

1. Extract every component from `packages/client/src/components/**` into `packages/ui/src/**` per the structure above. Components stop importing data hooks (`useNotes` from a local context, `fetch` calls); instead they take data via props or via the new `useKryton{Notes|Folders|Tags|...}` hooks the library exports.
2. Create `packages/client/src/data/HttpAdapter.ts` implementing `KrytonDataAdapter` against `/api/*`.
3. Wrap the client's `<App>` in `<KrytonDataProvider adapter={httpAdapter}>`.
4. Replace direct component imports in client pages with `@azrtydxb/ui` imports.
5. Delete the now-empty `packages/client/src/components/**`.

The web client retains: routes, auth UI, the HttpAdapter, the App shell that wires everything. The visible surface to a user does not change.

## Plugin loader

The current plugin runtime in `packages/client` reads a registry JSON from `kryton-plugins`, downloads plugin JS, exposes `window.__krytonPluginDeps`, and lets plugins register UI hooks. This moves into `packages/ui/src/plugins/`.

API surface plugins use:

```ts
declare global {
  interface Window {
    __krytonPluginDeps: {
      React: typeof React;
      ReactDOM: typeof import("react-dom");
      vim: typeof import("@codemirror/vim");
      getCM: () => EditorView;
      // ... existing surface, unchanged from current
    };
  }
}
```

Plugins continue to register via the existing `activate(api)` lifecycle. The desktop and web clients both wire `__krytonPluginDeps` identically when they mount `<KrytonDataProvider>`.

## Versioning + publishing

- Same release cadence as `@azrtydxb/core` and `@azrtydxb/core-react` (lockstep).
- Published from kryton monorepo via the existing `publish-core.yml` workflow extended to also publish `@azrtydxb/ui`.
- Peer deps: `react@>=18`, `react-dom@>=18`, `@azrtydxb/core@4.4.x`, `@azrtydxb/core-react@4.4.x`, `tailwindcss@>=3.4`.

## Testing strategy

- **Unit tests:** components rendered in isolation with a `MockDataProvider` that returns canned data. Vitest + Testing Library + jsdom.
- **Conformance test suite for adapters:** any consumer's `KrytonDataAdapter` implementation runs against a shared 50-test conformance suite that exercises all the library's data assumptions (subscriptions fire on mutations, error states surface, etc.). Web's `HttpAdapter` and desktop's `CoreAdapter` both pass.
- **Visual regression:** Storybook with Chromatic or Percy for the primitives. Defer to v1.1 if budget tight.

## Out of scope for v1

- React Native variants. Mobile uses its own components.
- Custom design system docs site. README is enough until a contributor base exists.
- Theming beyond dark/light/system. Custom themes via Tailwind preset overrides only.
- Extracting `packages/server`'s admin UI. Stays in `packages/client` (admin is online-only).

## Open implementation questions

1. The library exports a Tailwind preset; do consumers need to opt into Tailwind, or can the lib ship a pre-built CSS file? Default: preset (Tailwind required); consumers compile their own CSS using lib classes. Easier than shipping a 500KB CSS file.
2. Plugin loader expects access to the consumer's React tree. Solved by exposing the loader as a `<PluginRoot>` component the consumer mounts inside `<KrytonDataProvider>`.
3. Markdown renderer choice — the library exposes `<NotePreview render={fn}>` and consumers pass their renderer. v1 just re-exports the existing client's setup as a default; advanced consumers can swap.
