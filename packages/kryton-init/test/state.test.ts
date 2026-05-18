import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, statePath, STATE_VERSION } from "../src/state.js";

function withTmpHome<T>(fn: (home: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "krctl-state-"));
  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(dir, ".config");
  try {
    return fn(dir);
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("statePath honours XDG_CONFIG_HOME", () => {
  withTmpHome((home) => {
    const p = statePath(home);
    assert.ok(p.endsWith("/kryton-init/state.json"));
  });
});

test("loadState returns null when file is missing", () => {
  withTmpHome((home) => {
    assert.equal(loadState(home), null);
  });
});

test("saveState writes 0600 and roundtrips", () => {
  withTmpHome((home) => {
    const state = {
      version: STATE_VERSION,
      server: "https://kryton.ai",
      apiKeyId: "ak_1",
      apiKeyPrefix: "kryton_aaaaaaaa",
      apiKey: "kryton_aaaaaaaa_secret",
      wiredHosts: [
        { name: "claude-code", path: "/x/.claude.json", transport: "http" as const, preHash: "sha256:abc" },
      ],
      installedAt: new Date().toISOString(),
    };
    const path = saveState(state, home);
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600);
    const raw = readFileSync(path, "utf8");
    assert.ok(raw.includes("kryton_aaaaaaaa"));
    const back = loadState(home);
    assert.ok(back);
    assert.equal(back!.server, "https://kryton.ai");
    assert.equal(back!.wiredHosts.length, 1);
    assert.equal(back!.wiredHosts[0]!.transport, "http");
  });
});

test("loadState ignores malformed wiredHosts entries", () => {
  withTmpHome((home) => {
    saveState(
      {
        version: STATE_VERSION,
        server: "https://kryton.ai",
        apiKeyId: "ak_1",
        apiKeyPrefix: "kryton_aa",
        wiredHosts: [
          // @ts-expect-error testing malformed input
          { name: "x" },
          { name: "ok", path: "/p", transport: "stdio", preHash: "sha256:abc" },
        ],
        installedAt: new Date().toISOString(),
      },
      home,
    );
    const back = loadState(home);
    assert.equal(back?.wiredHosts.length, 1);
    assert.equal(back?.wiredHosts[0]!.name, "ok");
  });
});
