---
title: Your first notes
description: Write a note, link it to another, add a tag, and see your knowledge graph come to life.
---

You're signed in. Here's a five-minute tour to feel out how Kryton thinks.

## Write your first note

From the sidebar, click **New note**. Give it a title — say, *Reading list* — and start typing in the editor. Kryton uses Markdown, so a line starting with `#` becomes a heading, `**bold**` becomes **bold**, and `- item` becomes a bullet.

Your note auto-saves as you type. There's no save button.

![A note in preview](/kryton/screenshots/note-preview.png)

## Link to another note

Type two square brackets and start writing the name of another note:

```
I want to read [[The Pragmatic Programmer]] next.
```

If that note exists, Kryton turns it into a clickable link. If it doesn't, click the link anyway — Kryton will create the new note for you, ready to write into.

This is the most important habit in Kryton. Every time you mention something that deserves its own page, wrap it in `[[double brackets]]`.

## Add a tag

Anywhere in a note, type a hash followed by a word:

```
#books #to-read
```

That's a tag. Tags don't have to exist beforehand. Click any tag to see every note that uses it.

## Open the graph

Click the **Graph** button in the toolbar. Each note becomes a dot; each `[[link]]` becomes a line. As you write more, you'll see clusters form around topics that share links and tags.

![Graph view](/kryton/screenshots/graph-view.png)

## Where to next

- [The editor](/kryton/use/editor/) — formatting, slash commands, split view.
- [Linking and the graph](/kryton/use/linking-and-graph/) — backlinks, orphans, and how to navigate.
- [Search and tags](/kryton/use/search-and-tags/) — find anything from anywhere.
