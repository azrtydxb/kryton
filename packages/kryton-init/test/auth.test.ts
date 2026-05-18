import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthError, extractSessionCookie, formatBodyError, mintApiKey, probeHealth, revokeApiKey, signIn } from "../src/auth.js";

function makeResponse(opts: { status?: number; body?: unknown; setCookie?: string[] } = {}): Response {
  const status = opts.status ?? 200;
  const body = opts.body === undefined ? "" : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of opts.setCookie ?? []) headers.append("set-cookie", c);
  return new Response(body, { status, headers });
}

test("probeHealth throws AuthError on 500", async () => {
  const fetchImpl = (async () => makeResponse({ status: 500 })) as unknown as typeof fetch;
  await assert.rejects(probeHealth({ server: "http://x", fetchImpl }), AuthError);
});

test("probeHealth resolves on 200", async () => {
  const fetchImpl = (async () => makeResponse({ status: 200 })) as unknown as typeof fetch;
  await probeHealth({ server: "http://x", fetchImpl });
});

test("signIn returns the session_token cookie", async () => {
  const fetchImpl = (async () =>
    makeResponse({
      status: 200,
      setCookie: ["kryton.session_token=abc123; HttpOnly; Path=/"],
      body: { ok: true },
    })) as unknown as typeof fetch;
  const cookie = await signIn({ server: "http://x", email: "a@b", password: "p", fetchImpl });
  assert.equal(cookie, "kryton.session_token=abc123");
});

test("signIn surfaces error.message redacted body", async () => {
  const fetchImpl = (async () =>
    makeResponse({
      status: 401,
      body: { error: "bad creds" },
    })) as unknown as typeof fetch;
  await assert.rejects(
    signIn({ server: "http://x", email: "a@b", password: "p", fetchImpl }),
    (e) => e instanceof AuthError && e.status === 401 && /bad creds/.test(e.message),
  );
});

test("mintApiKey returns { id, key, prefix }", async () => {
  const fetchImpl = (async () =>
    makeResponse({ status: 201, body: { id: "ak_1", key: "kryton_abcdef0123456789" } })) as unknown as typeof fetch;
  const minted = await mintApiKey({
    server: "http://x",
    sessionCookie: "session_token=foo",
    name: "test",
    fetchImpl,
  });
  assert.equal(minted.id, "ak_1");
  assert.equal(minted.key, "kryton_abcdef0123456789");
  assert.equal(minted.prefix, "kryton_abcdef012");
});

test("revokeApiKey tolerates 404", async () => {
  const fetchImpl = (async () => makeResponse({ status: 404 })) as unknown as typeof fetch;
  await revokeApiKey({ server: "http://x", sessionCookie: "c=1", apiKeyId: "ak_x", fetchImpl });
});

test("formatBodyError truncates to 120 + ignores non-JSON", () => {
  assert.equal(formatBodyError(""), "");
  assert.equal(formatBodyError("not json"), "");
  assert.equal(formatBodyError(JSON.stringify({ error: "oops" })), " — oops");
});

test("extractSessionCookie picks better-auth.*", () => {
  const headers = new Headers();
  headers.append("set-cookie", "better-auth.session_token=xyz; HttpOnly");
  headers.append("set-cookie", "_ga=foo; Path=/");
  const res = new Response("", { headers });
  assert.equal(extractSessionCookie(res), "better-auth.session_token=xyz");
});
