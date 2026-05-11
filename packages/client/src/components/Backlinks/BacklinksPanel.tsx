import { useState, useEffect, useCallback } from 'react';
import { api, BacklinkData } from '../../lib/api';
import { Icons } from '../Icons';

interface BacklinksPanelProps {
  notePath: string;
  onNoteSelect: (path: string) => void;
  /** When true, render as the right-hand backlinks rail (~280px wide column).
   * Otherwise renders as a horizontal list block under the editor. */
  rail?: boolean;
}

/**
 * Backlinks rail / list. Tokens-based restyle of the redesign handoff.
 * Uses the existing data hook (`api.getBacklinks`). Style is inline with
 * `var(--…)` tokens — no Tailwind colour utilities, no left-border accents.
 */
export function BacklinksPanel({ notePath, onNoteSelect, rail = false }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<BacklinkData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBacklinks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getBacklinks(notePath);
      setBacklinks(data);
    } catch {
      setBacklinks([]);
    } finally {
      setLoading(false);
    }
  }, [notePath]);

  useEffect(() => {
    void (async () => {
      await fetchBacklinks();
    })();
  }, [fetchBacklinks]);

  const heading = (
    <div
      className="mono"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--fg-3)',
        padding: rail ? '14px 14px 8px' : '10px 16px 6px',
      }}
    >
      <Icons.Link size={10} />
      <span>Backlinks</span>
      <span style={{ color: 'var(--fg-4)' }}>· {backlinks.length}</span>
    </div>
  );

  const list = (
    <div style={{ display: 'flex', flexDirection: 'column', padding: rail ? '0 6px 12px' : '0 8px 10px' }}>
      {loading && (
        <div className="mono" style={{ padding: '8px 10px', fontSize: 11, color: 'var(--fg-4)' }}>
          loading…
        </div>
      )}
      {!loading && backlinks.length === 0 && (
        <div className="mono" style={{ padding: '8px 10px', fontSize: 11, color: 'var(--fg-4)' }}>
          no backlinks
        </div>
      )}
      {!loading &&
        backlinks.map((b) => (
          <button
            key={b.path}
            onClick={() => onNoteSelect(b.path)}
            title={b.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              borderRadius: 5,
              textAlign: 'left',
              background: 'transparent',
              transition: 'background 120ms ease',
              minWidth: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Icons.FileText size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span
              style={{
                fontSize: 13,
                color: 'var(--fg-1)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                maxWidth: rail ? 150 : undefined,
              }}
            >
              {b.title}
            </span>
            <span
              className="mono"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--fg-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                flex: 1,
              }}
            >
              {b.path}
            </span>
          </button>
        ))}
    </div>
  );

  if (rail) {
    return (
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          borderLeft: '1px solid var(--line)',
          background: 'var(--bg)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {heading}
        {list}
      </aside>
    );
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--line)',
        background: 'var(--bg-1)',
      }}
    >
      {heading}
      {list}
    </div>
  );
}
