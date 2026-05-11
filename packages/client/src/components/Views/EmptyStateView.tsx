/**
 * EmptyStateView — matches design handoff `prototype/app/editor.jsx`
 * EmptyState. A 96×96 accent-soft logo card with the K-glyph + "idle"
 * badge, display heading "Ready when you are.", subtitle, and a
 * shortcut grid below.
 */
import type { CSSProperties } from 'react';
import { Icons } from '../Icons';

const monoFamily = 'var(--font-mono)';

interface Shortcut {
  keys: string[];
  label: string;
}

const cardStyle: CSSProperties = {
  position: 'relative',
  width: 96,
  height: 96,
  borderRadius: 18,
  background: 'var(--accent-soft)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--accent)',
};

export function EmptyStateView() {
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts: Shortcut[] = [
    { keys: [mod, 'N'], label: 'new note' },
    { keys: [mod, 'P'], label: 'quick switcher' },
    { keys: [mod, 'K'], label: 'search' },
    { keys: [mod, 'B'], label: 'toggle sidebar' },
    { keys: [mod, 'G'], label: 'graph view' },
  ];

  return (
    <div
      className="bg-grid"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: 40,
        background: 'var(--bg)',
      }}
    >
      <div style={cardStyle}>
        <Icons.Logo size={56} />
      </div>

      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            color: 'var(--fg)',
            marginBottom: 4,
          }}
        >
          Ready when you are.
        </div>
        <div style={{ color: 'var(--fg-2)', fontSize: 13 }}>
          Open a note from the sidebar, or start a new one.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          columnGap: 14,
          rowGap: 6,
          marginTop: 10,
          fontFamily: monoFamily,
          fontSize: 12,
          color: 'var(--fg-2)',
        }}
      >
        {shortcuts.map((s) => (
          <ShortcutRow key={s.label} keys={s.keys} label={s.label} />
        ))}
      </div>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <>
      <span style={{ textAlign: 'right' }}>
        <span className="kbd">{keys.join('')}</span>
      </span>
      <span>{label}</span>
    </>
  );
}
