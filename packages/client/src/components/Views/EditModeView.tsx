import { ComponentType, useRef, useState, useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { FileNode } from '../../lib/api';
import { Editor, type EditorCursorState, type EditorHandle, EditorTabStrip, ModePills } from '../Editor/Editor';
import { Preview } from '../Preview/Preview';
// OutgoingLinksPanel intentionally removed to match design handoff: the
// editor surface has only the tab strip + body + EditorMeta (28px). Outgoing
// link metadata is surfaced through EditorMeta's `N outgoing` token.
import { Icons } from '../Icons';
import { usePrefs } from '../../stores/prefsStore';

type SaveStatus = 'unchanged' | 'unsaved' | 'saving' | 'saved' | 'error';

interface EditModeViewProps {
  activeNote: { path: string; title: string; content: string };
  editContent: string | null;
  originalContent: string | null;
  isStarred: boolean;
  resolvedTheme: string;
  allNotes: FileNode[];
  previewRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Ref exposed to parent for outline jump and other imperative needs. */
  editorRef?: React.MutableRefObject<EditorHandle | null>;
  getCodeFenceRenderer?: (language: string) => { component: ComponentType<{ content: string; notePath: string }> } | undefined;
  /** retained for parent API compatibility; auto-save handles persistence. */
  onSave?: () => void;
  onAutoSave: () => Promise<void>;
  onCancel: () => void;
  onToggleStar: () => void;
  onPdfExport: () => void;
  onContentChange: (content: string) => void;
  onCursorStateChange: (state: EditorCursorState) => void;
  /** retained for parent API compatibility; edit/split views don't render
     a backlinks panel — backlinks live inside the preview body's tail. */
  onNoteSelect?: (path: string) => void;
  onLinkClick: (name: string) => void;
  onCreateNote: (name: string) => void;
}

export function EditModeView({
  activeNote, editContent, originalContent,
  isStarred, resolvedTheme, allNotes,
  editorRef: externalEditorRef, previewRef,
  getCodeFenceRenderer,
  onAutoSave, onCancel, onToggleStar, onPdfExport,
  onContentChange, onCursorStateChange,
  onLinkClick, onCreateNote, onNoteSelect,
}: EditModeViewProps) {
  const hasChanges = editContent !== originalContent;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('unchanged');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layout = usePrefs((s) => s.layout);

  // Internal editor ref; also forwarded to parent via externalEditorRef.
  const localEditorRef = useRef<EditorHandle | null>(null);
  const editorRef = externalEditorRef ?? localEditorRef;

  const debouncedAutoSave = useDebouncedCallback(async () => {
    setSaveStatus('saving');
    try {
      await onAutoSave();
      setSaveStatus('saved');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus('unchanged');
      }, 2000);
    } catch {
      setSaveStatus('error');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setSaveStatus('unsaved');
      }, 3000);
    }
  }, 2000);

  useEffect(() => {
    if (hasChanges) {
      setSaveStatus('unsaved');
      debouncedAutoSave();
    } else if (saveStatus === 'unsaved') {
      setSaveStatus('unchanged');
      debouncedAutoSave.cancel();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editContent, originalContent]);

  useEffect(() => {
    return () => {
      debouncedAutoSave.cancel();
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showEditor = layout === 'edit' || layout === 'split';
  const showPreview = layout === 'preview' || layout === 'split';
  const dirty = hasChanges || saveStatus === 'saving' || saveStatus === 'unsaved';

  const saveStatusLabel = (() => {
    switch (saveStatus) {
      case 'saving': return { text: 'saving…', color: 'var(--fg-3)' };
      case 'saved':  return { text: 'saved',   color: 'var(--accent-good)' };
      case 'error':  return { text: 'save failed', color: 'var(--accent-danger)' };
      case 'unsaved': return { text: 'unsaved', color: 'var(--accent-warn)' };
      default: return { text: '', color: 'var(--fg-3)' };
    }
  })();

  // Suppress unused variable warnings; resolvedTheme and allNotes are used
  // for future theming and wiki-link plugin wiring.
  void resolvedTheme;
  void allNotes;

  const headerBtn = (props: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) => (
    <button
      onClick={props.onClick}
      title={props.title}
      style={{
        width: 28, height: 28, borderRadius: 5,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: props.active ? 'var(--accent-warn)' : 'var(--fg-3)',
        background: 'transparent',
        transition: 'background 120ms ease, color 120ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hover)';
        if (!props.active) e.currentTarget.style.color = 'var(--fg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        if (!props.active) e.currentTarget.style.color = 'var(--fg-3)';
      }}
    >
      {props.children}
    </button>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
      {/* Tab strip + actions row (single 32px row, shared bottom border) */}
      <div style={{ display: 'flex', alignItems: 'stretch', background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <EditorTabStrip
            activePath={activeNote.path}
            activeTitle={activeNote.title}
            dirty={dirty}
            onClose={onCancel}
          />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0 8px 0 4px', height: 32,
        }}>
          <ModePills />
          {/* tiny inline saved/saving indicator (mono, accent-good when 'saved') */}
          {(saveStatus === 'saving' || saveStatus === 'saved' || saveStatus === 'error' || saveStatus === 'unsaved') && (
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: saveStatusLabel.color, minWidth: 56, textAlign: 'right' }}>
              {saveStatusLabel.text}
            </span>
          )}
          {/* Star / Share / More — per prototype/app/editor.jsx EditorTabBar */}
          {headerBtn({
            onClick: onToggleStar,
            title: isStarred ? 'Unstar' : 'Star',
            active: isStarred,
            children: isStarred ? <Icons.StarOn size={13} /> : <Icons.Star size={13} />,
          })}
          {headerBtn({
            onClick: onPdfExport,
            title: 'Share / Export',
            children: <Icons.Share size={13} />,
          })}
          {headerBtn({
            onClick: onCancel,
            title: 'More',
            children: <Icons.More size={13} />,
          })}
        </div>
      </div>

      {/* Formatting toolbar removed per design guide — the prototype's editor
          pane has only the tab strip + mode pills above the body, no separate
          toolbar row. In-editor formatting goes through keyboard shortcuts;
          plugin-supplied buttons live in the status bar via PluginSlot. */}

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {showEditor && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
            borderRight: showPreview ? '1px solid var(--line)' : 'none',
          }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Editor
                key={activeNote.path}
                ref={editorRef}
                content={editContent ?? activeNote.content}
                onChange={onContentChange}
                onCursorStateChange={onCursorStateChange}
              />
            </div>
          </div>
        )}
        {showPreview && (
          <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }} ref={previewRef}>
              <Preview
                content={editContent ?? activeNote.content}
                onLinkClick={onLinkClick}
                allNotes={allNotes}
                onCreateNote={onCreateNote}
                notePath={activeNote.path}
                onNoteSelect={onNoteSelect}
                getCodeFenceRenderer={getCodeFenceRenderer}
              />
            </div>
          </div>
        )}
      </div>
      {/* Per prototype/app/editor.jsx, edit & split views have no separate
         backlinks panel — backlinks live inline at the bottom of the
         preview body when rendered in preview mode. */}
    </div>
  );
}
