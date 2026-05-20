---
title: Code-fence renderers
description: Render custom UI from a markdown code fence — the kanban plugin as the canonical example of the `interactive` flag.
---

A code-fence renderer is a React component that the host invokes whenever it encounters a fenced block tagged with your plugin's language. It's how `kanban`, `mermaid`, `dataview`, `mind-map`, and `excalidraw` all hook into the preview and editor.

## Register

```ts
api.markdown.registerCodeFenceRenderer(language: string, component: React.ComponentType<FenceRendererProps>): void
```

`language` is the string after the opening ` ``` ` (e.g. `kanban`, `mermaid`). One renderer per language per plugin; the host enforces uniqueness.

## Props

The host passes the following to every fence renderer it instantiates:

```ts
interface FenceRendererProps {
  /** The body of the fence — everything between the opening and closing ```. */
  content: string;
  /** The note path the fence lives in, e.g. "alice/projects/launch.md". */
  notePath: string;
  /** Body-relative line range of the fence (post frontmatter strip + wiki-link substitution). */
  range?: { startLine: number; endLine: number };
  /** Raw-file line range, suitable for direct round-trip via api.notes.replaceFenceAtRange. */
  rawRange?: { startLine: number; endLine: number };
  /** The literal fence text (including the ```lang and closing ``` lines). */
  source?: string;
  /**
   * False in pure Preview mode, true in Editor / Split mode.
   * Gate every editable control on this flag.
   */
  interactive?: boolean;
}
```

### When `interactive` is `false`

Render a read-only view: no input fields, no drag handles, no delete buttons. The user is in Preview mode and likely sharing a screen or printing — destructive controls have no business being visible.

### When `interactive` is `true`

Render the full editable surface. The user is in Editor or Split mode; mutations belong to them.

The host defaults `interactive` to `false` if it doesn't (yet) know what mode the user is in. **Render the safer read-only path** when in doubt — match the kanban plugin's `interactive: interactive === true` strict-equality check.

## Canonical example: the kanban plugin

The kanban plugin (`kryton-plugins/plugins/kanban/client/index.ts`) is the reference implementation. It parses the fence body as a list of columns + cards, renders an interactive board, and round-trips edits back into the note.

### Registration

```ts
import type { ClientPluginAPI } from '../../../types/client';

const { React } = window.__krytonPluginDeps;
const { createElement: h } = React;

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
        api.notify.error('Kanban save failed: ' + (e?.message ?? String(e)));
      });
    };

    return h(KanbanBoard, {
      initial: content,
      onChange,
      // Default interactive=false so the safer read-only path applies
      // if the host doesn't yet forward the flag.
      interactive: interactive === true,
    });
  }

  api.markdown.registerCodeFenceRenderer('kanban', KanbanFenceRenderer);
}
```

### Gating mutations on `interactive`

Inside `KanbanBoard`, every editable affordance is wrapped in a check:

```ts
// Drag handles
h('div', {
  style: {
    cursor: interactive ? 'grab' : 'default',
    // ...
  },
});

// Delete buttons
h('button', {
  disabled: !interactive,
  style: interactive ? undefined : { cursor: 'default' },
  // ...
});

// Add-card input shows only in interactive mode
interactive ? h('input', { /* ... */ }) : null;
```

The same pattern fits any code-fence renderer. Read-only first; layer editability on top of `interactive === true`.

### Round-trip strategy

Kanban uses a **locate-and-replace** approach rather than `api.notes.replaceFenceAtRange`:

```ts
function replaceFenceInRaw(
  rawContent: string,
  originalSource: string | null,
  newBody: string,
): string | null {
  const fence = '```kanban\n' + newBody + '\n```';
  if (originalSource) {
    const idx = rawContent.indexOf(originalSource);
    if (idx !== -1 && rawContent.indexOf(originalSource, idx + 1) === -1) {
      return rawContent.slice(0, idx) + fence + rawContent.slice(idx + originalSource.length);
    }
  }
  // Fallback: first ```kanban fence in the file.
  const re = /```kanban\n[\s\S]*?\n```/;
  if (re.test(rawContent)) {
    return rawContent.replace(re, fence);
  }
  return null;
}
```

Why not `api.notes.replaceFenceAtRange`? The `range` prop is **body-relative** (post-frontmatter, post-wiki-link substitution) whereas `replaceFenceAtRange` expects **raw-file** line numbers. The `rawRange` prop closes this gap for plugins that prefer the host helper:

```ts
// Alternative round-trip using rawRange (added in v4.0+ hosts)
if (rawRange) {
  await api.notes.replaceFenceAtRange(notePath, rawRange, newFence);
}
```

Pick whichever you find clearer. `replaceFenceAtRange` is one round-trip; locate-and-replace handles edge cases (frontmatter drift, hand-edits to neighbouring fences) more gracefully.

## Other renderers in the registry

| Plugin | Language | What it renders |
|---|---|---|
| `kanban` | ` ```kanban ` | Editable column + card board with drag-and-drop. |
| `mermaid-diagrams` | ` ```mermaid ` | SVG diagram via mermaid.js. |
| `dataview` | ` ```dataview ` | Queries the note tree and renders a results table. |
| `mind-map` | ` ```mindmap ` | Tree → radial layout. |
| `excalidraw` | ` ```excalidraw ` (and `.excalidraw.json`) | Embedded Excalidraw canvas backed by `@excalidraw/excalidraw`. |

Read them in [`azrtydxb/kryton-plugins/plugins/`](https://github.com/azrtydxb/kryton-plugins/tree/main/plugins) for variations on the same pattern.

## See also

- [UI slots](/kryton/advanced/plugins/ui-slots/) — every other extension point.
- [Client API](/kryton/advanced/plugins/client-api/) — `api.notes.replaceFenceAtRange`, `api.notify.error`, etc.
- [Testing and publishing](/kryton/advanced/plugins/testing-and-publishing/)
