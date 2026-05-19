import React, { useCallback, useState } from 'react';
import {
  getPref,
  setSide,
  reorderWithDisplayOrder,
  type Side,
} from '../../plugins/sidebarPrefs';
import { useUIStore } from '../../stores/uiStore';

interface PluginSectionProps {
  pluginId: string;
  side: Side;
  /** 0-based index of this plugin within the rendered list on `side`. */
  index: number;
  /** total number of plugins rendered on `side`. */
  total: number;
  /**
   * Ordered list of plugin ids currently rendered on this side, in the
   * same order they appear in the DOM. Required for unambiguous swap
   * even when sibling plugins have no explicit pref entry yet.
   */
  orderedIds: readonly string[];
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
export function PluginSection({ pluginId, side, index, total, orderedIds, children }: PluginSectionProps) {
  const editMode = useUIStore((s) => s.sidebarEditMode);
  const [hovered, setHovered] = useState(false);

  // The move-side button needs the inverse of the current side as a label
  // (current=left → "Move to right sidebar").
  const goingTo: Side = side === 'left' ? 'right' : 'left';
  const moveSideTitle =
    goingTo === 'right' ? 'Move to right sidebar' : 'Move to left sidebar';

  // Boundary detection comes from the PluginSlot's rendered list — it has
  // the authoritative ordering. Previously we tried to derive it from
  // getAllPrefs() but plugins that have never been moved aren't in the
  // prefs map at all, so every Move up/down was wrongly disabled.
  const atTop = index <= 0;
  const atBottom = index >= total - 1;

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
      reorderWithDisplayOrder(pluginId, orderedIds, -1, side);
    },
    [pluginId, orderedIds, side],
  );

  const handleMoveDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      reorderWithDisplayOrder(pluginId, orderedIds, +1, side);
    },
    [pluginId, orderedIds, side],
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
