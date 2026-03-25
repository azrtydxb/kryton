import path from "path";
import fs from "fs/promises";
import { createLogger } from "../lib/logger.js";

const log = createLogger("plugin-registry");

const ALLOWED_DOWNLOAD_HOSTS = ["github.com", "raw.githubusercontent.com", "api.github.com"];

function validateDownloadUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_DOWNLOAD_HOSTS.includes(parsed.hostname)) {
      throw new Error(`Download URL hostname not allowed: ${parsed.hostname}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("not allowed")) throw err;
    throw new Error(`Invalid download URL: ${url}`, { cause: err });
  }
}

const REGISTRY_OWNER = "piwi3910";
const REGISTRY_REPO = "mnemo-plugins";
const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "mnemo-app/1.0";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface RegistryPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  minMnemoVersion: string;
  tags: string[];
  icon: string;
}

export interface RegistryIndex {
  version: number;
  plugins: RegistryPlugin[];
}

interface CacheEntry {
  data: RegistryIndex;
  fetchedAt: number;
}

let registryCache: CacheEntry | null = null;

export async function fetchRegistry(): Promise<RegistryIndex> {
  const now = Date.now();
  if (registryCache && now - registryCache.fetchedAt < CACHE_TTL_MS) {
    return registryCache.data;
  }

  const url = `${GITHUB_API_BASE}/repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/registry.json`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/vnd.github.v3+json",
      },
    });
  } catch (err) {
    log.warn(`Failed to reach GitHub API: ${(err as Error).message}`);
    return registryCache?.data ?? { version: 1, plugins: [] };
  }

  if (response.status === 404) {
    log.warn("registry.json not found in repo — returning empty registry");
    const empty: RegistryIndex = { version: 1, plugins: [] };
    registryCache = { data: empty, fetchedAt: now };
    return empty;
  }

  if (!response.ok) {
    log.warn(`GitHub API returned ${response.status} — returning cached/empty registry`);
    return registryCache?.data ?? { version: 1, plugins: [] };
  }

  let body: { content?: string; encoding?: string };
  try {
    body = await response.json() as { content?: string; encoding?: string };
  } catch (err) {
    log.warn(`Failed to parse GitHub API response: ${(err as Error).message}`);
    return registryCache?.data ?? { version: 1, plugins: [] };
  }

  if (!body.content || body.encoding !== "base64") {
    log.warn("Unexpected response format from GitHub API");
    return registryCache?.data ?? { version: 1, plugins: [] };
  }

  let parsed: RegistryIndex;
  try {
    const decoded = Buffer.from(body.content, "base64").toString("utf-8");
    parsed = JSON.parse(decoded) as RegistryIndex;
  } catch (err) {
    log.warn(`Failed to parse registry.json content: ${(err as Error).message}`);
    return registryCache?.data ?? { version: 1, plugins: [] };
  }

  registryCache = { data: parsed, fetchedAt: now };
  return parsed;
}

interface GitHubFileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  download_url: string | null;
  url: string;
}

async function fetchDirectoryContents(apiUrl: string): Promise<GitHubFileEntry[]> {
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status} fetching ${apiUrl}`);
  }

  return response.json() as Promise<GitHubFileEntry[]>;
}

async function downloadFileBytes(downloadUrl: string): Promise<Buffer> {
  validateDownloadUrl(downloadUrl);
  const response = await fetch(downloadUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Failed to download file from ${downloadUrl}: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function downloadDirRecursive(
  apiUrl: string,
  destDir: string,
  repoBasePath: string
): Promise<void> {
  const entries = await fetchDirectoryContents(apiUrl);

  for (const entry of entries) {
    // Strip the repo-relative base path prefix to get the local relative path
    const relPath = entry.path.startsWith(repoBasePath + "/")
      ? entry.path.slice(repoBasePath.length + 1)
      : entry.name;

    const localPath = path.join(destDir, relPath);

    if (entry.type === "dir") {
      await fs.mkdir(localPath, { recursive: true });
      await downloadDirRecursive(entry.url, destDir, repoBasePath);
    } else if (entry.type === "file") {
      if (!entry.download_url) continue;
      // Skip TypeScript source files — only download built JS, JSON, etc.
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) continue;
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      const bytes = await downloadFileBytes(entry.download_url);
      await fs.writeFile(localPath, bytes);
    }
  }
}

export async function downloadPlugin(pluginId: string, targetDir: string): Promise<void> {
  const repoPath = `plugins/${pluginId}`;
  const apiUrl = `${GITHUB_API_BASE}/repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/${repoPath}`;

  const destDir = path.join(targetDir, pluginId);
  await fs.mkdir(destDir, { recursive: true });

  await downloadDirRecursive(apiUrl, destDir, repoPath);
}

export async function checkForUpdates(
  installed: Array<{ id: string; version: string }>
): Promise<Array<{ id: string; currentVersion: string; latestVersion: string }>> {
  if (installed.length === 0) return [];

  const registry = await fetchRegistry();
  const registryMap = new Map(registry.plugins.map((p) => [p.id, p.version]));

  const updates: Array<{ id: string; currentVersion: string; latestVersion: string }> = [];
  for (const { id, version } of installed) {
    const latestVersion = registryMap.get(id);
    if (latestVersion && latestVersion !== version) {
      updates.push({ id, currentVersion: version, latestVersion });
    }
  }

  return updates;
}
