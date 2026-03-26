import { useState } from 'react';
import { Network } from 'lucide-react';
import { GraphView } from './GraphView';
import { GraphData } from '../../lib/api';

interface MobileGraphOverlayProps {
  graphData: GraphData | null;
  loading: boolean;
  activeNotePath: string | null;
  onNoteSelect: (path: string) => void;
  starredPaths?: Set<string>;
}

export function MobileGraphOverlay({
  graphData, loading, activeNotePath, onNoteSelect, starredPaths,
}: MobileGraphOverlayProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`
        md:hidden fixed z-20 transition-all duration-300 ease-in-out
        ${expanded
          ? 'top-14 right-0 w-full h-[50vh] rounded-none'
          : 'top-16 right-2 w-24 h-24 rounded-xl'
        }
        bg-surface-900/95 backdrop-blur-sm border border-gray-700/50 shadow-lg overflow-hidden
      `}
      onClick={() => !expanded && setExpanded(true)}
    >
      {/* Header - only visible when expanded */}
      {expanded && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
          <div className="flex items-center gap-2">
            <Network size={14} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Graph</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="px-2 py-0.5 text-xs rounded bg-gray-700/50 text-gray-400 hover:text-gray-200"
          >
            Minimize
          </button>
        </div>
      )}
      {/* Mini icon overlay when collapsed */}
      {!expanded && (
        <div className="absolute top-1 right-1 z-10">
          <Network size={10} className="text-violet-400/70" />
        </div>
      )}
      <div className={expanded ? 'flex-1 h-[calc(100%-36px)]' : 'w-full h-full'}>
        <GraphView
          graphData={graphData}
          loading={loading}
          activeNotePath={activeNotePath}
          mode={activeNotePath ? 'local' : 'full'}
          onNoteSelect={(path) => { if (expanded) onNoteSelect(path); }}
          starredPaths={starredPaths}
        />
      </div>
    </div>
  );
}
