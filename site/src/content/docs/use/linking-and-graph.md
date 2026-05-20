---
title: Linking and graph
description: Wiki-links, the backlinks panel, and the local vs global graph.
---

## Wiki-links

Surround a note's name with double square brackets to link to it:

```markdown
See also [[Project Goals]].
```

In preview mode, broken links — links to notes that don't exist yet — are rendered with a distinct `wiki-link-broken` class and offer to create the target on click. Embedded notes use the `![[Note]]` syntax and inline the target's content; image embeds use `![[image.png]]`.

## Backlinks

Every note has a backlinks panel showing the other notes that link to it. It updates as you add or remove `[[…]]` references elsewhere in the vault.

## Graph

![Graph view](/kryton/screenshots/graph-view.png)

The graph has two modes:

- **local** — the 2-hop neighbourhood centred on the active note.
- **global** — the whole vault, force-directed.

Switch between them from the segmented `local` / `global` control on the graph panel. When no note is open, the graph forces global mode (local is meaningless without a centre). Press `⌘G` / `Ctrl+G` to toggle the graph fullscreen.
