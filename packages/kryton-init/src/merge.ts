/**
 * Round-trippable parse/edit/serialise across the three host config
 * formats: JSON, TOML, and YAML. Everything else (deep-set, deep-get,
 * the key-case-insensitive "kryton" lookup) is shared.
 */

import * as TOML from "smol-toml";
import YAML from "yaml";

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

/** Deep-set `value` at `path`, creating intermediate objects. */
export function deepSet(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  if (path.length === 0) return;
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]!;
    const next = cur[seg];
    if (!isPlainObject(next)) {
      const replacement: Record<string, unknown> = {};
      cur[seg] = replacement;
      cur = replacement;
    } else {
      cur = next;
    }
  }
  cur[path[path.length - 1]!] = value;
}

/** Get the value at a key path, or undefined if any segment is missing. */
export function deepGet(target: unknown, path: string[]): unknown {
  let cur: unknown = target;
  for (const seg of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Case-insensitive lookup of a key inside an object — returns the
 * *actual* key name in the object if a match exists, else null. Used
 * to scrub any prior `kryton` / `Kryton` / `KRYTON` entry on uninstall.
 */
export function findKeyCI(obj: Record<string, unknown>, key: string): string | null {
  const target = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === target) return k;
  }
  return null;
}

/** Delete a key from an object case-insensitively. Returns true if removed. */
export function deleteKeyCI(obj: Record<string, unknown>, key: string): boolean {
  const k = findKeyCI(obj, key);
  if (k === null) return false;
  delete obj[k];
  return true;
}

// ─── JSON ─────────────────────────────────────────────────────────────

export function parseJsonLoose(raw: string | null | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function stringifyJson(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

// ─── TOML ─────────────────────────────────────────────────────────────

export function parseTomlLoose(raw: string | null | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  try {
    const parsed = TOML.parse(raw);
    return isPlainObject(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function stringifyToml(doc: Record<string, unknown>): string {
  return TOML.stringify(doc) + "\n";
}

// ─── YAML ─────────────────────────────────────────────────────────────

export function parseYamlLoose(raw: string | null | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  try {
    const parsed = YAML.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function stringifyYaml(doc: Record<string, unknown>): string {
  return YAML.stringify(doc);
}

// ─── Format dispatch ──────────────────────────────────────────────────

export type ConfigFormat = "json" | "toml" | "yaml";

export function parseLoose(raw: string | null | undefined, format: ConfigFormat): Record<string, unknown> {
  switch (format) {
    case "json":
      return parseJsonLoose(raw);
    case "toml":
      return parseTomlLoose(raw);
    case "yaml":
      return parseYamlLoose(raw);
  }
}

export function stringify(doc: Record<string, unknown>, format: ConfigFormat): string {
  switch (format) {
    case "json":
      return stringifyJson(doc);
    case "toml":
      return stringifyToml(doc);
    case "yaml":
      return stringifyYaml(doc);
  }
}
