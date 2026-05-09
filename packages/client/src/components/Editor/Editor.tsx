import {
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  type CSSProperties,
} from 'react';
import { EditorView, type EditorPlugin, type EditorState } from '@azrtydxb/ui';
import { Icons } from '../Icons';
import { usePrefs, type EditorLayout } from '../../stores/prefsStore';

export interface EditorCursorState {
  line: number;
  col: number;
  wordCount: number;
}

/** Imperative handle exposed by <Editor ref={...}> for toolbar / outline usage. */
export interface EditorHandle {
  /** Wrap the current selection (or the word "text") with `before` / `after`. */
  wrapSelection(before: string, after: string): void;
  /** Insert `prefix` at the start of the current line. */
  insertAtLineStart(prefix: string): void;
  /** Insert `text` at the current caret position. */
  insertText(text: string): void;
  /** Return the current document text. */
  getDoc(): string;
  /** Scroll to a 1-based line number (best effort, DOM-based). */
  scrollToLine(line: number): void;
  /** Focus the editor surface. */
  focus(): void;
}

interface EditorProps {
  /** Initial document text — treated as uncontrolled after mount.
   *  To switch to a different note, remount via a `key` change at the parent. */
  content: string;
  onChange: (content: string) => void;
  /** Passed for future wiki-link plugin wiring; currently unused. */
  darkMode?: boolean;
  onCursorStateChange?: (state: EditorCursorState) => void;
  plugins?: readonly EditorPlugin[];
  onWikilinkClick?: (target: string) => void;
  className?: string;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Editor — wraps the new in-house EditorView.
 *
 * Exposes an imperative EditorHandle so toolbar and outline-jump can
 * manipulate the document without a CM6 view ref.
 *
 * Note: this component is uncontrolled after mount. The parent is responsible
 * for remounting (via a `key` prop) when switching to a different note.
 *
 * Toolbar mutations (bold, italic, etc.) are applied by updating `localDoc`
 * state and incrementing `mountKey`, which remounts the EditorView with the
 * new content. This is acceptable for infrequent toolbar commands.
 */
export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    content,
    onChange,
    onCursorStateChange,
    plugins = [],
    onWikilinkClick,
    className,
  }: EditorProps,
  ref,
) {
  // localDoc tracks the current doc for imperative mutations.
  // Initialised once from `content`; updated by toolbar commands.
  const [localDoc, setLocalDoc] = useState(content);
  // Incrementing mountKey causes EditorView to remount with the new localDoc.
  const [mountKey, setMountKey] = useState(0);
  // selectionRef tracks the last known selection offsets.
  const selectionRef = useRef<{ anchor: number; head: number }>({ anchor: 0, head: 0 });
  const editorRootRef = useRef<HTMLDivElement>(null);

  const handleChange = (state: EditorState) => {
    selectionRef.current = state.selection;
    const doc = state.doc;
    // Keep localDoc in sync for imperative ops without triggering remount.
    setLocalDoc(doc);
    onChange(doc);

    if (onCursorStateChange) {
      const offset = state.selection.head;
      const textBefore = doc.slice(0, offset);
      const lines = textBefore.split('\n');
      const line = lines.length;
      const col = (lines[lines.length - 1]?.length ?? 0) + 1;
      onCursorStateChange({ line, col, wordCount: countWords(doc) });
    }
  };

  // Apply a toolbar mutation: update localDoc state and bump mountKey to
  // remount EditorView with the new content.
  const applyMutation = (nextDoc: string, newOffset: number) => {
    setLocalDoc(nextDoc);
    setMountKey((k) => k + 1);
    selectionRef.current = { anchor: newOffset, head: newOffset };
    onChange(nextDoc);
  };

  useImperativeHandle(ref, () => ({
    wrapSelection(before: string, after: string) {
      const { anchor, head } = selectionRef.current;
      const from = Math.min(anchor, head);
      const to = Math.max(anchor, head);
      const selected = localDoc.slice(from, to);
      const inner = selected || 'text';
      const nextDoc = localDoc.slice(0, from) + before + inner + after + localDoc.slice(to);
      applyMutation(nextDoc, from + before.length + inner.length + after.length);
    },
    insertAtLineStart(prefix: string) {
      const { anchor } = selectionRef.current;
      const lineStart = localDoc.lastIndexOf('\n', anchor - 1) + 1;
      const nextDoc = localDoc.slice(0, lineStart) + prefix + localDoc.slice(lineStart);
      applyMutation(nextDoc, anchor + prefix.length);
    },
    insertText(text: string) {
      const { anchor } = selectionRef.current;
      const from = Math.min(anchor, selectionRef.current.head);
      const to = Math.max(anchor, selectionRef.current.head);
      const nextDoc = localDoc.slice(0, from) + text + localDoc.slice(to);
      applyMutation(nextDoc, from + text.length);
    },
    getDoc() {
      return localDoc;
    },
    scrollToLine(line: number) {
      const root = editorRootRef.current;
      if (!root) return;
      const lines = localDoc.split('\n');
      if (line < 1 || line > lines.length) return;
      // Compute the char offset of the target line.
      let offset = 0;
      for (let i = 0; i < line - 1; i++) {
        offset += (lines[i]?.length ?? 0) + 1; // +1 for '\n'
      }
      // Find the span whose [data-from, data-to] straddles offset.
      const spans = root.querySelectorAll<HTMLElement>('span[data-from]');
      for (const span of spans) {
        const from = parseInt(span.getAttribute('data-from') ?? '-1', 10);
        const to = parseInt(span.getAttribute('data-to') ?? '-1', 10);
        if (from <= offset && offset <= to) {
          span.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
    },
    focus() {
      const root = editorRootRef.current;
      if (!root) return;
      const editable = root.querySelector<HTMLElement>('[contenteditable]');
      editable?.focus();
    },
  }));

  return (
    <div ref={editorRootRef} className={className ?? 'h-full w-full'}>
      <EditorView
        key={mountKey}
        initialDoc={localDoc}
        plugins={plugins}
        onChange={handleChange}
        onWikilinkClick={onWikilinkClick}
        className="h-full w-full"
      />
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*  Tab strip                                                                 */
/* -------------------------------------------------------------------------- */

interface EditorTabStripProps {
  activePath: string;
  activeTitle: string;
  /** When true, the dirty-pulse dot is shown (replaces the "saved" check briefly). */
  dirty?: boolean;
  onClose?: () => void;
}

/**
 * Single-tab strip — the existing client only tracks one active note,
 * so we render a single tab. Designed to extend to multi-tab later.
 */
export function EditorTabStrip({ activePath, activeTitle, dirty, onClose }: EditorTabStripProps) {
  const [hover, setHover] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 32,
        background: 'var(--bg)',
        flexShrink: 0,
      }}
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '2px solid var(--accent)',
          marginBottom: -1,
          minWidth: 0,
          maxWidth: 280,
        }}
      >
        <Icons.FileText size={13} style={{ color: 'var(--accent)' }} />
        <span
          className="mono"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--fg)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={activePath}
        >
          {(() => {
            const basename = activePath.split('/').filter(Boolean).pop() || activeTitle;
            return basename.endsWith('.md') ? basename : `${activeTitle}.md`;
          })()}
        </span>
        {/* Saved-status pill per prototype/app/editor.jsx EditorTabBar. The
            dot pulses while dirty (mid-edit) and the label flips between
            "saving" and "saved" — for now we always show "saved" since the
            client autosaves on idle. */}
        <span
          className="mono"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 4,
            padding: '2px 6px',
            borderRadius: 3,
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--fg-3)',
          }}
        >
          <span
            className={dirty ? 'dot pulse' : 'dot'}
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: dirty ? 'var(--accent)' : 'var(--accent-good)',
              boxShadow: 'none',
            }}
            aria-hidden
          />
          {dirty ? 'saving' : 'saved'}
        </span>
        {hover && onClose && (
          <button
            onClick={onClose}
            title="Close"
            style={{
              marginLeft: 2,
              width: 16,
              height: 16,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 3,
              color: 'var(--fg-3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--fg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--fg-3)';
            }}
          >
            <Icons.X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mode pills                                                                */
/* -------------------------------------------------------------------------- */

interface ModePillsProps {
  /** Optional override; defaults to the prefs store layout. */
  value?: EditorLayout;
  onChange?: (value: EditorLayout) => void;
}

/**
 * Segmented control: Edit / Split / Preview.
 * Reads/writes `usePrefs().layout` by default.
 */
export function ModePills({ value, onChange }: ModePillsProps) {
  const layout = usePrefs((s) => s.layout);
  const setPref = usePrefs((s) => s.setPref);
  const current = value ?? layout;

  const handle = (next: EditorLayout) => {
    if (onChange) onChange(next);
    else setPref('layout', next);
  };

  return (
    <div
      role="tablist"
      aria-label="Editor layout"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        borderRadius: 7,
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
      }}
    >
      <ModePill icon={<Icons.Edit size={11} />} label="Edit" active={current === 'edit'} onClick={() => handle('edit')} />
      <ModePill icon={<Icons.Layout size={11} />} label="Split" active={current === 'split'} onClick={() => handle('split')} />
      <ModePill icon={<Icons.Eye size={11} />} label="Preview" active={current === 'preview'} onClick={() => handle('preview')} />
    </div>
  );
}

function ModePill({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 10px',
    borderRadius: 5,
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: active ? 'var(--accent)' : 'var(--fg-2)',
    background: active ? 'var(--accent-soft)' : 'transparent',
    transition: 'background 120ms ease, color 120ms ease',
  };
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="mono"
      style={base}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon}
      {label}
    </button>
  );
}
