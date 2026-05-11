/**
 * Top-level version-history popover.
 *
 * Renders fixed to the viewport, anchored just below the header's
 * `[data-header-btn="history-toggle"]` button. Lives at the app root so the
 * popover surfaces regardless of which view is mounted (preview/edit/split/
 * graph/all-notes/tags). Reads `showNoteHistory` + `activeNote` from state;
 * silently no-ops when there's nothing to show.
 *
 * Closes on:
 *  - Escape
 *  - mousedown outside the popover (the History toggle is allow-listed via
 *    [data-header-btn] so the button can still close the popover via its
 *    own click handler without racing this listener).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, NoteVersion } from '../../lib/api';
import { useUIStore } from '../../stores/uiStore';
import { Icons } from '../Icons';

interface NoteHistoryPopoverProps {
  activePath: string | null;
  onRestored?: () => void;
}

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function readAnchor(): AnchorRect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('[data-header-btn="history-toggle"]') as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function NoteHistoryPopover({ activePath, onRestored }: NoteHistoryPopoverProps) {
  const open = useUIStore((s) => s.showNoteHistory);
  const setOpen = useUIStore((s) => s.setShowNoteHistory);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Compute anchor position on open + on viewport resize while open.
  useEffect(() => {
    if (!open) return;
    const onResize = (): void => setAnchor(readAnchor());
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  // Load versions when the panel opens.
  useEffect(() => {
    if (!open || !activePath) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await api.listVersions(activePath);
        if (!cancelled) setVersions(data.versions);
      } catch {
        if (!cancelled) setVersions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activePath]);

  // Outside-click + Esc close. Allow clicks on the header toggle through so
  // its own onClick can close the popover via the store setter.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (target && target.closest('[data-header-btn="history-toggle"]')) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, setOpen]);

  const handleRestore = useCallback(async (ts: number) => {
    if (!activePath) return;
    setRestoring(ts);
    try {
      await api.restoreVersion(activePath, ts);
      setOpen(false);
      onRestored?.();
    } catch (err) {
      // Surface as a console warning — toast layer not wired here.
      console.warn('restore version failed:', err);
    } finally {
      setRestoring(null);
    }
  }, [activePath, onRestored, setOpen]);

  if (!open || !activePath) return null;

  // Default position: 8px below the header button, right-aligned to its right edge.
  const popoverWidth = 320;
  let top = 52;
  let left = window.innerWidth - popoverWidth - 12;
  if (anchor) {
    top = anchor.top + anchor.height + 8;
    left = Math.max(12, anchor.left + anchor.width - popoverWidth);
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Version history"
      style={{
        position: 'fixed',
        top,
        left,
        width: popoverWidth,
        maxHeight: 'min(60vh, 480px)',
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 60,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: '1px solid var(--line)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--fg-3)',
        }}
      >
        <span>// version history</span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close history"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            borderRadius: 3,
            background: 'transparent',
            color: 'var(--fg-3)',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-3)'; }}
        >
          <Icons.X size={11} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
        {loading ? (
          <div style={{ padding: 14, fontSize: 12, color: 'var(--fg-3)' }}>Loading…</div>
        ) : versions.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12, color: 'var(--fg-3)' }}>
            No version history yet for this note.
          </div>
        ) : (
          versions.map((v) => (
            <div
              key={v.timestamp}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 5,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--fg-2)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {new Date(v.timestamp).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
              <button
                onClick={() => handleRestore(v.timestamp)}
                disabled={restoring === v.timestamp}
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  background: 'transparent',
                  color: 'var(--fg-3)',
                  border: '1px solid var(--line)',
                  cursor: restoring === v.timestamp ? 'not-allowed' : 'pointer',
                  opacity: restoring === v.timestamp ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (restoring === v.timestamp) return;
                  e.currentTarget.style.color = 'var(--accent)';
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  if (restoring === v.timestamp) return;
                  e.currentTarget.style.color = 'var(--fg-3)';
                  e.currentTarget.style.borderColor = 'var(--line)';
                }}
              >
                {restoring === v.timestamp ? '…' : 'restore'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
