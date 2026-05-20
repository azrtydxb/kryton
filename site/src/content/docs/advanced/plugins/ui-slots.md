---
title: UI slots
description: Every place a Kryton plugin can render — sidebar, statusbar, editor toolbar, topbar, settings, custom pages, and note actions.
---

A plugin's `activate(api)` callback registers components against
specific UI slots. Every slot below is a method on `api.ui` — the
canonical signatures live in
[`kryton-plugins/types/client.d.ts`](https://github.com/azrtydxb/kryton-plugins/blob/main/types/client.d.ts).

| Slot | Method | Where it appears |
|------|--------|------------------|
| Sidebar panel | `registerSidebarPanel(component, { id, title, icon, order? })` | Left sidebar, switchable like the file tree. |
| Status bar item | `registerStatusBarItem(component, { id, position, order? })` | Bottom bar, `"left"` or `"right"`. |
| Editor toolbar button | `registerEditorToolbarButton(component, { id, order? })` | Inside the editor toolbar (visible in Edit / Split). |
| Topbar action | `registerTopbarAction(component, { id, order? })` | Top bar, next to global actions. |
| Settings section | `registerSettingsSection(component, { id, title })` | Account Settings → Plugin sections. |
| Custom page | `registerPage(component, { id, path, title, icon, showInSidebar? })` | Full-window route with optional sidebar entry. |
| Note action | `registerNoteAction({ id, label, icon, onClick })` | Per-note action menu; receives the note path. |

The `icon` strings reference Kryton's icon set; check existing plugins
for valid names.

## Examples

Each snippet below is verbatim from a plugin in
[`kryton-plugins/plugins/`](https://github.com/azrtydxb/kryton-plugins/tree/main/plugins).

### Sidebar panel — `recent-files`

```ts
api.ui.registerSidebarPanel(RecentFilesPanel, {
  id: 'recent-files',
  title: 'Recent Files',
  icon: 'clock',
  order: 10,
});
```

### Status bar item — `pomodoro`

```ts
api.ui.registerStatusBarItem(PomodoroStatusItem, {
  id: 'pomodoro-timer',
  position: 'right',
  order: 10,
});
```

### Editor toolbar button — `advanced-tables`

```ts
api.ui.registerEditorToolbarButton(FormatTableButton, {
  id: 'advanced-tables-format',
  order: 50,
});
```

### Topbar action — `mass-upload`

```ts
api.ui.registerTopbarAction(
  () => h(UploadButton, { api }),
  { id: 'mass-upload-btn', order: 0 },
);
```

### Settings section — `theme-settings`

```ts
api.ui.registerSettingsSection(ThemeSettingsSection, {
  id: 'theme-settings',
  title: 'Theme Settings',
});
```

### Note action — `publish`

```ts
api.ui.registerNoteAction({
  id: 'publish-export-html',
  label: 'Export as HTML',
  icon: 'globe',
  onClick: async (notePath: string) => {
    // … publish logic
  },
});
```

### Custom page — `registerPage`

```ts
api.ui.registerPage(MyPageComponent, {
  id: 'my-page',
  path: '/plugin/my-page',
  title: 'My Page',
  icon: 'layers',
  showInSidebar: true,
});
```

The signature is in `ClientPluginAPI`; the page mounts at the supplied
path inside the Kryton SPA. When `showInSidebar` is true, the host adds
an entry to the sidebar nav.

## Beyond `api.ui`

A few non-UI registrations sit on sibling namespaces and are often used
in the same `activate(api)` body:

- `api.markdown.registerCodeFenceRenderer(language, component)` — see
  [Code-fence renderers](/kryton/advanced/plugins/code-fence-renderers/).
- `api.markdown.registerPostProcessor(fn)` — transform rendered HTML.
- `api.commands.register({ id, name, shortcut?, execute })` — register
  a command callable from the command palette.
- `api.editor.registerPlugin(plugin)` — install an editor extension
  (decorations, keybindings, suggestions). The full `EditorPlugin`
  shape is in `types/client.d.ts`.

The full list of methods, including `api.context`, `api.notes`,
`api.storage`, `api.api`, and `api.notify`, is in the
[Client API reference](/kryton/advanced/plugins/client-api/).
