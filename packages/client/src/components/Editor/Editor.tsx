import {
  useRef,
  useState,
  useMemo,
  useImperativeHandle,
  forwardRef,
  type CSSProperties,
} from 'react';
import { EditorView, type EditorPlugin, type EditorState } from '@azrtydxb/ui';
import { Icons } from '../Icons';
import { usePrefs, type EditorLayout } from '../../stores/prefsStore';
import { useUIStore } from '../../stores/uiStore';

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
  /** Path of the currently-active tab. Comes from useAppState.notes.activeNote. */
  activePath: string;
  /** Display title (used to derive the basename when the path lacks a .md). */
  activeTitle: string;
  /** When true the active tab shows a saving-pulse instead of the green "saved" dot. */
  dirty?: boolean;
  /** Called when the user selects a different tab. */
  onSelect: (path: string) => void;
  /** Called when the user closes a tab. */
  onClose: (path: string) => void;
}

function basenameOf(path: string, fallback: string): string {
  const base = path.split('/').filter(Boolean).pop() || fallback;
  // Drop the .md suffix — every Kryton note is markdown, so showing it
  // adds visual noise without conveying anything.
  return base.replace(/\.md$/, '');
}

interface TabProps {
  path: string;
  label: string;
  active: boolean;
  dirty: boolean;
  onSelect: () => void;
  onClose: () => void;
}

/** A single chip in the tab strip — file icon, basename, saved/saving pill, X. */
function Tab({ path, label, active, dirty, onSelect, onClose }: TabProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={path}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 38,
        padding: '0 10px 0 12px',
        cursor: active ? 'default' : 'pointer',
        background: active ? 'var(--bg)' : 'transparent',
        borderRight: '1px solid var(--line)',
        color: active ? 'var(--fg)' : 'var(--fg-3)',
        minWidth: 0,
        maxWidth: 240,
      }}
    >
      <Icons.FileText size={13} style={{ color: active ? 'var(--accent)' : 'var(--fg-4)' }} />
      <span
        className="mono"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {active && dirty && (
        // Only surface a status indicator while a save is in flight — when
        // everything is persisted, the tab stays clean. Removes the "always
        // green saved pill" the user found redundant.
        <span
          className="mono"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 2,
            padding: '2px 6px',
            borderRadius: 3,
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            fontSize: 10,
            color: 'var(--fg-3)',
          }}
        >
          <span
            className="dot pulse"
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--accent-warn)',
              boxShadow: 'none',
            }}
            aria-hidden
          />
          saving
        </span>
      )}
      <button
        type="button"
        aria-label={`Close ${label}`}
        title={`Close ${label}`}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{
          marginLeft: 2,
          width: 18,
          height: 18,
          borderRadius: 3,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          color: 'var(--fg-3)',
          // Hide unless the tab is hovered or active — avoids visual clutter
          // when many tabs are open and the user isn't aiming at any of them.
          visibility: hovered || active ? 'visible' : 'hidden',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-3)'; }}
      >
        <Icons.X size={10} />
      </button>
    </div>
  );
}

/**
 * Multi-tab strip — renders every entry in `useUIStore.openTabs`. Clicking
 * a tab activates its note via `onSelect`; clicking the X closes the tab
 * and falls back to the previous tab as active (handled by the store's
 * `closeTab` action which returns the next path to focus).
 */
export function EditorTabStrip({ activePath, activeTitle, dirty, onSelect, onClose }: EditorTabStripProps) {
  const openTabs = useUIStore((s) => s.openTabs);

  // If a load races ahead of the store update (active note set but tabs
  // not yet flushed), surface the active path so the strip isn't briefly
  // empty. Once openTabs catches up, this branch falls through to the
  // store-driven list.
  const tabs = useMemo(() => {
    if (activePath && !openTabs.includes(activePath)) return [...openTabs, activePath];
    return openTabs;
  }, [openTabs, activePath]);

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 38,
        background: 'var(--bg-1)',
        flexShrink: 0,
        overflowX: 'auto',
      }}
    >
      {tabs.map((path) => (
        <Tab
          key={path}
          path={path}
          label={basenameOf(path, path === activePath ? activeTitle : (path.split('/').pop() || path).replace(/\.md$/, ''))}
          active={path === activePath}
          dirty={path === activePath && !!dirty}
          onSelect={() => { if (path !== activePath) onSelect(path); }}
          onClose={() => onClose(path)}
        />
      ))}
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
        gap: 1,
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
    padding: '4px 8px',
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
