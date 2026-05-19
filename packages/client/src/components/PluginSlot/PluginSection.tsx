import React, { useCallback } from 'react';
import { getSide, setSide, type Side } from '../../plugins/sidebarPrefs';

interface PluginSectionProps {
  pluginId: string;
  side: Side;
  children: React.ReactNode;
}

/**
 * PluginSection — wrapper for a sidebar-mounted plugin panel that overlays
 * a small "move to other side" arrow button in the top-right corner.
 *
 * The button uses a chevron glyph: ▶ when the panel currently lives on
 * the left (clicking sends it right), ◀ when on the right. It's always
 * visible but subtle (var(--fg-4)) so it never distracts from the
 * plugin's own header / content; hover brightens it to var(--fg).
 *
 * Layout note: the wrapper is position:relative with no padding so the
 * plugin's existing chrome (CHECKLIST / RECENT headers, etc.) renders
 * exactly as before. The button sits absolutely at 6/6, 24×24, z-index
 * 1 above the panel content. stopPropagation guards against clicks
 * bubbling into header click handlers inside the plugin component.
 */
export function PluginSection({ pluginId, side, children }: PluginSectionProps) {
  const goingTo: Side = side === 'left' ? 'right' : 'left';
  const title =
    goingTo === 'right' ? 'Move to right sidebar' : 'Move to left sidebar';

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      // Re-read at click time in case another instance flipped it.
      const current = getSide(pluginId);
      setSide(pluginId, current === 'left' ? 'right' : 'left');
    },
    [pluginId],
  );

  return (
    <div style={{ position: 'relative' }}>
      {children}
      <button
        type="button"
        onClick={handleClick}
        title={title}
        aria-label={title}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 24,
          height: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          background: 'transparent',
          border: 'none',
          color: 'var(--fg-4)',
          cursor: 'pointer',
          padding: 0,
          zIndex: 1,
          transition: 'color 120ms, background 120ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--fg)';
          e.currentTarget.style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--fg-4)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {goingTo === 'right' ? (
            <polyline points="6 3 11 8 6 13" />
          ) : (
            <polyline points="10 3 5 8 10 13" />
          )}
        </svg>
      </button>
    </div>
  );
}
