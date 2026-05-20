---
title: Editor
description: Toolbar, split view, the four-tab strip, and auto-save.
---

The editor is a CodeMirror-based markdown editor with a formatting toolbar and a preview mode.

![Editor](/kryton/screenshots/editor.png)

## Toolbar

The formatting toolbar exposes (in order):

- **Undo** (`⌘Z`) and **Redo** (`⌘⇧Z`)
- **Heading 1**, **Heading 2**, **Heading 3**
- **Bold** (`⌘B`), **Italic** (`⌘I`), **Strikethrough**, **Inline code**
- **Wiki link**, **Insert image**, **Upload image**
- **Bullet list**, **Numbered list**, **Task list**
- **Blockquote**, **Horizontal rule**, **Insert table**
- **Edit mode** / **Preview mode** toggle

Hover tooltips show the keyboard shortcut where applicable.

## Tabs

Open notes are tracked in a tab strip capped at **4 tabs**. When you open a fifth note, the oldest tab is evicted (FIFO).

## Auto-save

Changes are persisted via a 500 ms debounced HTTP PUT to the server. When a note is being edited collaboratively over the Yjs WebSocket, the HTTP save is suppressed and the server's Y flush handles persistence instead.

## Edit and preview

Toggle between edit and preview with `⌘E` / `Ctrl+E`. Preview renders wiki-links, embedded notes (`![[note]]`), image embeds (`![[image.png]]`), and the usual markdown.
