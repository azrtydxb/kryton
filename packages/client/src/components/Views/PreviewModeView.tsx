import { MutableRefObject, ComponentType, useState, useEffect } from 'react';
import { FileNode } from '../../lib/api';
import { api, NoteVersion } from '../../lib/api';
import { Preview } from '../Preview/Preview';
// OutgoingLinksPanel intentionally removed to match design handoff —
// outgoing-link metadata is exposed through EditorMeta's `N outgoing`
// token instead of a dedicated bottom panel.
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
  onRestored?: () => void;
  getCodeFenceRenderer?: (language: string) => { component: ComponentType<{ content: string; notePath: string }> } | undefined;
}

interface VersionPreviewModalProps {
  notePath: string;
  version: NoteVersion;
  allNotes: FileNode[];
  onClose: () => void;
  onRestore: (timestamp: number) => void;
}

function VersionPreviewModal({ notePath, version, allNotes, onClose, onRestore }: VersionPreviewModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getVersion(notePath, version.timestamp)
      .then((data) => {
        if (!cancelled) {
          setContent(data.content);
          setLoading(false);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load version content.');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [notePath, version.timestamp]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 700, maxWidth: '95vw', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-1)', border: '1px solid var(--line)',
          borderRadius: 12, boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--line)',
        }}>
          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-1)' }}>
            version · {new Date(version.timestamp).toLocaleString()}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => onRestore(version.timestamp)}
              className="mono"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 5,
                background: 'var(--accent)', color: 'var(--accent-fg)',
                fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.04em', textTransform: 'uppercase',
              }}
            >
              <Icons.History size={12} /> restore
            </button>
            <button
              onClick={onClose}
              style={{
                width: 28, height: 28, borderRadius: 5,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--fg-3)',
              }}
            >
              <Icons.X size={14} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
          {loading && <p className="mono" style={{ padding: 16, fontSize: 12, color: 'var(--fg-3)' }}>loading…</p>}
          {error && <p className="mono" style={{ padding: 16, fontSize: 12, color: 'var(--accent-danger)' }}>{error}</p>}
          {content !== null && !loading && (
            <Preview
              content={content}
              onLinkClick={() => {}}
              allNotes={allNotes}
              onCreateNote={() => {}}
              notePath={notePath}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function PreviewModeView({
  activeNote, isStarred, allNotes, previewRef,
  onEdit, onShare, onToggleStar,
  onLinkClick, onCreateNote, onRestored, getCodeFenceRenderer, onNoteSelect, onTabClose,
}: PreviewModeViewProps) {
  // Version history lives in <NoteHistoryPopover> at app level (see App.tsx)
  // — it's anchored to the top-bar History button and renders for any view.
  // The version-restore preview modal (VersionPreviewModal) is still owned
  // here because it's a per-note diff overlay, not part of the history list.
  const [previewVersion, setPreviewVersion] = useState<NoteVersion | null>(null);
  const setPref = usePrefs((s) => s.setPref);

  const handleRestore = async (timestamp: number): Promise<void> => {
    try {
      await api.restoreVersion(activeNote.path, timestamp);
      setPreviewVersion(null);
      onRestored?.();
    } catch {
      // Silently fail — user can try again
    }
  };

  // Mode pill change: switching to "edit" or "split" enters edit mode.
  // "preview" keeps the user here.
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
      {/* Tab strip + actions row */}
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
          {/* Star / Share / More — per prototype/app/editor.jsx EditorTabBar */}
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
          {/* "More" placeholder. Version history opens via the top-bar
              History button which renders <NoteHistoryPopover> at app
              level (see App.tsx). */}
          {headerBtn({
            onClick: () => { /* future per-note actions */ },
            title: 'More',
            children: <Icons.More size={13} />,
          })}
        </div>
      </div>

      {/* Body + Backlinks rail */}
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

      {previewVersion && (
        <VersionPreviewModal
          notePath={activeNote.path}
          version={previewVersion}
          allNotes={allNotes}
          onClose={() => setPreviewVersion(null)}
          onRestore={(ts) => {
            setPreviewVersion(null);
            handleRestore(ts);
          }}
        />
      )}
    </div>
  );
}
