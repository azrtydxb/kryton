import type { CSSProperties } from 'react';

const monoFamily = 'var(--font-mono)';

interface Shortcut {
  keys: string[];
  label: string;
}

export function EmptyStateView() {
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts: Shortcut[] = [
    { keys: [mod, 'N'], label: 'new note' },
    { keys: [mod, 'K'], label: 'command palette' },
    { keys: [mod, 'P'], label: 'quick switcher' },
    { keys: [mod, 'G'], label: 'graph' },
    { keys: [mod, 'B'], label: 'toggle sidebar' },
  ];

  const eyebrow: CSSProperties = {
    fontFamily: monoFamily,
    fontSize: 11,
    color: 'var(--fg-4)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 22,
    textAlign: 'center',
  };

  return (
    <div
      className="bg-grid"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={eyebrow}>// no note selected</div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            columnGap: 16,
            rowGap: 10,
            alignItems: 'center',
          }}
        >
          {shortcuts.map((s) => (
            <ShortcutRow key={s.label} keys={s.keys} label={s.label} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {keys.map((k, i) => (
          <span key={i} className="kbd">
            {k}
          </span>
        ))}
      </div>
      <span
        style={{
          fontFamily: monoFamily,
          fontSize: 12,
          color: 'var(--fg-2)',
        }}
      >
        {label}
      </span>
    </>
  );
}
