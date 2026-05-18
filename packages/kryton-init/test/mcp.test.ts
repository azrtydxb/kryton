import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntry, buildHttpEntry, buildStdioEntry, SHIM_PACKAGE } from "../src/mcp.js";

test("HTTP entry shape matches the frozen contract", () => {
  const e = buildHttpEntry({ server: "https://kryton.ai/", token: "kryton_abc" });
  assert.deepEqual(e, {
    type: "http",
    url: "https://kryton.ai/api/mcp",
    headers: { Authorization: "Bearer kryton_abc" },
  });
});

test("stdio entry: defaults to env key + omits typeField", () => {
  const e = buildStdioEntry({ server: "https://kryton.ai", token: "kryton_xyz" });
  assert.deepEqual(e, {
    command: "npx",
    args: ["-y", SHIM_PACKAGE],
    env: { KRYTON_URL: "https://kryton.ai", KRYTON_TOKEN: "kryton_xyz" },
  });
});

test("stdio entry: pinned version, OpenCode-style environment + type", () => {
  const e = buildStdioEntry(
    { server: "https://kryton.ai", token: "kryton_xyz", shimVersion: "0.1.0" },
    { envKey: "environment", typeField: "local" },
  );
  assert.deepEqual(e, {
    command: "npx",
    args: ["-y", `${SHIM_PACKAGE}@0.1.0`],
    environment: { KRYTON_URL: "https://kryton.ai", KRYTON_TOKEN: "kryton_xyz" },
    type: "local",
  });
});

test("buildEntry dispatches on transport", () => {
  const http = buildEntry("http", { server: "http://x", token: "t" });
  const stdio = buildEntry("stdio", { server: "http://x", token: "t" });
  assert.equal((http as { type: string }).type, "http");
  assert.equal((stdio as { command: string }).command, "npx");
});
