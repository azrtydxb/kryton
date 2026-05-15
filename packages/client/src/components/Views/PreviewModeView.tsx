import { MutableRefObject, ComponentType } from 'react';
import { FileNode } from '../../lib/api';
import { Preview } from '../Preview/Preview';
import { EditorTabStrip, ModePills } from '../Editor/Editor';
import { Icons } from '../Icons';
import { usePrefs, type EditorLayout } from '../../stores/prefsStore';

interface PreviewModeViewProps {
  activeNote: { path: string; title: string; content: string; modifiedAt?: string };
  isStarred: boolean;
  allNotes: FileNode[];
  previewRef: MutableRefObject<HTMLDivElement | null>;
  onEdit: () => void;
  onShare: () => void;
  onToggleStar: () => void;
  /** retained for parent API compatibility; not surfaced in the prototype topbar. */
  onPdfExport?: () => void;
  /** retained for parent API compatibility; backlinks live inline at the
     bottom of the preview body, no separate rail. */
  onNoteSelect?: (path: string) => void;
  /** Close a tab by path; routed up to handleTabClose. */
  onTabClose?: (path: string) => void;
  onLinkClick: (name: string) => void;
  onCreateNote: (name: string) => void;
  getCodeFenceRenderer?: (language: string) => { component: ComponentType<{ content: string; notePath: string }> } | undefined;
}

export function PreviewModeView({
  activeNote, isStarred, allNotes, previewRef,
  onEdit, onShare, onToggleStar,
  onLinkClick, onCreateNote, getCodeFenceRenderer, onNoteSelect, onTabClose,
}: PreviewModeViewProps) {
  const setPref = usePrefs((s) => s.setPref);

  // Version history is owned by <NoteHistoryPopover> at app level (anchored
  // to the top-bar History button). Restore + per-version preview live
  // there — this view has no per-note version UI of its own.

  const handleModeChange = (next: EditorLayout) => {
    setPref('layout', next);
    if (next === 'edit' || next === 'split') {
      onEdit();
    }
  };

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
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <EditorTabStrip
            activePath={activeNote.path}
            activeTitle={activeNote.title}
            dirty={false}
            onSelect={(p) => onNoteSelect?.(p)}
            onClose={(p) => onTabClose?.(p)}
          />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0 12px', height: 32,
        }}>
          <ModePills value="preview" onChange={handleModeChange} />
          {headerBtn({
            onClick: onToggleStar,
            title: isStarred ? 'Unstar' : 'Star',
            active: isStarred,
            children: isStarred ? <Icons.StarOn size={13} /> : <Icons.Star size={13} />,
          })}
          {headerBtn({
            onClick: onShare,
            title: 'Share',
            children: <Icons.Share size={13} />,
          })}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }} ref={previewRef}>
          <Preview
            content={activeNote.content}
            onLinkClick={onLinkClick}
            allNotes={allNotes}
            onCreateNote={onCreateNote}
            notePath={activeNote.path}
            modifiedAt={activeNote.modifiedAt}
            onNoteSelect={onNoteSelect}
            getCodeFenceRenderer={getCodeFenceRenderer}
          />
        </div>
      </div>
    </div>
  );
}
