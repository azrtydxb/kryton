import { ComponentType, useRef, useState, useEffect, useMemo } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import type { RemoteCursorDecoration } from '@azrtydxb/ui';
import { FileNode } from '../../lib/api';
import { Editor, type EditorCursorState, type EditorHandle, EditorTabStrip, ModePills } from '../Editor/Editor';
import { EditorToolbar } from '../Editor/EditorToolbar';
import { PresenceStrip, type PresenceEntry } from '../Editor/PresenceStrip';
import { Preview } from '../Preview/Preview';
// OutgoingLinksPanel intentionally removed to match design handoff: the
// editor surface has only the tab strip + body + EditorMeta (28px). Outgoing
// link metadata is surfaced through EditorMeta's `N outgoing` token.
import { Icons } from '../Icons';
import { usePrefs } from '../../stores/prefsStore';
import { useYjsDocument } from '../../hooks/useYjsDocument';
import { useToastStore } from '../../stores/toastStore';
import { useAuth } from '../../hooks/useAuth';
import { presenceColor } from '../../lib/presenceColor';

type SaveStatus = 'unchanged' | 'unsaved' | 'saving' | 'saved' | 'error';

interface EditModeViewProps {
  activeNote: { path: string; title: string; content: string; tabId?: string };
  editContent: string | null;
  originalContent: string | null;
  isStarred: boolean;
  resolvedTheme: string;
  allNotes: FileNode[];
  previewRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Ref exposed to parent for outline jump and other imperative needs. */
  editorRef?: React.MutableRefObject<EditorHandle | null>;
  getCodeFenceRenderer?: (language: string) => {
    component: ComponentType<{
      content: string;
      notePath: string;
      range?: { startLine: number; endLine: number };
      source?: string;
    }>;
  } | undefined;
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
  /** Close a tab by path. Handles next-focus / clearing the active note. */
  onTabClose?: (path: string) => void;
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
  onLinkClick, onCreateNote, onNoteSelect, onTabClose,
}: EditModeViewProps) {
  const hasChanges = editContent !== originalContent;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('unchanged');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layout = usePrefs((s) => s.layout);

  // Internal editor ref; also forwarded to parent via externalEditorRef.
  const localEditorRef = useRef<EditorHandle | null>(null);
  const editorRef = externalEditorRef ?? localEditorRef;

  // Open a live Y.Doc for this note. Shared notes (tabId starts with
  // "shared:") keep the existing HTTP path — cross-user collab over
  // shared paths is explicitly out of scope per the design doc.
  const isShared = activeNote.tabId?.startsWith('shared:') ?? false;
  const yjsPath = isShared ? null : activeNote.path;
  const { user } = useAuth();
  const identity = useMemo(() => {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name || user.email || 'You',
      color: presenceColor(user.id, 'user'),
    };
  }, [user]);
  const { ytext, awareness, status: yjsStatus, publishCursor } = useYjsDocument(yjsPath, identity);

  // Subscribe to remote awareness updates. y-protocols mutates its internal
  // state Map in place, so useSyncExternalStore returning getStates()
  // directly would see the same reference every tick and never re-render.
  // Drive recomputation off an integer version that ticks on every
  // 'update', then derive a fresh snapshot Map from the live awareness.
  const [awarenessVersion, setAwarenessVersion] = useState(0);
  useEffect(() => {
    if (!awareness) return;
    const onUpdate = () => setAwarenessVersion((v) => v + 1);
    awareness.on('update', onUpdate);
    return () => awareness.off('update', onUpdate);
  }, [awareness]);
  const remoteStates = useMemo(() => {
    if (!awareness) return null;
    // Snapshot into a fresh Map so downstream memos that key on the
    // reference can detect changes; the version bump above guarantees
    // this memo re-runs on every awareness update.
    return new Map(awareness.getStates());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awareness, awarenessVersion]);

  const localClientId = awareness?.clientID ?? -1;
  const remoteCursors = useMemo<ReadonlyArray<RemoteCursorDecoration>>(() => {
    if (!remoteStates) return [];
    const out: RemoteCursorDecoration[] = [];
    for (const [clientId, state] of remoteStates.entries()) {
      if (clientId === localClientId) continue;
      const s = state as { user?: { id?: string; name?: string; color?: string; kind?: 'user' | 'agent' }; cursor?: { anchor?: number; head?: number } };
      const u = s.user;
      if (!u || typeof u.id !== 'string' || typeof u.name !== 'string' || typeof u.color !== 'string') continue;
      const c = s.cursor;
      if (!c || typeof c.anchor !== 'number' || typeof c.head !== 'number') continue;
      out.push({
        id: `${clientId}`,
        anchor: c.anchor,
        head: c.head,
        color: u.color,
        name: u.name,
        kind: u.kind === 'agent' ? 'agent' : 'user',
      });
    }
    return out;
  }, [remoteStates, localClientId]);

  const presenceEntries = useMemo<ReadonlyArray<PresenceEntry>>(() => {
    if (!remoteStates) return [];
    const seen = new Set<string>();
    const out: PresenceEntry[] = [];
    for (const [clientId, state] of remoteStates.entries()) {
      if (clientId === localClientId) continue;
      const s = state as { user?: { id?: string; name?: string; color?: string; kind?: 'user' | 'agent' } };
      const u = s.user;
      if (!u || typeof u.id !== 'string' || typeof u.name !== 'string' || typeof u.color !== 'string') continue;
      // Dedupe by id across multiple clients of the same user.
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      out.push({
        id: u.id,
        name: u.name,
        color: u.color,
        kind: u.kind === 'agent' ? 'agent' : 'user',
      });
    }
    return out;
  }, [remoteStates, localClientId]);

  // Surface a one-shot toast when the live-sync handshake fails so the
  // user knows the editor has fallen back to the HTTP save path. The
  // toast fires once per failure transition, scoped to this note.
  const addToast = useToastStore((s) => s.addToast);
  const lastToastedFailurePath = useRef<string | null>(null);
  useEffect(() => {
    if (yjsStatus === 'failed' && yjsPath && lastToastedFailurePath.current !== yjsPath) {
      lastToastedFailurePath.current = yjsPath;
      addToast('info', 'Live sync unavailable; edits saving normally.');
    } else if (yjsStatus === 'connected' && lastToastedFailurePath.current === yjsPath) {
      lastToastedFailurePath.current = null;
    }
  }, [yjsStatus, yjsPath, addToast]);

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
    void (async () => {
      if (hasChanges) {
        setSaveStatus('unsaved');
        debouncedAutoSave();
      } else if (saveStatus === 'unsaved') {
        setSaveStatus('unchanged');
        debouncedAutoSave.cancel();
      }
    })();
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

  // Suppress unused variable warnings; resolvedTheme and allNotes are used
  // for future theming and wiki-link plugin wiring.
  void resolvedTheme;
  void allNotes;

  const headerBtn = (props: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) => (
    <button
      onClick={props.onClick}
      title={props.title}
      style={{
        width: 30, height: 30, borderRadius: 6,
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
      {/* Tab strip + actions row (single 38px row, shared bottom border) */}
      <div style={{ display: 'flex', alignItems: 'stretch', background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <EditorTabStrip
            activePath={activeNote.tabId ?? activeNote.path}
            activeTitle={activeNote.title}
            dirty={dirty}
            onSelect={(p) => onNoteSelect?.(p)}
            onClose={(p) => onTabClose?.(p)}
          />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 12px 0 4px', height: 38,
        }}>
          {presenceEntries.length > 0 && (
            <PresenceStrip entries={presenceEntries} />
          )}
          <ModePills />
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
          {/* "Discard changes" — cancel the current edit and return to
              preview without saving. Previously labelled "More" with a
              ⋯ icon which gave no hint that the click would lose work. */}
          {headerBtn({
            onClick: onCancel,
            title: 'Discard changes',
            children: <Icons.X size={13} />,
          })}
        </div>
      </div>

      {/* Formatting toolbar — shown only when the editor surface is active
          (edit or split). Pure-preview mode hides it. In-editor formatting
          also goes through keyboard shortcuts; plugin-supplied buttons live
          in the status bar via PluginSlot. */}
      {showEditor && <EditorToolbar editorRef={editorRef} />}

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
                onSelectionChange={yjsStatus === 'connected' ? publishCursor : undefined}
                ytext={yjsStatus === 'connected' ? ytext : null}
                remoteCursors={remoteCursors}
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
