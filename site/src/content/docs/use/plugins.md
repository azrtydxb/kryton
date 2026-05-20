---
title: Plugins
description: Switch on Kanban boards, Mermaid diagrams, and other extras from the admin panel.
---

Plugins extend Kryton with new editor blocks, side panels, and code-fence renderers. The core stays small; you pick what to add.

![A Kanban board rendered inline](/kryton/screenshots/editor.png)

## Enable a plugin

If you're an admin:

1. Open the **Admin** panel from the user menu.
2. Go to **Plugins**.
3. Toggle the plugin on. Most take effect immediately; a few prompt for a page reload.

Non-admins use whatever an admin has switched on for the workspace.

## Two crowd favourites

- **Kanban** — Add a kanban board to any note. Drag cards between columns; the underlying note stays plain markdown so your data is portable.
- **Mermaid** — Drop a `mermaid` code fence into a note and Kryton renders it as a live diagram (flowcharts, sequence diagrams, gantt charts, and more).

## Browsing more

The admin **Plugins** tab lists every plugin available, with a short description and a link to its source. Plugins are open source and live in the [`kryton-plugins`](https://github.com/azrtydxb/kryton-plugins) repository — you can write your own if you'd like.
