import type { FastifyPluginAsync } from "fastify";

/**
 * .well-known routes for mobile platform binding.
 *
 * Both endpoints return 404 when the relevant MOBILE_* env vars are unset,
 * so self-hosted Kryton servers without a mobile app don't expose empty or
 * misleading metadata.
 *
 * iOS Universal Links + WebAuthn passkey RP allowlist:
 *   MOBILE_IOS_TEAM_ID   — Apple Developer Team ID (e.g. ABCDE12345)
 *   MOBILE_IOS_BUNDLE_ID — App bundle ID (e.g. com.kryton.mobile)
 *
 * Android App Links + Digital Asset Links credentials:
 *   MOBILE_ANDROID_PACKAGE              — Android package name
 *   MOBILE_ANDROID_SHA256_FINGERPRINTS  — Comma-separated SHA-256 cert fingerprints
 */
export const wellKnownRoutes: FastifyPluginAsync = async (app) => {
  app.get("/.well-known/apple-app-site-association", async (_req, reply) => {
    const teamId = process.env.MOBILE_IOS_TEAM_ID;
    const bundleId = process.env.MOBILE_IOS_BUNDLE_ID;
    if (!teamId || !bundleId) return reply.code(404).send();
    const appId = `${teamId}.${bundleId}`;
    reply
      .header("Content-Type", "application/json")
      .header("Cache-Control", "public, max-age=3600")
      .send({
        applinks: {
          details: [{ appIDs: [appId], components: [{ "/": "/*" }] }],
        },
        webcredentials: { apps: [appId] },
      });
  });

  app.get("/.well-known/assetlinks.json", async (_req, reply) => {
    const packageName = process.env.MOBILE_ANDROID_PACKAGE;
    const fingerprintsCsv = process.env.MOBILE_ANDROID_SHA256_FINGERPRINTS;
    if (!packageName || !fingerprintsCsv) return reply.code(404).send();
    const fingerprints = fingerprintsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const target = {
      namespace: "android_app",
      package_name: packageName,
      sha256_cert_fingerprints: fingerprints,
    };
    reply
      .header("Content-Type", "application/json")
      .header("Cache-Control", "public, max-age=3600")
      .send([
        { relation: ["delegate_permission/common.handle_all_urls"], target },
        { relation: ["delegate_permission/common.get_login_creds"], target },
      ]);
  });
};
