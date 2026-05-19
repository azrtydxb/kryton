import type { CSSProperties } from 'react';

export interface PresenceEntry {
  id: string;
  name: string;
  color: string;
  kind: 'user' | 'agent';
}

export interface PresenceStripProps {
  entries: ReadonlyArray<PresenceEntry>;
  /** Optional className for layout wrappers. */
  className?: string;
}

/**
 * Compact horizontal strip of collaborator avatars. Each entry renders
 * a colored circle initialled with the first character of `name`; agent
 * presences carry a small "AI" badge in the corner. Hover surfaces a
 * tooltip with the full name and "(AI)" suffix for agents.
 *
 * Designed for the editor toolbar area; empty list → renders nothing
 * (no placeholder).
 */
export function PresenceStrip({ entries, className }: PresenceStripProps) {
  if (entries.length === 0) return null;
  return (
    <div
      data-presence-strip=""
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
      role="list"
      aria-label="Active collaborators"
    >
      {entries.map((e) => (
        <PresenceAvatar key={e.id} entry={e} />
      ))}
    </div>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed[0]!.toUpperCase();
}

function PresenceAvatar({ entry }: { entry: PresenceEntry }) {
  const title = entry.kind === 'agent' ? `${entry.name} (AI)` : entry.name;
  const avatarStyle: CSSProperties = {
    position: 'relative',
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: entry.color,
    color: '#fff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 11,
    fontWeight: 600,
    boxShadow: '0 0 0 1px var(--bg)',
  };
  return (
    <span
      role="listitem"
      data-presence-id={entry.id}
      data-presence-kind={entry.kind}
      title={title}
      aria-label={title}
      style={avatarStyle}
    >
      {initialOf(entry.name)}
      {entry.kind === 'agent' && (
        <span
          aria-hidden="true"
          data-presence-ai-badge=""
          style={{
            position: 'absolute',
            bottom: -2,
            right: -3,
            background: '#000',
            color: '#fff',
            fontSize: 7,
            lineHeight: 1,
            padding: '1px 3px',
            borderRadius: 3,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          AI
        </span>
      )}
    </span>
  );
}
