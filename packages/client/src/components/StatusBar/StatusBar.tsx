import { useEffect, useState } from 'react';

interface StatusBarProps {
  notePath: string | null;
  line: number;
  col: number;
  wordCount: number;
}

interface VersionInfo {
  version: string;
  commit: string;
}

export function StatusBar({ notePath, line, col, wordCount }: StatusBarProps) {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    fetch('/api/version')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.version) {
          setVersionInfo({ version: data.version, commit: data.commit });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-6 flex-shrink-0 flex items-center justify-between px-3 border-t border-gray-700/50 bg-surface-900 text-xs font-mono select-none">
      <div className="text-gray-400 truncate max-w-[40%]">
        {notePath || 'No file'}
      </div>
      <div className="flex items-center gap-3 text-gray-400">
        <span>{line}:{col}</span>
        <span>{wordCount.toLocaleString()} words</span>
        {versionInfo && (
          <span className="text-gray-500">
            v{versionInfo.version} · {versionInfo.commit}
          </span>
        )}
      </div>
    </div>
  );
}
