# URL Routing Design — Mobile WebView Targets

**Status:** Design (pre-implementation)  
**Implements:** Phase 0e.1 of the Kryton mobile plan  
**Next:** Task 0e.2 implements the routes described here

---

## 1. Current State of the SPA

### State store

All view-navigation state lives in a single Zustand store:
`src/stores/uiStore.ts` — `useUIStore`.

The top-level display mode is `view: MainView` where:

```ts
type MainView = 'note' | 'all' | 'graph' | 'tags';
```

Initial value is `'note'`. The setter is `setView(v: MainView)`.

### Existing URL machinery

The project **already has partial URL routing** via two custom modules:

- `src/lib/urlSchema.ts` — defines `NavState`, `parseUrl`, `serializeNav`, `navEquals`
- `src/hooks/useUrlSync.ts` — bidirectional sync hook, mounted once in `AppContent`

**Current URL grammar** (from `urlSchema.ts`):

| URL | State |
|---|---|
| `/` | default / empty view |
| `/n/<encoded-path>?tabs=...` | note open, multi-tab |
| `/view/all` | all-notes view |
| `/view/graph` | graph view |
| `/view/tags?tag=<name>` | tags view |
| `/shared/<ownerUserId>/<path>` | shared note |

`useUrlSync` is mounted in `AppContent` (App.tsx line 335). On mount it parses `window.location` and dispatches to `uiStore`; it subscribes to the store and calls `history.pushState` / `replaceState` on change; it listens for `popstate` to handle browser back/forward. The infinite-loop guard is `navEquals(prev, next)` — if the new URL equals the current one, no push is issued.

No third-party router library is installed. The `package.json` `dependencies` contain no `react-router`, `wouter`, or `@tanstack/router`.

### Entering graph view

Three entry points all call `setView('graph')`:

1. **Keyboard shortcut** — `Ctrl/Cmd+G` in `src/hooks/useKeyboardShortcuts.ts` (calls `shortcutActions.toggleGraph`, which calls `setView(view === 'graph' ? 'note' : 'graph')`)
2. **Header "Graph" button** — in `App.tsx`, `<Header … onGraphView={() => setView('graph')} />`
3. **Quick-switcher command** — "Graph view" command in `QuickSwitcher` dispatches `onGraphView` → `setView('graph')`

When `view === 'graph'`, `App.tsx` renders `<GraphPanel fullscreen … />` and hides the right rail.

### Entering canvas/edit view

A note is opened via `state.notes.openNote(path)` (from `useAppState`). When `view === 'note'` and `notes.activeNote` is set, the main pane renders either:

- `<PreviewModeView>` when `editing === false`
- `<EditModeView>` when `editing === true`

Edit mode is entered via `enterEditMode()` from `useAppCallbacks`, which calls `uiStore.enterEditMode(content)` (sets `editing: true`). Clicking the Edit button in `PreviewModeView` or pressing `Ctrl/Cmd+E` both reach this path.

To enter a note's edit view from a URL: call `setView('note')`, `openNote(path)`, then optionally `enterEditMode()`. The `/canvas/:id` route maps to opening a note and entering edit mode.

### Reaching the plugins tab

The plugins tab lives inside `AdminPage` (`src/pages/AdminPage.tsx`), which is a full-screen modal. The modal is gated by `uiStore.showAdmin: boolean`.

To reach the plugins tab from a URL:
1. `uiStore.setShowAdmin(true)` — opens the admin modal
2. `AdminPage` has local `useState<Tab>('users')` — initial tab is `'users'`
3. **There is no external handle to pre-select the plugins tab.** `AdminPage` only accepts an `onClose` prop.

This means `/plugin/:name` cannot route directly into the plugins tab without modifying `AdminPage` to accept an `initialTab` prop. Task 0e.2 must add `initialTab?: Tab` to `AdminPage` and pipe it through `ModalsContainer` + `useUIStore`.

---

## 2. Proposed Router Choice

**No third-party router.** The existing `useUrlSync` + `urlSchema` machinery already handles the bidirectional URL ↔ state sync without React Router. Adding a router would require wrapping the entire app in `<BrowserRouter>` and teaching it to coexist with the manual `history` calls — unnecessary churn.

The mobile WebView targets are added as **new URL patterns** parsed by `urlSchema.parseUrl` and applied by `useUrlSync`'s `applyImpl`. This is the same pattern used by `/view/graph` and `/n/<path>` today.

**Required `urlSchema` extension:** Add two new `NavState` variants:

```ts
| { kind: 'canvas'; id: string }
| { kind: 'plugin'; name: string; notePath: string | null }
```

---

## 3. Route → View-State Mapping

| URL | NavState kind | State setters fired | Notes |
|---|---|---|---|
| `/canvas/<encoded-id>` | `canvas` | `setView('note')`, `openNote(decodedId)`, `enterEditMode()` | `id` is an encoded note path, same encoding as `/n/`. Opens the note in edit/canvas mode. |
| `/view/graph` | `view` (existing) | `setView('graph')` | Already exists. No change needed. |
| `/plugin/<name>?note=<notePath>` | `plugin` | `setView('note')`, `setShowAdmin(true)`, `openNote(notePath)` if present | Opens admin modal. Requires `AdminPage` to accept `initialTab='plugins'` and pre-select the named plugin. |

### State setter call sequence

**`/canvas/<id>`**
```
setView('note')                   // show note pane
openNote(decodeNotePath(id))      // fetch + activate the note
enterEditMode()                   // flip editing:true once content loads
```
`enterEditMode` must fire after the note content is available (inside `openNote`'s resolved callback). The canvas route component uses a `useEffect` that watches `notes.activeNote` and calls `enterEditMode` when it becomes non-null.

**`/plugin/<name>?note=<notePath>`**
```
setView('note')                   // ensure note pane is backing state
setShowAdmin(true)                // open admin modal
// (AdminPage receives initialTab='plugins')
if (notePath) openNote(notePath)  // optional background focus
// plugin name passed as prop so the PluginsTab can pre-scroll / highlight
```

---

## 4. URL ↔ State Bridge Approach

### Mount → state (inbound)

`useUrlSync` already calls `applyImpl(parseUrl(...))` on mount and on `popstate`. Extend `applyImpl`'s `switch` with two new cases:

```ts
case 'canvas': {
  ui.setView('note');
  void cb.openNote(nav.id);
  // enterEditMode is deferred — fired by a useEffect watching activeNote
  cb.onCanvasRoute?.();   // signals App to flip into edit mode after load
  return;
}
case 'plugin': {
  ui.setView('note');
  ui.setShowAdmin(true);
  ui.setPendingPluginTab(nav.name);  // new uiStore field
  if (nav.notePath) void cb.openNote(nav.notePath);
  return;
}
```

### State → URL (outbound)

`useUrlSync`'s `writeUrl` computes a `NavSnapshot` from the store and calls `serializeNav`. Extend `navStateFromSnapshot` to emit canvas/plugin URLs when the store has the corresponding pending signals (e.g. `editing === true` and `view === 'note'` maps to the current `/n/` URL, not `/canvas/`).

Canvas and plugin URLs are **write-once entry points** — the mobile host constructs them; the SPA does not need to write them back. The `/n/<path>` URL already takes over once the note is open. This avoids any need to emit `/canvas/` from the outbound path.

### Infinite-loop guard

Unchanged: `navEquals(parseUrl(location), nextNav)` before any `pushState`. Since canvas/plugin URLs are only consumed on inbound navigation (the SPA writes `/n/<path>` for the ongoing session), there is no outbound push to guard against.

---

## 5. Backwards Compatibility

- `/` continues to render `{ kind: 'default' }` → empty view with no active note. No change.
- `/view/graph`, `/view/all`, `/view/tags`, `/n/<path>`, `/shared/<…>` — all existing patterns are unchanged.
- Non-matching URLs already fall through to `{ kind: 'default' }` in `parseUrl`. New patterns are additive, so existing in-app navigation is unaffected.
- The `AdminPage` `initialTab` prop is optional with a default of `'users'`, so all existing callers (`ModalsContainer`) that pass no `initialTab` continue to open on the users tab.

---

## 6. Testing Approach

Route behaviour is validated with **memory-router-equivalent component tests** using `@testing-library/react` and `vitest`:

- Mock `window.location` / `window.history` (jsdom supports both)
- Mount `App` with a custom URL via `Object.defineProperty(window, 'location', ...)`
- Assert that the correct component is rendered (e.g. `GraphPanel` for `/view/graph`, `EditModeView` for `/canvas/Boards%2FRoadmap.canvas`)
- Assert that `uiStore.view` equals the expected `MainView` after mount
- For plugin routes, assert `uiStore.showAdmin === true` and that the admin modal renders with the plugins tab active

Unit tests for `parseUrl` / `serializeNav` in `urlSchema.ts` cover the new `canvas` and `plugin` grammar independently of React.

---

## Open Questions for Task 0e.2

1. **`enterEditMode` deferral** — the canvas route needs a signal to fire `enterEditMode` after `openNote` resolves. Cleanest path: add an `onCanvasRoute` callback to `UrlSyncCallbacks`, implemented in `App.tsx` as a `useEffect` watching `notes.activeNote` + a `pendingCanvasRoute` flag.

2. **Plugin name pre-selection** — `PluginsTab` currently has no way to highlight a named plugin. Task 0e.2 decides whether to add a `focusPlugin?: string` prop or a `uiStore.pendingPluginName` field.

3. **`AdminPage` initialTab prop** — `uiStore.showAdmin` opens the modal; `AdminPage`'s `tab` is local state. The cleanest bridge is a new `initialTab?: Tab` prop on `AdminPage` (prop-drilled through `ModalsContainer`). Alternatively, a `uiStore.adminInitialTab` field avoids prop-drilling but adds store surface area.
