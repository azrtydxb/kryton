import { test } from "node:test";
import assert from "node:assert/strict";
import { SseDecoder } from "../sse.js";

test("SseDecoder: emits message events on blank-line delimiter", () => {
  const d = new SseDecoder();
  const evs = d.push("event: message\ndata: {\"hello\":1}\n\n");
  assert.equal(evs.length, 1);
  assert.equal(evs[0]?.event, "message");
  assert.equal(evs[0]?.data, '{"hello":1}');
});

test("SseDecoder: joins multi-line data with newline", () => {
  const d = new SseDecoder();
  const evs = d.push("data: a\ndata: b\n\n");
  assert.equal(evs.length, 1);
  assert.equal(evs[0]?.data, "a\nb");
});

test("SseDecoder: handles chunks split mid-line", () => {
  const d = new SseDecoder();
  const a = d.push("event: messa");
  const b = d.push("ge\ndata: {\"x\":");
  const c = d.push("42}\n\n");
  assert.equal(a.length, 0);
  assert.equal(b.length, 0);
  assert.equal(c.length, 1);
  assert.equal(c[0]?.event, "message");
  assert.equal(c[0]?.data, '{"x":42}');
});

test("SseDecoder: defaults missing event field to 'message'", () => {
  const d = new SseDecoder();
  const evs = d.push("data: hi\n\n");
  assert.equal(evs[0]?.event, "message");
});

test("SseDecoder: ignores comment lines and unknown fields", () => {
  const d = new SseDecoder();
  const evs = d.push(": ping\nfoo: bar\ndata: ok\n\n");
  assert.equal(evs.length, 1);
  assert.equal(evs[0]?.data, "ok");
});
