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
  type Transaction,
} from "../../state";
import { projectDom } from "./projectDom";
import { domRangeToSelection, selectionToDomRange } from "./selection";
import { interpretBeforeInput } from "./beforeinput";
import { normalizeClipboardData } from "./paste";
import { detectTriggerOnInsert, refreshTrigger } from "./suggestionTrigger";
import { SuggestionPopup } from "./SuggestionPopup";
import type { Suggestion, SuggestionTrigger } from "../../state/plugins";
import {
  emitEditorTransaction,
  getEditorPlugins,
  setActiveEditor,
  subscribeEditorPlugins,
} from "../../../plugins/editor-registry";
import {
  getEditorOptions,
  subscribeEditorOptions,
  type EditorOptions,
} from "../../../plugins/editor-options";

/**
 * Snapshot of one remote collaborator's selection, rendered as a colored
 * caret + name label overlaid on the editor surface. Cursor offsets are
 * char positions into the document text (the same coordinate space as
 * `EditorState.selection`).
 */
export interface RemoteCursorDecoration {
  id: string;
  anchor: number;
  head: number;
  color: string;
  name: string;
  kind: "user" | "agent";
}

export interface EditorViewProps {
  /** Initial source text, only used on mount. Ignored when `controlledState`
   *  is provided — controlled mode reads the doc from `controlledState`. */
  initialDoc?: string;
  /** Plugins contributing decorations / commands / suggestions. */
  plugins?: readonly EditorPlugin[];
  /** Called after every transaction with the new state. */
  onChange?: (state: EditorState) => void;
  /** Called when the user clicks/taps a wikilink decoration. */
  onWikilinkClick?: (target: string) => void;
  className?: string;
  /**
   * Controlled mode: when both `controlledState` and `onDispatch` are
   * provided, the view renders from `controlledState` and routes every
   * transaction through `onDispatch` instead of applying it internally.
   * The owner is responsible for calling `applyTransaction` (or running
   * it through a Y.js binding) and pushing the resulting state back as
   * the next `controlledState`. Selection / cursor / paste / IME paths
   * still produce transactions — they just delegate the apply step.
   */
  controlledState?: EditorState;
  onDispatch?: (tr: Transaction) => void;
  /**
   * Remote collaborator cursors rendered as colored carets + name
   * labels. Positions are document char offsets in the same space as
   * `state.selection`. The local user is the caller's responsibility to
   * exclude (filter by clientID before passing in).
   */
  remoteCursors?: ReadonlyArray<RemoteCursorDecoration>;
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
  "mark-header": "ed-mark-header",
  "mark-list": "ed-mark-list",
  "mark-quote": "ed-mark-quote",
  "mark-link": "ed-mark-link",
  "mark-link-url": "ed-mark-link-url",
};

export function EditorView({
  initialDoc = "", plugins = [], onChange, onWikilinkClick, className,
  controlledState, onDispatch, remoteCursors,
}: EditorViewProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const composingRef = React.useRef(false);
  const [internalState, setStateInternal] = React.useState<EditorState>(() => createEditorState(initialDoc));
  const isControlled = controlledState !== undefined && onDispatch !== undefined;
  const state = isControlled ? controlledState : internalState;
  const stateRef = React.useRef<EditorState>(state);
  const historyRef = React.useRef(createHistory());
  const onDispatchRef = React.useRef(onDispatch);

  React.useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  React.useEffect(() => {
    onDispatchRef.current = onDispatch;
  }, [onDispatch]);

  const setState = React.useCallback((next: EditorState) => {
    stateRef.current = next;
    onChange?.(next);
    setStateInternal(next);
  }, [onChange]);

  // Plugins dynamically registered via api.editor.registerPlugin. Merged
  // with the explicit `plugins` prop on every render so decorations /
  // onKeyDown handlers come from both sources.
  const [dynamicPlugins, setDynamicPlugins] = React.useState<
    readonly EditorPlugin[]
  >(() => getEditorPlugins());
  React.useEffect(() => {
    return subscribeEditorPlugins(setDynamicPlugins);
  }, []);

  // Editor options bag — driven by api.editor.setOption from plugins.
  // Today: "lineNumbers" toggles the gutter render below.
  const [editorOptions, setEditorOptions] = React.useState<EditorOptions>(
    () => getEditorOptions(),
  );
  React.useEffect(() => {
    return subscribeEditorOptions(setEditorOptions);
  }, []);
  const allPlugins = React.useMemo(
    () => [...plugins, ...dynamicPlugins],
    [plugins, dynamicPlugins],
  );
  const allPluginsRef = React.useRef(allPlugins);
  React.useLayoutEffect(() => {
    allPluginsRef.current = allPlugins;
  }, [allPlugins]);

  // ── Suggestion popup state ────────────────────────────────────────────────
  const [trigger, setTrigger] = React.useState<SuggestionTrigger | null>(null);
  const triggerRef = React.useRef<SuggestionTrigger | null>(null);
  React.useLayoutEffect(() => {
    triggerRef.current = trigger;
  }, [trigger]);
  const [suggestionItems, setSuggestionItems] = React.useState<
    readonly Suggestion[]
  >([]);
  const suggestionItemsRef = React.useRef<readonly Suggestion[]>([]);
  React.useLayoutEffect(() => {
    suggestionItemsRef.current = suggestionItems;
  }, [suggestionItems]);
  const [activeSuggestion, setActiveSuggestion] = React.useState(0);
  const activeSuggestionRef = React.useRef(0);
  React.useLayoutEffect(() => {
    activeSuggestionRef.current = activeSuggestion;
  }, [activeSuggestion]);
  const [popupPos, setPopupPos] = React.useState<{ top: number; left: number } | null>(null);
  const suggestionReqIdRef = React.useRef(0);

  const closeSuggestions = React.useCallback(() => {
    setTrigger(null);
    setSuggestionItems([]);
    setActiveSuggestion(0);
    setPopupPos(null);
  }, []);

  const dispatchTransaction = React.useCallback(
    (transaction: Transaction) => {
      if (onDispatchRef.current) {
        onDispatchRef.current(transaction);
        emitEditorTransaction(transaction, stateRef.current);
        return;
      }
      const next = applyTransaction(stateRef.current, transaction);
      setState(next);
      emitEditorTransaction(transaction, next);
    },
    [setState],
  );

  const dispatch = React.useCallback((tr: { ops: Operation[]; selection: Selection | null }) => {
    const transaction = transactionFromOps(tr.ops, tr.selection ?? undefined);
    if (onDispatchRef.current) {
      // Controlled mode: history is the owner's responsibility (the Y.js
      // binding's undo manager handles it). We still call the owner so the
      // ops route through the binding before being reflected back as the
      // next `controlledState`.
      onDispatchRef.current(transaction);
      emitEditorTransaction(transaction, stateRef.current);
      return;
    }
    historyRef.current.record(stateRef.current, tr);
    const next = applyTransaction(stateRef.current, transaction);
    setState(next);
    emitEditorTransaction(transaction, next);
  }, [setState]);

  // Register this view as the active editor for the module-scoped editor
  // registry so client plugins' api.editor.{getActiveState,dispatch} talk
  // to it. Latest mount wins (the host app mounts at most one EditorView
  // for the active note).
  React.useEffect(() => {
    setActiveEditor({
      getState: () => stateRef.current,
      dispatch: dispatchTransaction,
    });
    return () => setActiveEditor(null);
  }, [dispatchTransaction]);

  // After every render, replace selection in the DOM to match state.selection.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || composingRef.current) return;
    selectionToDomRange(root, state.selection);
  });

  // Position the popup near the caret. Reads the live DOM selection rect
  // and converts to viewport coords for the popup's `position: fixed`.
  const updatePopupPos = React.useCallback(() => {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0).cloneRange();
      r.collapse(true);
      const rect = r.getBoundingClientRect();
      // Empty rect can occur on a brand-new line — fall back to root rect.
      const useRect =
        rect.width === 0 && rect.height === 0
          ? rootRef.current?.getBoundingClientRect()
          : rect;
      if (!useRect) return;
      setPopupPos({ top: useRect.bottom + 4, left: useRect.left });
    } catch {
      // ignore
    }
  }, []);

  // Re-collect suggestions from every plugin for the current trigger.
  // Uses a request-id to discard stale async results when the trigger
  // changes or closes while the previous call was in flight.
  const refreshSuggestions = React.useCallback(
    async (t: SuggestionTrigger) => {
      const reqId = ++suggestionReqIdRef.current;
      const results = await Promise.all(
        allPluginsRef.current.map(async (p) => {
          if (!p.suggestions) return [] as Suggestion[];
          try {
            return await p.suggestions(stateRef.current, t);
          } catch (err) {
            console.error(`[plugins] ${p.name}.suggestions threw:`, err);
            return [] as Suggestion[];
          }
        }),
      );
      if (reqId !== suggestionReqIdRef.current) return; // stale
      if (triggerRef.current !== t && triggerRef.current?.from !== t.from) {
        // Trigger replaced — drop these.
        return;
      }
      const seen = new Set<string>();
      const merged: Suggestion[] = [];
      for (const batch of results) {
        for (const item of batch) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }
      }
      setSuggestionItems(merged);
      setActiveSuggestion((prev) => Math.min(prev, Math.max(0, merged.length - 1)));
    },
    [],
  );

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

      // Trigger detection: only on insertText of a single character with
      // a collapsed selection at the caret.
      let newTrigger: SuggestionTrigger | null = null;
      if (ev.inputType === "insertText" && ev.data && ev.data.length === 1) {
        const sel = stateRef.current.selection;
        if (sel.anchor === sel.head) {
          newTrigger = detectTriggerOnInsert(
            stateRef.current.doc,
            sel.anchor,
            ev.data,
          );
        }
      }

      dispatch(interpreted);

      if (newTrigger) {
        setTrigger(newTrigger);
        setActiveSuggestion(0);
        // Seed a position so the popup mounts immediately; the precise
        // caret coordinates are refined after the DOM reflects the insert.
        setPopupPos((prev) => prev ?? { top: 0, left: 0 });
        queueMicrotask(() => updatePopupPos());
        void refreshSuggestions(newTrigger);
      } else if (triggerRef.current) {
        const next = refreshTrigger(
          triggerRef.current,
          stateRef.current.doc,
          stateRef.current.selection.head,
        );
        if (!next) {
          closeSuggestions();
        } else {
          setTrigger(next);
          queueMicrotask(() => updatePopupPos());
          void refreshSuggestions(next);
        }
      }
    };
    root.addEventListener("beforeinput", handler);
    return () => root.removeEventListener("beforeinput", handler);
  }, [dispatch, closeSuggestions, refreshSuggestions, updatePopupPos]);

  // Apply the selected suggestion: replace [trigger.from..trigger.caret]
  // with `insert`, place caret at end of the inserted text.
  const applySuggestion = React.useCallback(
    (item: Suggestion) => {
      const t = triggerRef.current;
      if (!t) return;
      const from = t.from;
      const to = t.caret;
      const text = item.insert;
      dispatch({
        ops:
          from === to
            ? [{ kind: "insert", at: from, text }]
            : [{ kind: "replace", from, to, text }],
        selection: { anchor: from + text.length, head: from + text.length },
      });
      closeSuggestions();
    },
    [dispatch, closeSuggestions],
  );

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
    // Suggestion popup keymap — takes precedence over plugin onKeyDown
    // handlers so the user can navigate/dismiss the popup regardless of
    // what else is registered. Only intercepts when the popup is live
    // AND has items.
    if (triggerRef.current && suggestionItemsRef.current.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestion(
          (i) => (i + 1) % suggestionItemsRef.current.length,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const len = suggestionItemsRef.current.length;
        setActiveSuggestion((i) => (i - 1 + len) % len);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item =
          suggestionItemsRef.current[activeSuggestionRef.current];
        if (item) applySuggestion(item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSuggestions();
        return;
      }
    } else if (triggerRef.current && e.key === "Escape") {
      e.preventDefault();
      closeSuggestions();
      return;
    }

    // Plugin cascade: each EditorPlugin with onKeyDown gets a chance to
    // claim the event. The first non-null result wins. Returning a
    // Transaction dispatches it; "prevent-default" swallows the event
    // without dispatching. null passes through to the next plugin (then
    // the editor's own keymap below).
    for (const p of allPluginsRef.current) {
      if (!p.onKeyDown) continue;
      let result: ReturnType<NonNullable<EditorPlugin["onKeyDown"]>>;
      try {
        result = p.onKeyDown(e.nativeEvent, stateRef.current);
      } catch (err) {
        console.error(`[plugins] ${p.name}.onKeyDown threw:`, err);
        continue;
      }
      if (result === null || result === undefined) continue;
      e.preventDefault();
      if (result === "prevent-default") return;
      dispatchTransaction(result);
      return;
    }

    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === "z" && !e.shiftKey) {
      // In controlled mode the local history stack is unused — undo/redo
      // belongs to the Y.js binding's UndoManager (wired in a later phase).
      // Let the browser's default behaviour pass through rather than
      // applying a stale local snapshot that would diverge from Y.
      if (onDispatchRef.current) return;
      e.preventDefault();
      const undone = historyRef.current.undo(stateRef.current);
      if (undone) setState(undone);
    } else if (meta && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
      if (onDispatchRef.current) return;
      e.preventDefault();
      const redone = historyRef.current.redo(stateRef.current);
      if (redone) setState(redone);
    }
  };

  const onSelect = () => {
    if (composingRef.current) return;
    const root = rootRef.current!;
    const next = domRangeToSelection(root);
    // Refresh the suggestion trigger against the latest caret. If the
    // caret moved out of bounds, this closes the popup. Run unconditionally
    // because click-to-move doesn't always change the offset numbers (the
    // user may click back inside the active trigger range — still valid).
    if (triggerRef.current) {
      const updated = refreshTrigger(
        triggerRef.current,
        stateRef.current.doc,
        next.head,
      );
      if (!updated) {
        closeSuggestions();
      } else if (
        updated.caret !== triggerRef.current.caret ||
        updated.query !== triggerRef.current.query
      ) {
        setTrigger(updated);
        queueMicrotask(() => updatePopupPos());
        void refreshSuggestions(updated);
      }
    }
    if (next.anchor !== stateRef.current.selection.anchor || next.head !== stateRef.current.selection.head) {
      if (onDispatchRef.current) {
        // Controlled mode: a selection-only change is a transaction with
        // no ops; the owner threads it back via `controlledState`.
        onDispatchRef.current(transactionFromOps([], next));
        return;
      }
      const updated = { ...stateRef.current, selection: next };
      stateRef.current = updated;
      onChange?.(updated);
      setStateInternal(updated);
    }
  };

  // Close the popup on any document mousedown outside the popup itself.
  React.useEffect(() => {
    if (!trigger) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-suggestion-popup=""]')) return;
      const root = rootRef.current;
      if (root && target && root.contains(target)) return;
      closeSuggestions();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [trigger, closeSuggestions]);

  const onClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-kind="wikilink"]') as HTMLElement | null;
    if (target) {
      const wlTarget = target.getAttribute("data-target");
      if (wlTarget && onWikilinkClick) onWikilinkClick(wlTarget);
    }
  };

  const decos = [
    ...emitDecorations(state.doc, state.tree),
    ...collectDecorations(allPlugins, state),
  ];
  const runs = projectDom(state.doc, decos);
  const lineCount = state.doc.split("\n").length;

  // Remote cursor overlays — position colored carets + labels at the
  // DOM rect computed for each remote `head` offset. Recomputes on every
  // render of the editor body (which already covers doc / decoration
  // changes) and whenever the remote cursor list changes identity.
  const [cursorRects, setCursorRects] = React.useState<
    Array<{ id: string; top: number; left: number; height: number; color: string; name: string; kind: "user" | "agent" }>
  >([]);
  const cursorRectsRef = React.useRef(cursorRects);
  React.useLayoutEffect(() => {
    cursorRectsRef.current = cursorRects;
  }, [cursorRects]);
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !remoteCursors || remoteCursors.length === 0) {
      if (cursorRectsRef.current.length > 0) setCursorRects([]);
      return;
    }
    const containerRect = root.getBoundingClientRect();
    const next: typeof cursorRects = [];
    for (const rc of remoteCursors) {
      const offset = rc.head;
      let placed = false;
      for (const child of Array.from(root.children)) {
        const fromAttr = child.getAttribute("data-from");
        const toAttr = child.getAttribute("data-to");
        if (fromAttr === null || toAttr === null) continue;
        const from = Number(fromAttr);
        const to = Number(toAttr);
        if (offset >= from && offset <= to) {
          const textNode = child.firstChild ?? child;
          const local = Math.max(0, Math.min((textNode.textContent ?? "").length, offset - from));
          try {
            const range = document.createRange();
            range.setStart(textNode, local);
            range.setEnd(textNode, local);
            const rect = range.getBoundingClientRect();
            // Empty lines collapse to a zero-width rect at (0,0) on some
            // engines — fall back to the parent span's rect in that case.
            const useRect = rect.height > 0 ? rect : (child as HTMLElement).getBoundingClientRect();
            next.push({
              id: rc.id,
              top: useRect.top - containerRect.top + root.scrollTop,
              left: useRect.left - containerRect.left + root.scrollLeft,
              height: useRect.height || 16,
              color: rc.color,
              name: rc.name,
              kind: rc.kind,
            });
            placed = true;
          } catch {
            // ignore
          }
          break;
        }
      }
      void placed;
    }
    // Stable-by-id comparison: only re-set state when something actually changed.
    const prev = cursorRectsRef.current;
    const same =
      next.length === prev.length &&
      next.every((n, i) => {
        const p = prev[i];
        return p && p.id === n.id && p.top === n.top && p.left === n.left && p.height === n.height && p.color === n.color && p.name === n.name && p.kind === n.kind;
      });
    if (!same) setCursorRects(next);
  }, [remoteCursors, state]);

  return (
    <div className={className ?? "ed-shell"} data-editor-shell="" style={{ position: "relative" }}>
      {editorOptions.lineNumbers && (
        <div className="ed-gutter" aria-hidden="true" data-testid="ed-gutter">
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i} className="ed-ln">{i + 1}</span>
          ))}
        </div>
      )}
      <div
        ref={rootRef}
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
        style={{ position: "relative" }}
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
        <div
          ref={overlayRef}
          aria-hidden="true"
          data-remote-cursor-overlay=""
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          {cursorRects.map((rc) => (
            <div
              key={rc.id}
              data-remote-cursor={rc.id}
              data-remote-cursor-kind={rc.kind}
              style={{
                position: "absolute",
                top: rc.top,
                left: rc.left,
                height: rc.height,
                width: 2,
                background: rc.color,
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: -2,
                  left: 0,
                  transform: "translateY(-100%)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  fontSize: 10,
                  fontFamily: "var(--font-mono, monospace)",
                  lineHeight: 1.2,
                  color: "#fff",
                  background: rc.color,
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span>{rc.name}</span>
                {rc.kind === "agent" && (
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      padding: "0 3px",
                      borderRadius: 2,
                      background: "rgba(0,0,0,0.25)",
                    }}
                  >
                    AI
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {trigger && popupPos && suggestionItems.length > 0 && (
        <SuggestionPopup
          items={suggestionItems}
          activeIndex={activeSuggestion}
          top={popupPos.top}
          left={popupPos.left}
          onPick={applySuggestion}
          onHover={setActiveSuggestion}
        />
      )}
    </div>
  );
}
