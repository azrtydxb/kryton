// packages/core/src/version-check.ts
// Simple semver compatibility check without external dependency.
// Supports ranges of the form: ">=X.Y.Z", "<X.Y.Z", ">=X.Y.Z <A.B.C"

function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function satisfiesConstraint(version: [number, number, number], constraint: string): boolean {
  const c = constraint.trim();
  const geMatch = c.match(/^>=\s*([\d.]+(?:-[\w.]+)?)$/);
  if (geMatch) {
    const b = parseSemver(geMatch[1]);
    return b !== null && compare(version, b) >= 0;
  }
  const gtMatch = c.match(/^>\s*([\d.]+(?:-[\w.]+)?)$/);
  if (gtMatch) {
    const b = parseSemver(gtMatch[1]);
    return b !== null && compare(version, b) > 0;
  }
  const ltMatch = c.match(/^<\s*([\d.]+(?:-[\w.]+)?)$/);
  if (ltMatch) {
    const b = parseSemver(ltMatch[1]);
    return b !== null && compare(version, b) < 0;
  }
  const leMatch = c.match(/^<=\s*([\d.]+(?:-[\w.]+)?)$/);
  if (leMatch) {
    const b = parseSemver(leMatch[1]);
    return b !== null && compare(version, b) <= 0;
  }
  const eqMatch = c.match(/^=?\s*([\d.]+(?:-[\w.]+)?)$/);
  if (eqMatch) {
    const b = parseSemver(eqMatch[1]);
    return b !== null && compare(version, b) === 0;
  }
  return false;
}

/**
 * Check whether `version` satisfies `range`.
 * Supports space-separated conjunctions: ">=4.4.0 <5.0.0"
 */
export function isCompatibleVersion(version: string, range: string): boolean {
  const parsed = parseSemver(version);
  if (!parsed) return false;
  const constraints = range.trim().split(/\s+/);
  return constraints.every(c => satisfiesConstraint(parsed, c));
}
