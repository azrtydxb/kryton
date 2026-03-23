interface StatusBarProps {
  notePath: string | null;
  vimMode: string;
  line: number;
  col: number;
  wordCount: number;
}

function getModeColor(mode: string): string {
  if (mode.includes('INSERT')) return 'text-green-500';
  if (mode.includes('VISUAL')) return 'text-orange-500';
  return 'text-violet-500';
}

export function StatusBar({ notePath, vimMode, line, col, wordCount }: StatusBarProps) {
  return (
    <div className="h-6 flex-shrink-0 flex items-center justify-between px-3 border-t border-gray-700/50 bg-surface-900 text-xs font-mono select-none">
      <div className="text-gray-400 truncate max-w-[40%]">
        {notePath || 'No file'}
      </div>
      <div className={`font-semibold ${getModeColor(vimMode)}`}>
        {vimMode}
      </div>
      <div className="flex items-center gap-3 text-gray-400">
        <span>{line}:{col}</span>
        <span>{wordCount.toLocaleString()} words</span>
      </div>
    </div>
  );
}
