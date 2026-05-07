import { useState } from 'react';
import { GraphView } from '@azrtydxb/ui';
import { GraphData } from '../../lib/api';
import { Icons } from '../Icons';

interface MobileGraphOverlayProps {
  graphData: GraphData | null;
  loading: boolean;
  activeNotePath: string | null;
  onNoteSelect: (path: string) => void;
  starredPaths?: Set<string>;
}

export function MobileGraphOverlay({
  graphData,
  loading,
  activeNotePath,
  onNoteSelect,
  starredPaths,
}: MobileGraphOverlayProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      role={expanded ? 'region' : undefined}
      aria-label={expanded ? 'Graph view' : undefined}
      className={`
        md:hidden fixed z-20 transition-all duration-300 ease-in-out overflow-hidden
        ${expanded
          ? 'top-14 right-0 w-full h-[50vh] rounded-none'
          : 'top-16 right-2 w-24 h-24 rounded-lg'
        }
      `}
      style={{
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      {expanded && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 38,
            padding: '0 12px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--bg-1)',
          }}
        >
          <Icons.Network size={14} style={{ color: 'var(--fg-3)' }} />
          <span
            style={{
              fontSize: 12,
              color: 'var(--fg-2)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            graph
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Minimize graph"
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              fontSize: 11.5,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              color: 'var(--fg-2)',
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              cursor: 'pointer',
            }}
          >
            close
          </button>
        </div>
      )}
      {!expanded && (
        <button
          aria-label="Open graph view"
          className="absolute inset-0 w-full h-full z-10"
          onClick={() => setExpanded(true)}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <div className="absolute top-1.5 right-1.5">
            <Icons.Network size={12} style={{ color: 'var(--accent)' }} />
          </div>
        </button>
      )}
      <div
        style={
          expanded
            ? { height: 'calc(100% - 38px)', background: 'var(--bg)' }
            : { width: '100%', height: '100%', background: 'var(--bg)' }
        }
      >
        <GraphView
          graphData={graphData}
          loading={loading}
          activeNotePath={activeNotePath}
          mode={activeNotePath ? 'local' : 'full'}
          onNoteSelect={(path) => {
            if (expanded) onNoteSelect(path);
          }}
          starredPaths={starredPaths}
        />
      </div>
    </div>
  );
}
