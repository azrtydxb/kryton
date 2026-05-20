---
title: Code-fence renderers
description: Render custom UI in place of a markdown code fence — the kanban plugin as the canonical example.
---

A code-fence renderer replaces the rendered output of a fenced block
(``` ```kanban …``` ```, ``` ```mermaid …``` ```, etc.) with a React
component. The Kanban plugin is the reference implementation;
walkthrough below.

## Registration

`api.markdown.registerCodeFenceRenderer(language, component)` takes the
fence language string and a React component. The host instantiates one
renderer per matching fence in the rendered note.

```ts
api.markdown.registerCodeFenceRenderer('kanban', KanbanFenceRenderer);
```

(`kryton-plugins/plugins/kanban/client/index.ts`)

## The renderer props

The component receives `CodeFenceRendererProps`, defined in
`kryton-plugins/types/client.d.ts`:

| Prop | Type | Meaning |
|------|------|---------|
| `content` | `string` | The fence body, without the surrounding ``` ``` lines. |
| `notePath` | `string` | Host note path. Empty when no path is known (e.g. transient previews). |
| `range?` | `{ startLine, endLine }` | Range in the **parsed** note source (after frontmatter strip + wikilink-embed substitution). |
| `rawRange?` | `{ startLine, endLine }` | Range in the **raw** on-disk content — matches the string returned by `api.notes.get(path).content`. Pass this to `api.notes.replaceFenceAtRange`. |
| `source?` | `string` | The entire original fence including the ``` ``` markers. Useful when locate-and-replace is safer than line-range edits. |
| `interactive?` | `boolean` | `false` in pure Preview mode — gate editable controls on this. |

`rawRange` and `source` exist because the parsed and raw coordinate
spaces differ once frontmatter and embedded wikilinks are processed.
Round-tripping to disk safely means using one of them, not `range`.

## The Kanban plugin walkthrough

The full file is at
`kryton-plugins/plugins/kanban/client/index.ts`. Here's the renderer
and its persistence path, verbatim:

```ts
interface FenceRendererProps {
  content: string;
  notePath: string;
  range?: { startLine: number; endLine: number };
  source?: string;
  /** False in pure Preview mode; gate editable controls on this. */
  interactive?: boolean;
}

export function activate(api: ClientPluginAPI): void {
  function KanbanFenceRenderer(props: FenceRendererProps): any {
    const { content, notePath, source, interactive } = props;
    const onChange = (next: string) => {
      api.notes.get(notePath).then((file: any) => {
        const raw = typeof file === 'string' ? file : (file && file.content) || '';
        const updated = replaceFenceInRaw(raw, source || null, next);
        if (updated === null) {
          api.notify.error('Kanban save failed: could not locate fence in note');
          return;
        }
        return api.notes.update(notePath, updated);
      }).catch((e: any) => {
        api.notify.error('Kanban save failed: ' + (e && e.message ? e.message : String(e)));
      });
    };
    return h(KanbanBoard, {
      initial: content,
      onChange,
      // Default interactive=false here so the safer read-only path
      // applies if the host doesn't yet forward the flag.
      interactive: interactive === true,
    });
  }
  api.markdown.registerCodeFenceRenderer('kanban', KanbanFenceRenderer);
}
```

Three things to notice:

1. **`content` drives the render.** The board is parsed from the fence
   body on every render. No external state.
2. **`source` drives the write-back.** The plugin reads the raw note,
   finds the exact original fence string, and splices in the new body.
   The fallback when `source` is missing is a regex over the first
   ``` ```kanban``` fence in the file.
3. **`interactive === true` is the gating idiom.** Edit / Split modes
   pass `true`; pure Preview passes `false` (or omits it). The
   component compares for strict equality to default to read-only when
   the flag isn't supplied — useful for older hosts that don't yet
   forward it.

## Read-only gating pattern

The Kanban board uses `interactive` to disable drag-and-drop, delete
buttons, and add-card affordances:

```ts
// inside KanbanBoard, kanban/client/index.ts:
disabled: !interactive,
style: interactive ? undefined : { cursor: 'default' },
```

Apply the same pattern in your renderer: render the same visual but
disable anything that would dispatch an `onChange`.

## Persisting changes

Two write-back paths, both on `api.notes`:

- `api.notes.replaceFenceAtRange(path, range, newSource)` — when you
  trust `rawRange`. The simplest path.
- `api.notes.update(path, fullContent)` — for the locate-and-replace
  strategy Kanban uses (above), or any time you need to rewrite more
  than one fence.

Either way, the host routes the write through the same pipeline as
human edits — Yjs broadcasts to peers, the disk file gets rewritten,
and search / graph indexes update on the next pass.
