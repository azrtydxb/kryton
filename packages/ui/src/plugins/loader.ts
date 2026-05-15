import type { PluginManifest, ClientPluginModule, ClientPluginAPI } from "./types";

// ──────────────────────────────────────────────────────────────────────────────
// Manifest validation
// ──────────────────────────────────────────────────────────────────────────────

const REQUIRED_FIELDS: (keyof PluginManifest)[] = [
  "id",
  "name",
  "description",
  "author",
  "version",
  "minKrytonVersion",
];

function validateManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("plugin manifest must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) {
      throw new Error(`plugin manifest missing required field: ${field}`);
    }
  }
  return {
    id: obj.id as string,
    name: obj.name as string,
    description: obj.description as string,
    author: obj.author as string,
    version: obj.version as string,
    minKrytonVersion: obj.minKrytonVersion as string,
    tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : [],
    icon: typeof obj.icon === "string" ? obj.icon : "",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Remote manifest fetch
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetches and validates a plugin manifest from a URL.
 * Throws if the response is not ok or the shape is invalid.
 */
export async function fetchPluginManifest(url: string): Promise<PluginManifest> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`failed to fetch plugin manifest from ${url}: HTTP ${res.status}`);
  }
  const raw: unknown = await res.json();
  return validateManifest(raw);
}

// ──────────────────────────────────────────────────────────────────────────────
// Plugin loading
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Loads a plugin's client JS bundle via dynamic import and calls activate(api).
 *
 * The bundle URL is expected to be an ESM module exporting { activate, deactivate? }.
 * Plugins from kryton-plugins reference `window.__krytonPluginDeps` directly in
 * their bundle — that global must be set on window before this is called (done by
 * PluginRoot).
 *
 * @param manifest - the plugin manifest (id, name, etc.)
 * @param buildApi - factory that produces the ClientPluginAPI for this plugin
 * @param bundleUrl - URL to the compiled plugin JS. If omitted the plugin is
 *   server-only and loadPlugin is a no-op.
 */
export async function loadPlugin(
  manifest: PluginManifest,
  buildApi: (pluginId: string) => ClientPluginAPI,
  bundleUrl?: string
): Promise<ClientPluginModule | null> {
  if (!manifest || !manifest.id || !manifest.id.trim()) {
    throw new Error("cannot load plugin: manifest.id is missing or empty");
  }

  if (!bundleUrl) {
    // Server-only plugin — nothing to load on the client side.
    return null;
  }

  // Dynamic import of the plugin's ESM bundle (Vite/webpack handle /* @vite-ignore */).
  const mod: ClientPluginModule = await import(/* @vite-ignore */ bundleUrl);

  if (typeof mod.activate !== "function") {
    throw new Error(`plugin ${manifest.id} does not export an activate() function`);
  }

  const api = buildApi(manifest.id);
  mod.activate(api);

  return mod;
}
