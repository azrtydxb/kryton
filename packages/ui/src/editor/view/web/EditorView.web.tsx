// packages/ui/src/editor/view/web/EditorView.web.tsx
import * as React from "react";
import type { Operation, Selection } from "../../state";
import {
  applyTransaction,
  createEditorState,
  createHistory,
  emitDecorations,
  transactionFromOps,
  collectDecorations,
  type EditorPlugin,
  type EditorState,
} from "../../state";
import { projectDom } from "./projectDom";
import { domRangeToSelection, selectionToDomRange } from "./selection";
import { interpretBeforeInput } from "./beforeinput";
import { normalizeClipboardData } from "./paste";

export interface EditorViewProps {
  /** Initial source text, only used on mount. */
  initialDoc?: string;
  /** Plugins contributing decorations / commands / suggestions. */
  plugins?: readonly EditorPlugin[];
  /** Called after every transaction with the new state. */
  onChange?: (state: EditorState) => void;
  /** Called when the user clicks/taps a wikilink decoration. */
  onWikilinkClick?: (target: string) => void;
  className?: string;
}

const KIND_CLASS: Record<string, string> = {
  "heading-1": "ed-h1", "heading-2": "ed-h2", "heading-3": "ed-h3",
  "heading-4": "ed-h4", "heading-5": "ed-h5", "heading-6": "ed-h6",
  bold: "ed-bold", italic: "ed-italic", strikethrough: "ed-strike",
  "code-inline": "ed-code-inline", "code-block": "ed-code-block",
  link: "ed-link", wikilink: "ed-wikilink", tag: "ed-tag",
  blockquote: "ed-blockquote", "list-item": "ed-li",
  "task-checked": "ed-task-checked", "task-unchecked": "ed-task-unchecked",
  "horizontal-rule": "ed-hr",
};

export function EditorView({
  initialDoc = "", plugins = [], onChange, onWikilinkClick, className,
}: EditorViewProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const composingRef = React.useRef(false);
  const stateRef = React.useRef<EditorState>(createEditorState(initialDoc));
  const historyRef = React.useRef(createHistory());
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);

  const setState = React.useCallback((next: EditorState) => {
    stateRef.current = next;
    onChange?.(next);
    forceRender();
  }, [onChange]);

  const dispatch = React.useCallback((tr: { ops: Operation[]; selection: Selection | null }) => {
    historyRef.current.record(stateRef.current, tr);
    setState(applyTransaction(stateRef.current, transactionFromOps(tr.ops, tr.selection ?? undefined)));
  }, [setState]);

  // After every render, replace selection in the DOM to match state.selection.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || composingRef.current) return;
    selectionToDomRange(root, stateRef.current.selection);
  });

  // React's synthetic `onBeforeInput` is mapped to the legacy `textInput` event,
  // not the modern `beforeinput`. Bind a native listener so we can preventDefault
  // on the real event and translate it into a Transaction.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handler = (e: Event) => {
      const ev = e as InputEvent;
      if (composingRef.current) return; // let IME run
      const interpreted = interpretBeforeInput(ev, stateRef.current.selection);
      if (!interpreted) return;
      ev.preventDefault();
      dispatch(interpreted);
    };
    root.addEventListener("beforeinput", handler);
    return () => root.removeEventListener("beforeinput", handler);
  }, [dispatch]);

  const onCompositionStart = () => { composingRef.current = true; };
  const onCompositionEnd = (e: React.CompositionEvent) => {
    composingRef.current = false;
    // Reconcile: read the resulting text near the caret and produce a single
    // replace covering the composition range.
    const root = rootRef.current!;
    const liveSel = domRangeToSelection(root);
    const composed = e.data ?? "";
    const start = stateRef.current.selection.anchor;
    dispatch({
      ops: [{ kind: "replace", from: Math.min(start, liveSel.anchor), to: Math.max(start, liveSel.anchor), text: composed }],
      selection: liveSel,
    });
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = normalizeClipboardData(e.clipboardData);
    const sel = stateRef.current.selection;
    const from = Math.min(sel.anchor, sel.head);
    const to = Math.max(sel.anchor, sel.head);
    dispatch({
      ops: from === to
        ? [{ kind: "insert", at: from, text }]
        : [{ kind: "replace", from, to, text }],
      selection: { anchor: from + text.length, head: from + text.length },
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      const undone = historyRef.current.undo(stateRef.current);
      if (undone) setState(undone);
    } else if (meta && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      const redone = historyRef.current.redo(stateRef.current);
      if (redone) setState(redone);
    }
  };

  const onSelect = () => {
    if (composingRef.current) return;
    const root = rootRef.current!;
    const next = domRangeToSelection(root);
    if (next.anchor !== stateRef.current.selection.anchor || next.head !== stateRef.current.selection.head) {
      stateRef.current = { ...stateRef.current, selection: next };
      onChange?.(stateRef.current);
    }
  };

  const onClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-kind="wikilink"]') as HTMLElement | null;
    if (target) {
      const wlTarget = target.getAttribute("data-target");
      if (wlTarget && onWikilinkClick) onWikilinkClick(wlTarget);
    }
  };

  const decos = [
    ...emitDecorations(stateRef.current.doc, stateRef.current.tree),
    ...collectDecorations(plugins, stateRef.current),
  ];
  const runs = projectDom(stateRef.current.doc, decos);

  return (
    <div
      ref={rootRef}
      className={className ?? "ed-root"}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      onSelect={onSelect}
      onClick={onClick}
      data-editor-root=""
    >
      {runs.map((run, i) => (
        <span
          key={i}
          data-from={run.from}
          data-to={run.to}
          data-kind={run.kind ?? undefined}
          data-target={run.attrs?.target}
          className={run.kind ? KIND_CLASS[run.kind] : undefined}
        >
          {run.text}
        </span>
      ))}
    </div>
  );
}
