---
title: UI slots
description: Every place a Kryton plugin can render — sidebar, statusbar, editor toolbar, topbar, settings, custom pages, and note actions.
---

The host exposes a fixed set of UI extension points. Each one has a `register*` call on `api.ui` and a real-world example you can read in the [`kryton-plugins`](https://github.com/azrtydxb/kryton-plugins) repo.

| Slot | API call | Notes |
|---|---|---|
| Sidebar panel | `api.ui.registerSidebarPanel(Component, { id, title, icon, order? })` | Adds an icon to the sidebar rail; clicking it opens the panel. Users can drag the panel between the left and right rails. |
| Statusbar item | `api.ui.registerStatusBarItem(Component, { id, position, order? })` | `position: "left" \| "right"`. Small inline render inside the bottom statusbar. |
| Editor toolbar button | `api.ui.registerEditorToolbarButton(Component, { id, order? })` | Inline button in the editor's top toolbar (alongside built-in formatting actions). |
| Topbar action | `api.ui.registerTopbarAction(Component, { id, order? })` | Always-visible action button in the header. |
| Settings section | `api.ui.registerSettingsSection(Component, { id, title })` | Custom section inside the plugin's own settings card in the admin panel. |
| Custom page | `api.ui.registerPage(Component, { id, path, title, icon, showInSidebar? })` | A full-route page mounted at `/p/<path>`. Optionally listed in the sidebar. |
| Note action | `api.ui.registerNoteAction({ id, label, icon, onClick })` | Adds a menu item to the per-note action menu. |
| Code-fence renderer | `api.markdown.registerCodeFenceRenderer(language, Component)` | See [Code-fence renderers](/kryton/advanced/plugins/code-fence-renderers/). |

## Signature reference

These come straight from [`types/client.d.ts`](https://github.com/azrtydxb/kryton-plugins/blob/main/types/client.d.ts):

```ts
ui: {
  registerSidebarPanel(
    component: any,
    options: { id: string; title: string; icon: string; order?: number },
  ): void;
  registerStatusBarItem(
    component: any,
    options: { id: string; position: "left" | "right"; order?: number },
  ): void;
  registerEditorToolbarButton(
    component: any,
    options: { id: string; order?: number },
  ): void;
  registerSettingsSection(
    component: any,
    options: { id: string; title: string },
  ): void;
  registerPage(
    component: any,
    options: {
      id: string;
      path: string;
      title: string;
      icon: string;
      showInSidebar?: boolean;
    },
  ): void;
  registerNoteAction(options: {
    id: string;
    label: string;
    icon: string;
    onClick: (notePath: string) => void;
  }): void;
  registerTopbarAction(
    component: any,
    options: { id: string; order?: number },
  ): void;
  closePane(): void;
};
```

`id` must be unique within the plugin. `order` is an integer hint — smaller renders first; default is 100. `icon` is a [lucide](https://lucide.dev/icons/) icon name.

## Examples from the registry

### Sidebar panel — `calendar`

```ts
// kryton-plugins/plugins/calendar/client/index.ts
api.ui.registerSidebarPanel(CalendarPanel, {
  id: 'calendar',
  title: 'Calendar',
  icon: 'calendar',
});
```

A full-month calendar grid that links each day cell to that day's daily note. Similar shape used by `recent-files`, `tag-wrangler`, `checklist`, `metrics`, `reading-list`, `rss-reader`, `templater`, `git-backup`, `calendar-journal`.

### Editor toolbar button — `advanced-tables`

```ts
// kryton-plugins/plugins/advanced-tables/client/index.ts
api.ui.registerEditorToolbarButton(FormatTableButton, {
  id: 'format-table',
  order: 200,
});
```

Adds a "Format table" button next to the built-in bold / italic / heading actions.

### Topbar action — `mass-upload`

```ts
// kryton-plugins/plugins/mass-upload/client/index.ts
api.ui.registerTopbarAction(UploadButton, {
  id: 'mass-upload-action',
});
```

A persistent button in the header that pops a multi-file uploader.

### Code-fence renderer — `mermaid-diagrams`

```ts
// kryton-plugins/plugins/mermaid-diagrams/client/index.ts
api.markdown.registerCodeFenceRenderer('mermaid', MermaidRenderer);
```

Renders ` ```mermaid ` fenced blocks via the [mermaid.js](https://mermaid.js.org/) library. See [Code-fence renderers](/kryton/advanced/plugins/code-fence-renderers/) for the full walkthrough.

### Statusbar item

```ts
api.ui.registerStatusBarItem(WordCount, {
  id: 'wordcount',
  position: 'right',
  order: 10,
});
```

Pattern: keep statusbar items tiny — single line, ideally no taller than the font size. A live word count, a sync indicator, an autosave timestamp.

### Settings section

```ts
api.ui.registerSettingsSection(MySettings, {
  id: 'my-plugin-settings',
  title: 'My Plugin',
});
```

Rendered beneath the plugin's card in **Admin → Plugins**. Use it to expose per-plugin configuration that the user controls (rather than what the admin controls via env vars).

### Custom page

```ts
api.ui.registerPage(DashboardPage, {
  id: 'metrics-dashboard',
  path: 'metrics',
  title: 'Metrics',
  icon: 'chart-bar',
  showInSidebar: true,
});
```

Mounts at `/p/metrics`. With `showInSidebar: true`, the icon also lands in the main app nav. Useful for plugins that need more space than a sidebar panel allows.

### Note action

```ts
api.ui.registerNoteAction({
  id: 'export-pdf',
  label: 'Export as PDF',
  icon: 'file-down',
  onClick: (notePath) => exportPdf(notePath),
});
```

Adds an entry to the "…" menu on the note header.

## See also

- [Quickstart](/kryton/advanced/plugins/quickstart/) — hello-world sidebar panel.
- [Code-fence renderers](/kryton/advanced/plugins/code-fence-renderers/) — the markdown extension point.
- [Client API](/kryton/advanced/plugins/client-api/) — generated reference for the rest of `api.*`.
