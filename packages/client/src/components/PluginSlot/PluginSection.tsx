import React, { useCallback, useState } from 'react';
import {
  getPref,
  setSide,
  moveUp,
  moveDown,
  getAllPrefs,
  type Side,
} from '../../plugins/sidebarPrefs';
import { useUIStore } from '../../stores/uiStore';

interface PluginSectionProps {
  pluginId: string;
  side: Side;
  children: React.ReactNode;
}

/**
 * PluginSection — wrapper for a sidebar-mounted plugin panel.
 *
 * Two visual modes, gated on the global `sidebarEditMode` UI flag:
 *
 *  - **Off (default):** renders the plugin's component bare, with no
 *    chrome at all. Indistinguishable from the no-plugin-features
 *    baseline — this is what the user sees in normal usage.
 *  - **On:** wraps the plugin in a thin outlined card and overlays
 *    three move controls in the top-right corner (move-side, move-up,
 *    move-down). The card brightens on hover so the user can see which
 *    panel they're about to act on.
 */
export function PluginSection({ pluginId, side, children }: PluginSectionProps) {
  const editMode = useUIStore((s) => s.sidebarEditMode);
  const [hovered, setHovered] = useState(false);

  // The move-side button needs the inverse of the current side as a label
  // (current=left → "Move to right sidebar").
  const goingTo: Side = side === 'left' ? 'right' : 'left';
  const moveSideTitle =
    goingTo === 'right' ? 'Move to right sidebar' : 'Move to left sidebar';

  // up/down are disabled at the boundary of the current side's stack.
  const allPrefs = getAllPrefs();
  const sameSide = Object.entries(allPrefs)
    .filter(([, p]) => p.side === side)
    .sort((a, b) => a[1].order - b[1].order);
  const myIdx = sameSide.findIndex(([id]) => id === pluginId);
  const atTop = myIdx <= 0;
  const atBottom = myIdx === -1 || myIdx >= sameSide.length - 1;

  const handleMoveSide = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const cur = getPref(pluginId).side;
      setSide(pluginId, cur === 'left' ? 'right' : 'left');
    },
    [pluginId],
  );

  const handleMoveUp = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      moveUp(pluginId);
    },
    [pluginId],
  );

  const handleMoveDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      moveDown(pluginId);
    },
    [pluginId],
  );

  if (!editMode) {
    // Baseline mode — render the plugin's component bare with no wrapper
    // chrome, matching the pre-feature behaviour exactly.
    return <>{children}</>;
  }

  const cardBorder = hovered ? 'var(--accent)' : 'var(--line)';
  const cardBg = hovered
    ? 'var(--bg-hover, rgba(255,255,255,0.04))'
    : 'transparent';
  const cardShadow = hovered
    ? 'inset 0 0 0 1px var(--accent)'
    : 'none';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        margin: 4,
        padding: 8,
        border: `1px solid ${cardBorder}`,
        borderRadius: 6,
        background: cardBg,
        boxShadow: cardShadow,
        transition: 'border-color 120ms, background 120ms, box-shadow 120ms',
      }}
    >
      {children}
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          display: 'inline-flex',
          gap: 2,
          zIndex: 2,
        }}
      >
        <CardBtn
          title={moveSideTitle}
          onClick={handleMoveSide}
          glyph={goingTo === 'right' ? 'chev-right' : 'chev-left'}
        />
        <CardBtn
          title="Move up"
          onClick={handleMoveUp}
          glyph="chev-up"
          disabled={atTop}
        />
        <CardBtn
          title="Move down"
          onClick={handleMoveDown}
          glyph="chev-down"
          disabled={atBottom}
        />
      </div>
    </div>
  );
}

type Glyph = 'chev-up' | 'chev-down' | 'chev-left' | 'chev-right';

function CardBtn({
  title,
  onClick,
  glyph,
  disabled,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  glyph: Glyph;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      style={{
        width: 14,
        height: 14,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 3,
        background: 'transparent',
        border: 'none',
        color: 'var(--fg-2)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        transition: 'color 120ms, background 120ms',
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.color = 'var(--fg)';
        e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.color = 'var(--fg-2)';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <ChevSvg glyph={glyph} />
    </button>
  );
}

function ChevSvg({ glyph }: { glyph: Glyph }) {
  // 14×14 button, 10×10 glyph centred — matches the visual density of the
  // surrounding HeaderBtn icons (14px lucide-flavoured strokes).
  const points = {
    'chev-right': '6 3 11 8 6 13',
    'chev-left': '10 3 5 8 10 13',
    'chev-up': '3 10 8 5 13 10',
    'chev-down': '3 6 8 11 13 6',
  }[glyph];
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points={points} />
    </svg>
  );
}
