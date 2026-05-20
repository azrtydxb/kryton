---
title: Your first notes
description: Write a note, link it with double brackets, add a tag, and open the graph.
---

## Create a note

Press `⌘⇧N` (or `Ctrl+Shift+N` on Linux) to create a new note. The editor opens in edit mode. Changes are auto-saved through a 500 ms debounced PUT.

![Editing a note](/kryton/screenshots/note-preview.png)

## Link to another note

Type `[[` followed by the target note's name to insert a wiki-link. Clicking a wiki-link in preview navigates to that note; clicking a link to a note that doesn't exist yet offers to create it.

```markdown
See also [[Project Goals]] for the full plan.
```

The toolbar's **Wiki link** button inserts the same syntax around your selection.

## Add a tag

Anywhere in a note, type `#` followed by the tag name:

```markdown
#research #to-read
```

Tags are aggregated under the **Tags** view in the sidebar. There's a placeholder hint in the empty state: "no tags yet — tag a note with #<name>".

## Open the graph

Press `⌘G` (or `Ctrl+G`) to toggle the graph fullscreen. The graph has two modes:

- **local** — the 2-hop neighbourhood around the active note.
- **global** — the entire vault, force-directed.

![Graph view](/kryton/screenshots/graph-view.png)

When no note is open, the graph forces global mode.

## Shortcuts you'll use

| Action | Shortcut |
|---|---|
| Open quick switcher | `⌘P` / `Ctrl+P` |
| Focus search | `⌘K` / `Ctrl+K` |
| All Notes view | `⌘N` / `Ctrl+N` |
| New note | `⌘⇧N` / `Ctrl+Shift+N` |
| Toggle sidebar | `⌘B` / `Ctrl+B` |
| Toggle edit/preview | `⌘E` / `Ctrl+E` |
| Toggle graph | `⌘G` / `Ctrl+G` |
| Rename note | `F2` |
| Toggle star | `⌘⇧S` / `Ctrl+Shift+S` |
