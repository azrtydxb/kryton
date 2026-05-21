import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { wellKnownRoutes } from "../routes/well-known.routes.js";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(wellKnownRoutes);
  await app.ready();
  return app;
}

describe(".well-known routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Apple App Site Association
  // ---------------------------------------------------------------------------

  describe("GET /.well-known/apple-app-site-association", () => {
    it("returns 200 with applinks and webcredentials when both env vars are set", async () => {
      process.env.MOBILE_IOS_TEAM_ID = "ABCDE12345";
      process.env.MOBILE_IOS_BUNDLE_ID = "com.kryton.mobile";

      const res = await app.inject({
        method: "GET",
        url: "/.well-known/apple-app-site-association",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");

      const body = JSON.parse(res.body);
      const appId = "ABCDE12345.com.kryton.mobile";

      expect(body.applinks).toBeDefined();
      expect(body.applinks.details[0].appIDs).toContain(appId);
      expect(body.applinks.details[0].components).toEqual([{ "/": "/*" }]);

      expect(body.webcredentials).toBeDefined();
      expect(body.webcredentials.apps).toContain(appId);
    });

    it("returns 404 when MOBILE_IOS_TEAM_ID is missing", async () => {
      delete process.env.MOBILE_IOS_TEAM_ID;
      process.env.MOBILE_IOS_BUNDLE_ID = "com.kryton.mobile";

      const res = await app.inject({
        method: "GET",
        url: "/.well-known/apple-app-site-association",
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when MOBILE_IOS_BUNDLE_ID is missing", async () => {
      process.env.MOBILE_IOS_TEAM_ID = "ABCDE12345";
      delete process.env.MOBILE_IOS_BUNDLE_ID;

      const res = await app.inject({
        method: "GET",
        url: "/.well-known/apple-app-site-association",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Android Asset Links
  // ---------------------------------------------------------------------------

  describe("GET /.well-known/assetlinks.json", () => {
    it("returns 200 with both delegate_permission entries and parsed fingerprints when env vars are set", async () => {
      process.env.MOBILE_ANDROID_PACKAGE = "com.kryton.mobile";
      process.env.MOBILE_ANDROID_SHA256_FINGERPRINTS =
        "AA:BB:CC:DD,EE:FF:00:11";

      const res = await app.inject({
        method: "GET",
        url: "/.well-known/assetlinks.json",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");

      const body = JSON.parse(res.body) as Array<{
        relation: string[];
        target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
      }>;

      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);

      const relations = body.map((e) => e.relation[0]);
      expect(relations).toContain("delegate_permission/common.handle_all_urls");
      expect(relations).toContain("delegate_permission/common.get_login_creds");

      const target = body[0].target;
      expect(target.namespace).toBe("android_app");
      expect(target.package_name).toBe("com.kryton.mobile");
      expect(target.sha256_cert_fingerprints).toEqual(["AA:BB:CC:DD", "EE:FF:00:11"]);
    });

    it("returns 404 when MOBILE_ANDROID_PACKAGE is missing", async () => {
      delete process.env.MOBILE_ANDROID_PACKAGE;
      process.env.MOBILE_ANDROID_SHA256_FINGERPRINTS = "AA:BB:CC:DD";

      const res = await app.inject({
        method: "GET",
        url: "/.well-known/assetlinks.json",
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when MOBILE_ANDROID_SHA256_FINGERPRINTS is missing", async () => {
      process.env.MOBILE_ANDROID_PACKAGE = "com.kryton.mobile";
      delete process.env.MOBILE_ANDROID_SHA256_FINGERPRINTS;

      const res = await app.inject({
        method: "GET",
        url: "/.well-known/assetlinks.json",
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
