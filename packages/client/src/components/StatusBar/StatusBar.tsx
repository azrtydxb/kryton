/**
 * EditorMeta — bottom rail under the editor, per design handoff
 * prototype/app/editor.jsx EditorMeta. (Filename kept as `StatusBar.tsx`
 * to avoid touching unowned imports.)
 *
 * Layout (28px, bg-1, border-top line, mono 11):
 *   <n> outgoing · <n> backlinks · <n> tags  …  <n> words · Ln L, Col C · UTF-8 · Markdown
 */
import type { CSSProperties } from 'react';

interface StatusBarProps {
  notePath: string | null;
  line: number;
  col: number;
  wordCount: number;
  /** Optional link counts surfaced when the parent has them. */
  outgoingCount?: number;
  backlinksCount?: number;
  tagsCount?: number;
  encoding?: string;
}

const dotStyle: CSSProperties = { color: 'var(--fg-4)' };

const railStyle: CSSProperties = {
  flex: 1,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '0 12px',
  background: 'var(--bg-1)',
  borderTop: '1px solid var(--line)',
  fontSize: 11,
  color: 'var(--fg-3)',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

export function StatusBar({
  notePath,
  line,
  col,
  wordCount,
  outgoingCount = 0,
  backlinksCount = 0,
  tagsCount = 0,
  encoding = 'UTF-8',
}: StatusBarProps) {
  if (!notePath) {
    return <div className="mono" style={railStyle} />;
  }

  return (
    <div className="mono" style={railStyle}>
      <span>
        <span style={{ color: 'var(--accent)' }}>{outgoingCount}</span> outgoing
      </span>
      <span style={dotStyle}>·</span>
      <span>
        <span style={{ color: 'var(--accent-2)' }}>{backlinksCount}</span> backlinks
      </span>
      <span style={dotStyle}>·</span>
      <span>{tagsCount} tags</span>
      <div style={{ flex: 1 }} />
      <span>{wordCount.toLocaleString()} words</span>
      <span style={dotStyle}>·</span>
      <span>Ln {line}, Col {col}</span>
      <span style={dotStyle}>·</span>
      <span>{encoding}</span>
      <span style={dotStyle}>·</span>
      <span>Markdown</span>
    </div>
  );
}
