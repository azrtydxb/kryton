import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHost, uninstallHost } from "../src/install/generic.js";
import { findHost } from "../src/tools.js";
import { hash } from "../src/file-ops.js";
import { parseJsonLoose, parseTomlLoose, parseYamlLoose } from "../src/merge.js";

function withTmp<T>(fn: (dir: string) => Promise<T> | T): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), "krctl-install-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    const r = fn(dir);
    if (r instanceof Promise) {
      return r.finally(cleanup);
    }
    cleanup();
    return r;
  } catch (e) {
    cleanup();
    throw e;
  }
}

test("Claude Code: install writes HTTP entry into .claude.json", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, ".claude.json");
    writeFileSync(cfg, JSON.stringify({ mcpServers: { existing: { type: "http", url: "x" } } }, null, 2));
    const host = findHost("claude-code")!;
    const r = await installHost(host, {
      configPath: cfg,
      transport: "http",
      entryParams: { server: "https://kryton.ai", token: "kryton_abc" },
    });
    assert.equal(r.written, true);
    assert.equal(r.transport, "http");
    assert.ok(r.backupPath && existsSync(r.backupPath));
    const after = parseJsonLoose(readFileSync(cfg, "utf8"));
    const servers = after.mcpServers as Record<string, unknown>;
    assert.ok(servers.existing, "existing entry preserved");
    const k = servers.kryton as { type: string; url: string; headers: Record<string, string> };
    assert.equal(k.type, "http");
    assert.equal(k.url, "https://kryton.ai/api/mcp");
    assert.equal(k.headers.Authorization, "Bearer kryton_abc");
  });
});

test("Claude Desktop: install writes stdio entry into JSON config", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, "claude_desktop_config.json");
    const host = findHost("claude-desktop")!;
    const r = await installHost(host, {
      configPath: cfg,
      transport: "stdio",
      entryParams: { server: "https://kryton.ai", token: "kryton_abc", shimVersion: "0.1.0" },
    });
    assert.equal(r.written, true);
    const after = parseJsonLoose(readFileSync(cfg, "utf8"));
    const k = (after.mcpServers as Record<string, unknown>).kryton as {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    assert.equal(k.command, "npx");
    assert.deepEqual(k.args, ["-y", "@azrtydxb/kryton-mcp@0.1.0"]);
    assert.equal(k.env.KRYTON_URL, "https://kryton.ai");
    assert.equal(k.env.KRYTON_TOKEN, "kryton_abc");
  });
});

test("Codex: TOML config with mcp_servers root key", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, "config.toml");
    writeFileSync(cfg, "[mcp_servers.other]\ncommand = \"x\"\n");
    const host = findHost("codex")!;
    const r = await installHost(host, {
      configPath: cfg,
      transport: "stdio",
      entryParams: { server: "https://kryton.ai", token: "kryton_abc" },
    });
    assert.equal(r.written, true);
    const after = parseTomlLoose(readFileSync(cfg, "utf8"));
    const servers = after.mcp_servers as Record<string, unknown>;
    assert.ok(servers.other);
    assert.ok(servers.kryton);
  });
});

test("OpenCode: JSON with mcp.kryton + environment key + type:local", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, "config.json");
    const host = findHost("opencode")!;
    const r = await installHost(host, {
      configPath: cfg,
      transport: "stdio",
      entryParams: { server: "https://kryton.ai", token: "kryton_abc" },
    });
    assert.equal(r.written, true);
    const after = parseJsonLoose(readFileSync(cfg, "utf8"));
    const k = (after.mcp as Record<string, unknown>).kryton as Record<string, unknown>;
    assert.equal(k.type, "local");
    assert.ok((k as { environment?: unknown }).environment);
    assert.equal((k as { env?: unknown }).env, undefined);
  });
});

test("Continue: YAML round-trip", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, "config.yaml");
    writeFileSync(cfg, "name: dev\n");
    const host = findHost("continue")!;
    const r = await installHost(host, {
      configPath: cfg,
      transport: "stdio",
      entryParams: { server: "https://kryton.ai", token: "kryton_abc" },
    });
    assert.equal(r.written, true);
    const after = parseYamlLoose(readFileSync(cfg, "utf8"));
    assert.equal(after.name, "dev");
    const k = (after.mcpServers as Record<string, unknown>).kryton as Record<string, unknown>;
    assert.equal(k.command, "npx");
  });
});

test("install is idempotent — second run reports alreadyInSync", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, ".claude.json");
    const host = findHost("claude-code")!;
    const params = {
      configPath: cfg,
      transport: "http" as const,
      entryParams: { server: "https://kryton.ai", token: "kryton_abc" },
    };
    await installHost(host, params);
    const second = await installHost(host, params);
    assert.equal(second.alreadyInSync, true);
    assert.equal(second.written, false);
  });
});

test("install replaces a prior case-variant kryton entry", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, ".claude.json");
    writeFileSync(cfg, JSON.stringify({ mcpServers: { Kryton: { type: "http", url: "old" } } }, null, 2));
    const host = findHost("claude-code")!;
    await installHost(host, {
      configPath: cfg,
      transport: "http",
      entryParams: { server: "https://kryton.ai", token: "kryton_abc" },
    });
    const after = parseJsonLoose(readFileSync(cfg, "utf8"));
    const servers = after.mcpServers as Record<string, unknown>;
    assert.equal(servers.Kryton, undefined, "old case-variant removed");
    assert.ok(servers.kryton, "new lowercase entry present");
  });
});

test("uninstall round-trip: removes the kryton key, keeps siblings", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, ".claude.json");
    writeFileSync(cfg, JSON.stringify({ mcpServers: { keep: { type: "http", url: "x" } } }, null, 2));
    const host = findHost("claude-code")!;
    const installed = await installHost(host, {
      configPath: cfg,
      transport: "http",
      entryParams: { server: "https://kryton.ai", token: "kryton_abc" },
    });
    const r = await uninstallHost(host, { configPath: cfg, expectedHash: installed.postHash });
    assert.equal(r.written, true);
    const after = parseJsonLoose(readFileSync(cfg, "utf8"));
    const servers = after.mcpServers as Record<string, unknown>;
    assert.ok(servers.keep);
    assert.equal(servers.kryton, undefined);
  });
});

test("uninstall refuses on hash mismatch unless force", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, ".claude.json");
    const host = findHost("claude-code")!;
    const installed = await installHost(host, {
      configPath: cfg,
      transport: "http",
      entryParams: { server: "https://kryton.ai", token: "kryton_abc" },
    });
    // User edits the file out-of-band.
    const cur = JSON.parse(readFileSync(cfg, "utf8")) as Record<string, unknown>;
    (cur as { extra?: unknown }).extra = 1;
    writeFileSync(cfg, JSON.stringify(cur, null, 2));

    const r = await uninstallHost(host, { configPath: cfg, expectedHash: installed.postHash });
    assert.equal(r.refusedUserEdited, true);
    assert.equal(r.written, false);

    const r2 = await uninstallHost(host, { configPath: cfg, expectedHash: installed.postHash, force: true });
    assert.equal(r2.written, true);
    const after = parseJsonLoose(readFileSync(cfg, "utf8"));
    assert.equal((after.mcpServers as Record<string, unknown>).kryton, undefined);
    assert.equal((after as Record<string, unknown>).extra, 1, "user edit preserved");
  });
});

test("dry-run never touches disk", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, ".claude.json");
    writeFileSync(cfg, "{}");
    const before = await hash(cfg);
    const host = findHost("claude-code")!;
    const r = await installHost(host, {
      configPath: cfg,
      transport: "http",
      entryParams: { server: "https://kryton.ai", token: "kryton_abc" },
      dryRun: true,
    });
    assert.equal(r.written, false);
    assert.equal(r.dryRun, true);
    const after = await hash(cfg);
    assert.equal(before, after);
  });
});

test("backup is created on overwrite, prior backups are swept", async () => {
  await withTmp(async (dir) => {
    const cfg = join(dir, ".claude.json");
    writeFileSync(cfg, JSON.stringify({ a: 1 }));
    const host = findHost("claude-code")!;
    // First install → 1 backup
    await installHost(host, {
      configPath: cfg,
      transport: "http",
      entryParams: { server: "https://kryton.ai", token: "kryton_a" },
    });
    // Change params to force a second write.
    await installHost(host, {
      configPath: cfg,
      transport: "http",
      entryParams: { server: "https://kryton.ai", token: "kryton_b" },
    });
    const baks = readdirSync(dir).filter((f) => f.includes(".kryton-init.bak."));
    assert.equal(baks.length, 1, "only the most recent backup is kept");
  });
});

test("Cline: configPath returns null when no extension dir matches", async () => {
  await withTmp(async (dir) => {
    // Empty ~/.vscode/extensions; cline configPath should be null.
    mkdirSync(join(dir, ".vscode", "extensions"), { recursive: true });
    const host = findHost("cline")!;
    const p = host.configPath({ home: dir, platform: "linux" });
    assert.equal(p, null);
  });
});

test("Cline: configPath resolves when extension dir is present", async () => {
  await withTmp(async (dir) => {
    mkdirSync(join(dir, ".vscode", "extensions", "saoudrizwan.claude-dev-3.0.0"), { recursive: true });
    const host = findHost("cline")!;
    const p = host.configPath({ home: dir, platform: "linux" });
    assert.ok(p);
    assert.ok(p!.endsWith("/settings/cline_mcp_settings.json"));
  });
});
