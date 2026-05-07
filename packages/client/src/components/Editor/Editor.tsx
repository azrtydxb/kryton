import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { NoteEditorReact, type EditorCursorState } from '@azrtydxb/ui';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { FileNode } from '../../lib/api';
import { collectNotePaths } from '../../lib/noteTreeUtils';
import { Icons } from '../Icons';
import { usePrefs, type EditorLayout } from '../../stores/prefsStore';

export type { EditorCursorState };

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  darkMode: boolean;
  allNotes: FileNode[];
  onCursorStateChange?: (state: EditorCursorState) => void;
  viewRef?: MutableRefObject<EditorView | undefined>;
  pluginExtensions?: Extension[];
}

/**
 * Thin adapter over @azrtydxb/ui NoteEditorReact.
 * Converts client's `allNotes: FileNode[]` to flat `notePaths` for
 * the ui component's [[wiki-link]] autocomplete.
 */
export function Editor({
  content,
  onChange,
  darkMode,
  allNotes,
  onCursorStateChange,
  viewRef,
  pluginExtensions,
}: EditorProps) {
  const notePaths = collectNotePaths(allNotes);

  return (
    <NoteEditorReact
      content={content}
      onChange={onChange}
      darkMode={darkMode}
      notePaths={notePaths}
      onCursorStateChange={onCursorStateChange}
      viewRef={viewRef}
      pluginExtensions={pluginExtensions}
    />
  );
}

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
  // Pulse window: while dirty=true the accent dot pulses; 1.5s after dirty
  // flips to false the pulse fades out.
  const [showPulse, setShowPulse] = useState<boolean>(!!dirty);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (dirty) {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      setShowPulse(true);
    } else if (showPulse) {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setShowPulse(false), 1500);
    }
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

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
        {showPulse && (
          <span
            className={dirty ? 'dot pulse' : 'dot'}
            style={{
              width: 6,
              height: 6,
              boxShadow: 'none',
              opacity: dirty ? 1 : 0.4,
              transition: 'opacity 600ms ease',
            }}
            aria-hidden
          />
        )}
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
