import path from "node:path";
import fs from "node:fs/promises";

// Hosts that actually serve raw plugin assets — the GitHub REST API and
// the raw content CDN. `github.com` itself was on the previous list, but
// that host serves HTML pages (and redirects to `codeload.github.com`
// for archives), neither of which we want to ingest. HTTPS is also
// required so a man-in-the-middle can't substitute a different payload.
const ALLOWED_DOWNLOAD_HOSTS = ["raw.githubusercontent.com", "api.github.com"];

function validateDownloadUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error(`Download URL must use https: ${parsed.protocol}`);
    }
    if (!ALLOWED_DOWNLOAD_HOSTS.includes(parsed.hostname)) {
      throw new Error(`Download URL hostname not allowed: ${parsed.hostname}`);
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("not allowed") ||
        err.message.includes("must use https"))
    ) {
      throw err;
    }
    throw new Error(`Invalid download URL: ${url}`, { cause: err });
  }
}

const REGISTRY_OWNER = "azrtydxb";
const REGISTRY_REPO = "kryton-plugins";
const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "kryton-app/1.0";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface RegistryPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  minKrytonVersion: string;
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

interface Logger {
  warn: (msg: string, ...args: unknown[]) => void;
}

const fallbackLogger: Logger = {
  warn: (msg: string) => {
     
    console.warn(`[plugin-registry] ${msg}`);
  },
};

export class PluginRegistryService {
  private cache: CacheEntry | null = null;
  private log: Logger;

  constructor(logger?: Logger) {
    this.log = logger ?? fallbackLogger;
  }

  async fetchRegistry(): Promise<RegistryIndex> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.data;
    }

    const url = `${GITHUB_API_BASE}/repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/registry.json`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/vnd.github.v3+json",
        },
        redirect: "error",
      });
    } catch (err) {
      this.log.warn(`Failed to reach GitHub API: ${(err as Error).message}`);
      return this.cache?.data ?? { version: 1, plugins: [] };
    }

    if (response.status === 404) {
      this.log.warn("registry.json not found in repo - returning empty registry");
      const empty: RegistryIndex = { version: 1, plugins: [] };
      this.cache = { data: empty, fetchedAt: now };
      return empty;
    }

    if (!response.ok) {
      this.log.warn(`GitHub API returned ${response.status} - returning cached/empty registry`);
      return this.cache?.data ?? { version: 1, plugins: [] };
    }

    let body: { content?: string; encoding?: string };
    try {
      body = (await response.json()) as { content?: string; encoding?: string };
    } catch (err) {
      this.log.warn(`Failed to parse GitHub API response: ${(err as Error).message}`);
      return this.cache?.data ?? { version: 1, plugins: [] };
    }

    if (!body.content || body.encoding !== "base64") {
      this.log.warn("Unexpected response format from GitHub API");
      return this.cache?.data ?? { version: 1, plugins: [] };
    }

    let parsed: RegistryIndex;
    try {
      const decoded = Buffer.from(body.content, "base64").toString("utf-8");
      parsed = JSON.parse(decoded) as RegistryIndex;
    } catch (err) {
      this.log.warn(`Failed to parse registry.json content: ${(err as Error).message}`);
      return this.cache?.data ?? { version: 1, plugins: [] };
    }

    this.cache = { data: parsed, fetchedAt: now };
    return parsed;
  }

  async downloadPlugin(pluginId: string, targetDir: string): Promise<void> {
    const repoPath = `plugins/${pluginId}`;
    const apiUrl = `${GITHUB_API_BASE}/repos/${REGISTRY_OWNER}/${REGISTRY_REPO}/contents/${repoPath}`;

    const destDir = path.join(targetDir, pluginId);
    await fs.mkdir(destDir, { recursive: true });

    await this.downloadDirRecursive(apiUrl, destDir, repoPath);
  }

  async checkForUpdates(
    installed: Array<{ id: string; version: string }>,
  ): Promise<Array<{ id: string; currentVersion: string; latestVersion: string }>> {
    if (installed.length === 0) return [];

    const registry = await this.fetchRegistry();
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

  private async fetchDirectoryContents(apiUrl: string): Promise<GitHubFileEntry[]> {
    validateDownloadUrl(apiUrl);
    // `redirect: "error"` defeats the redirect-bypass: a malicious
    // download URL that initially points at an allowlisted host but
    // 302s to a non-allowed host would otherwise satisfy
    // validateDownloadUrl yet fetch from the unsafe target. If GitHub
    // ever starts returning redirects for these endpoints we want a
    // loud failure here, not silent escalation.
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/vnd.github.v3+json",
      },
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status} fetching ${apiUrl}`);
    }
    return response.json() as Promise<GitHubFileEntry[]>;
  }

  private async downloadFileBytes(downloadUrl: string): Promise<Buffer> {
    validateDownloadUrl(downloadUrl);
    const response = await fetch(downloadUrl, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`Failed to download file from ${downloadUrl}: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async downloadDirRecursive(
    apiUrl: string,
    destDir: string,
    repoBasePath: string,
  ): Promise<void> {
    const entries = await this.fetchDirectoryContents(apiUrl);
    for (const entry of entries) {
      const relPath = entry.path.startsWith(repoBasePath + "/")
        ? entry.path.slice(repoBasePath.length + 1)
        : entry.name;

      const localPath = path.join(destDir, relPath);

      if (entry.type === "dir") {
        await fs.mkdir(localPath, { recursive: true });
        await this.downloadDirRecursive(entry.url, destDir, repoBasePath);
      } else if (entry.type === "file") {
        if (!entry.download_url) continue;
        if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) continue;
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        const bytes = await this.downloadFileBytes(entry.download_url);
        await fs.writeFile(localPath, bytes);
      }
    }
  }
}

interface GitHubFileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  download_url: string | null;
  url: string;
}
