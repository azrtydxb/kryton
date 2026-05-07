import { createKrytonClient } from "@azrtydxb/sdk";

/**
 * Singleton typed Kryton API client.
 *
 * Routes prefixed with `/api/*` are forwarded by Vite's dev proxy
 * (see vite.config.ts) and by the same-origin deployment at runtime,
 * so an empty baseUrl works in both environments. Top-level routes
 * (`/version`, `/healthz`, `/readyz`) hit the server directly via
 * the dev origin in development; in production they're served from
 * the same origin as the client.
 */
const baseUrl =
  (import.meta.env.VITE_KRYTON_API_URL as string | undefined) ?? "";

export const krytonClient = createKrytonClient({ baseUrl });
