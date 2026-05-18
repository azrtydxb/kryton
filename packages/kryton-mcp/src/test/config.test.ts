import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";

test("loadConfig: rejects when KRYTON_TOKEN unset", () => {
  const r = loadConfig({});
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.kind, "missing-token");
});

test("loadConfig: rejects token without kryton_ prefix", () => {
  const r = loadConfig({ KRYTON_TOKEN: "nope_abc" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.kind, "invalid-token");
});

test("loadConfig: rejects invalid URL", () => {
  const r = loadConfig({ KRYTON_TOKEN: "kryton_abc", KRYTON_URL: "::not-a-url" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.kind, "invalid-url");
});

test("loadConfig: defaults baseUrl to https://kryton.ai", () => {
  const r = loadConfig({ KRYTON_TOKEN: "kryton_abc" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.config.baseUrl, "https://kryton.ai");
  assert.equal(r.config.token, "kryton_abc");
  assert.equal(r.config.debug, false);
});

test("loadConfig: strips trailing slash and honours KRYTON_DEBUG=1", () => {
  const r = loadConfig({
    KRYTON_TOKEN: "kryton_abc",
    KRYTON_URL: "https://example.test///",
    KRYTON_DEBUG: "1",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.config.baseUrl, "https://example.test");
  assert.equal(r.config.debug, true);
});
