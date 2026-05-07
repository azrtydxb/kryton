import { MutableRefObject, ComponentType, useState, useEffect, useRef } from 'react';
import { FileNode } from '../../lib/api';
import { api, NoteVersion } from '../../lib/api';
import { Preview } from '../Preview/Preview';
import { OutgoingLinksPanel } from '../OutgoingLinks/OutgoingLinksPanel';
import { BacklinksPanel } from '../Backlinks/BacklinksPanel';
import { EditorTabStrip, ModePills } from '../Editor/Editor';
import { Icons } from '../Icons';
import { usePrefs, type EditorLayout } from '../../stores/prefsStore';

interface PreviewModeViewProps {
  activeNote: { path: string; title: string; content: string };
  isStarred: boolean;
  allNotes: FileNode[];
  previewRef: MutableRefObject<HTMLDivElement | null>;
  onEdit: () => void;
  onShare: () => void;
  onToggleStar: () => void;
  onPdfExport: () => void;
  onNoteSelect: (path: string) => void;
  onLinkClick: (name: string) => void;
  onCreateNote: (name: string) => void;
  onRestored?: () => void;
  getCodeFenceRenderer?: (language: string) => { component: ComponentType<{ content: string; notePath: string }> } | undefined;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
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
  onEdit, onShare, onToggleStar, onPdfExport,
  onNoteSelect, onLinkClick, onCreateNote, onRestored, getCodeFenceRenderer,
}: PreviewModeViewProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<NoteVersion | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);
  const setPref = usePrefs((s) => s.setPref);

  // Load versions when the panel opens
  useEffect(() => {
    if (!historyOpen) return;
    setLoadingVersions(true);
    api.listVersions(activeNote.path)
      .then((data) => setVersions(data.versions))
      .catch(() => setVersions([]))
      .finally(() => setLoadingVersions(false));
  }, [historyOpen, activeNote.path]);

  // Close panel when clicking outside
  useEffect(() => {
    if (!historyOpen) return;
    function handleClick(e: MouseEvent) {
      if (historyPanelRef.current && !historyPanelRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [historyOpen]);

  async function handleRestore(timestamp: number) {
    setRestoring(timestamp);
    try {
      await api.restoreVersion(activeNote.path, timestamp);
      setHistoryOpen(false);
      setPreviewVersion(null);
      onRestored?.();
    } catch {
      // Silently fail — user can try again
    } finally {
      setRestoring(null);
    }
  }

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
          />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0 12px', height: 32,
        }}>
          <ModePills value="preview" onChange={handleModeChange} />
          {headerBtn({
            onClick: onEdit,
            title: 'Edit note (Ctrl+E)',
            children: <Icons.Edit size={13} />,
          })}
          {headerBtn({
            onClick: onShare,
            title: 'Share note',
            children: <Icons.Share size={13} />,
          })}
          {headerBtn({
            onClick: onToggleStar,
            title: isStarred ? 'Unstar' : 'Star',
            active: isStarred,
            children: isStarred ? <Icons.StarOn size={13} /> : <Icons.Star size={13} />,
          })}
          {headerBtn({
            onClick: onPdfExport,
            title: 'Export as PDF',
            children: <Icons.Download size={13} />,
          })}
          <div style={{ position: 'relative' }} ref={historyPanelRef}>
            {headerBtn({
              onClick: () => setHistoryOpen((o) => !o),
              title: 'Version history',
              active: historyOpen,
              children: <Icons.History size={13} />,
            })}
            {historyOpen && (
              <div
                style={{
                  position: 'absolute', right: 0, top: 32, zIndex: 40,
                  width: 280, background: 'var(--bg-1)', border: '1px solid var(--line)',
                  borderRadius: 8, boxShadow: 'var(--shadow-md)', overflow: 'hidden',
                }}
              >
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', borderBottom: '1px solid var(--line)',
                  fontFamily: 'var(--font-mono)', fontSize: 10.5,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'var(--fg-4)',
                }}>
                  <span>// version history</span>
                  <button onClick={() => setHistoryOpen(false)} style={{ color: 'var(--fg-3)' }}>
                    <Icons.X size={12} />
                  </button>
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {loadingVersions && (
                    <p className="mono" style={{ padding: 14, fontSize: 11, color: 'var(--fg-4)', textAlign: 'center' }}>loading…</p>
                  )}
                  {!loadingVersions && versions.length === 0 && (
                    <p className="mono" style={{ padding: 14, fontSize: 11, color: 'var(--fg-4)', textAlign: 'center' }}>no saved versions yet.</p>
                  )}
                  {!loadingVersions && versions.map((v) => (
                    <div
                      key={v.timestamp}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', borderBottom: '1px solid var(--line)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontSize: 12, color: 'var(--fg-1)' }}>{timeAgo(v.timestamp)}</span>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)' }}>
                          {new Date(v.timestamp).toLocaleString()} · {(v.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginLeft: 8 }}>
                        <button
                          onClick={() => setPreviewVersion(v)}
                          title="Preview this version"
                          style={{ width: 22, height: 22, borderRadius: 4, color: 'var(--fg-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--fg-3)'; }}
                        >
                          <Icons.Eye size={12} />
                        </button>
                        <button
                          onClick={() => handleRestore(v.timestamp)}
                          disabled={restoring === v.timestamp}
                          title="Restore this version"
                          style={{
                            width: 22, height: 22, borderRadius: 4, color: 'var(--fg-3)',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            opacity: restoring === v.timestamp ? 0.5 : 1,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--fg-3)'; }}
                        >
                          <Icons.History size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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
            getCodeFenceRenderer={getCodeFenceRenderer}
          />
        </div>
        <BacklinksPanel rail notePath={activeNote.path} onNoteSelect={onNoteSelect} />
      </div>

      <OutgoingLinksPanel content={activeNote.content} allNotes={allNotes} onNoteSelect={onNoteSelect} onCreateNote={onCreateNote} />

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
