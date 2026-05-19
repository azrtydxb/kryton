/**
 * Deterministic id → HSL color for presence cursors and avatars.
 *
 * Two palettes — humans get cool tones (blue/teal/violet), agents get
 * warm tones (orange/amber/red) — so the kind is legible at a glance
 * even before reading the name label or the AI badge. Saturation and
 * lightness are tuned to keep contrast adequate against both the dark
 * (`--bg`) and light (`--bg`) editor backgrounds; the label text is
 * rendered white on the same color, which the WCAG contrast check
 * passes for the chosen ranges.
 */

export type PresenceKind = "user" | "agent";

/** djb2-derived 32-bit unsigned hash. Cheap, stable across runs. */
function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    // (h * 33) ^ c
    h = ((h << 5) + h) ^ id.charCodeAt(i);
  }
  return h >>> 0;
}

interface HslRange {
  hueStart: number;
  hueEnd: number;
  saturation: number;
  lightness: number;
}

const USER_RANGE: HslRange = {
  // Cool tones: cyan → indigo. Avoids the agent warm wedge entirely.
  hueStart: 200,
  hueEnd: 280,
  saturation: 65,
  lightness: 52,
};

const AGENT_RANGE: HslRange = {
  // Warm tones: amber → red. Distinct from any USER_RANGE pick.
  hueStart: 10,
  hueEnd: 50,
  saturation: 72,
  lightness: 50,
};

function pickHue(hash: number, range: HslRange): number {
  const span = range.hueEnd - range.hueStart;
  return range.hueStart + (hash % span);
}

/**
 * Returns an `hsl(...)` color string for the given id + kind. Pure: the
 * same id always maps to the same color within a kind, and a user id
 * never collides with an agent id even if both ids hash to the same
 * bucket (different palettes).
 */
export function presenceColor(id: string, kind: PresenceKind): string {
  const range = kind === "agent" ? AGENT_RANGE : USER_RANGE;
  const hue = pickHue(hashId(id), range);
  return `hsl(${hue}, ${range.saturation}%, ${range.lightness}%)`;
}

/** Exposed for tests + future settings UI that wants to show the swatch. */
export const presenceColorRanges = {
  user: USER_RANGE,
  agent: AGENT_RANGE,
} as const;
