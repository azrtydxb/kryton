import { test } from "node:test";
import assert from "node:assert/strict";
import { findHost, HOSTS, pickTransport } from "../src/tools.js";

test("HOSTS contains the 9 v1 hosts", () => {
  const names = HOSTS.map((h) => h.name).sort();
  assert.deepEqual(names, [
    "claude-code",
    "claude-desktop",
    "cline",
    "codex",
    "continue",
    "cursor",
    "kilocode",
    "opencode",
    "roocode",
  ]);
});

test("findHost works", () => {
  assert.ok(findHost("claude-code"));
  assert.equal(findHost("nope"), undefined);
});

test("pickTransport prefers HTTP when supported", () => {
  const cc = findHost("claude-code")!;
  assert.equal(pickTransport(cc), "http");
  const cd = findHost("claude-desktop")!;
  assert.equal(pickTransport(cd), "stdio");
});

test("Claude Desktop path is platform-dependent", () => {
  const cd = findHost("claude-desktop")!;
  const mac = cd.configPath({ home: "/h", platform: "darwin" });
  const lin = cd.configPath({ home: "/h", platform: "linux" });
  assert.match(mac!, /Library\/Application Support\/Claude\/claude_desktop_config\.json$/);
  assert.match(lin!, /Claude\/claude_desktop_config\.json$/);
});

test("Continue config path is ~/.continue/config.yaml", () => {
  const c = findHost("continue")!;
  assert.equal(c.configPath({ home: "/h", platform: "linux" }), "/h/.continue/config.yaml");
  assert.equal(c.format, "yaml");
});

test("Codex uses TOML with mcp_servers", () => {
  const c = findHost("codex")!;
  assert.equal(c.format, "toml");
  assert.equal(c.rootKey, "mcp_servers");
});

test("OpenCode uses environment + type:local for stdio", () => {
  const o = findHost("opencode")!;
  assert.equal(o.stdioEnvKey, "environment");
  assert.equal(o.stdioTypeField, "local");
  assert.equal(o.rootKey, "mcp");
});
