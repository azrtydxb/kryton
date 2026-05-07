/**
 * EditorMeta — bottom rail under the editor surface.
 * (Filename retained as `StatusBar.tsx` to avoid touching unowned imports.)
 *
 * Layout: 28px tall, mono 11px, single row of meta tokens separated by
 * middle dots. Plugin slots `statusbar-left` / `statusbar-right` are
 * rendered by App.tsx (parent), not here — the layout there is preserved.
 */
import { useEffect, useRef, useState } from 'react';

interface StatusBarProps {
  notePath: string | null;
  line: number;
  col: number;
  wordCount: number;
}

function relativeTime(ts: number | null): string {
  if (ts === null) return 'never';
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function fileExt(path: string | null): string {
  if (!path) return '–';
  const dot = path.lastIndexOf('.');
  if (dot === -1) return path;
  return path.slice(dot + 1);
}

const READ_WPM = 160;

export function StatusBar({ notePath, wordCount }: StatusBarProps) {
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const lastWordCount = useRef<number>(wordCount);

  // Treat each wordCount delta as evidence of a save (approximate; the real
  // autosave lives in EditModeView, but we don't have a wire to it from here).
  useEffect(() => {
    if (wordCount !== lastWordCount.current) {
      lastWordCount.current = wordCount;
      setLastSaved(Date.now());
    }
  }, [wordCount]);

  // Reset on note change.
  useEffect(() => {
    lastWordCount.current = wordCount;
    setLastSaved(notePath ? Date.now() : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notePath]);

  // Tick once a minute so the relative timestamp stays fresh.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const readMin = Math.max(1, Math.round(wordCount / READ_WPM));
  const wcDisplay = wordCount.toLocaleString();
  const ext = fileExt(notePath);

  const dot = (
    <span style={{ color: 'var(--fg-4)' }}>·</span>
  );

  return (
    <div
      className="mono"
      style={{
        flex: 1,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--line)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--fg-3)',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      <span>
        wc <span style={{ color: 'var(--fg-1)' }}>{wcDisplay}</span>
      </span>
      {dot}
      <span>
        <span style={{ color: 'var(--fg-1)' }}>{readMin}</span> min
      </span>
      {dot}
      <span>{ext}</span>
      {dot}
      <span>last saved {relativeTime(lastSaved)}</span>
    </div>
  );
}
