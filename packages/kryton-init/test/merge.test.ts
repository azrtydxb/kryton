import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deepGet,
  deepSet,
  deleteKeyCI,
  findKeyCI,
  parseJsonLoose,
  parseTomlLoose,
  parseYamlLoose,
  stringifyJson,
  stringifyToml,
  stringifyYaml,
} from "../src/merge.js";

test("deepSet creates intermediate objects", () => {
  const o: Record<string, unknown> = {};
  deepSet(o, ["a", "b", "c"], 42);
  assert.deepEqual(o, { a: { b: { c: 42 } } });
});

test("deepSet replaces non-object intermediates", () => {
  const o: Record<string, unknown> = { a: "scalar" };
  deepSet(o, ["a", "b"], 1);
  assert.deepEqual(o, { a: { b: 1 } });
});

test("deepGet returns undefined on missing segments", () => {
  assert.equal(deepGet({ a: { b: 1 } }, ["a", "c"]), undefined);
  assert.equal(deepGet({ a: { b: 1 } }, ["a", "b"]), 1);
});

test("findKeyCI + deleteKeyCI are case-insensitive", () => {
  const o: Record<string, unknown> = { Kryton: 1, foo: 2 };
  assert.equal(findKeyCI(o, "kryton"), "Kryton");
  assert.ok(deleteKeyCI(o, "KRYTON"));
  assert.deepEqual(o, { foo: 2 });
  assert.equal(deleteKeyCI(o, "missing"), false);
});

test("parse*Loose returns {} for null/empty/invalid", () => {
  assert.deepEqual(parseJsonLoose(null), {});
  assert.deepEqual(parseJsonLoose(""), {});
  assert.deepEqual(parseJsonLoose("not json"), {});
  assert.deepEqual(parseTomlLoose("garbage =="), {});
  // Truly malformed YAML: unterminated flow mapping.
  assert.deepEqual(parseYamlLoose("{not: closed"), {});
});

test("JSON round-trip preserves data", () => {
  const doc = { mcpServers: { kryton: { type: "http", url: "x" } } };
  const out = stringifyJson(doc);
  assert.deepEqual(parseJsonLoose(out), doc);
});

test("TOML round-trip preserves data", () => {
  const doc = { mcp_servers: { kryton: { command: "npx", args: ["-y", "x"] } } };
  const out = stringifyToml(doc);
  assert.deepEqual(parseTomlLoose(out), doc);
});

test("YAML round-trip preserves data", () => {
  const doc = { mcpServers: { kryton: { command: "npx", args: ["-y", "x"] } } };
  const out = stringifyYaml(doc);
  assert.deepEqual(parseYamlLoose(out), doc);
});
