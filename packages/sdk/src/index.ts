/**
 * Kryton TypeScript SDK.
 *
 * Provides a typed client for the Kryton REST API. Types are generated
 * from the server's OpenAPI snapshot (`packages/server/openapi.snapshot.json`)
 * by `openapi-typescript`. The runtime client wraps `openapi-fetch`, which is
 * a tiny (~3 KB) typed wrapper around `fetch`.
 *
 * Usage:
 *   import { createKrytonClient } from "@azrtydxb/kryton-sdk";
 *   const k = createKrytonClient({ baseUrl: "http://localhost:3001" });
 *   const { data, error } = await k.GET("/api/users/search", {
 *     params: { query: { email: "alice@example.com" } },
 *   });
 *
 * Regenerate the types after a server change:
 *   1. `npm run openapi:dump --workspace=packages/server`
 *   2. `npm run generate --workspace=packages/sdk`
 */
import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths, components } from "./types.gen.js";

export type { paths, components } from "./types.gen.js";

/** Convenience aliases for the most commonly referenced shared shapes. */
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type UserPublicProfile = components["schemas"]["UserPublicProfile"];
export type FileTreeNode = components["schemas"]["FileTreeNode"];
export type NoteDataResponse = components["schemas"]["NoteDataResponse"];
export type Backlink = components["schemas"]["Backlink"];
export type TagWithCount = components["schemas"]["TagWithCount"];

export interface KrytonClientOptions extends Omit<ClientOptions, "baseUrl"> {
  /** Server origin, e.g. "http://localhost:3001". */
  baseUrl: string;
}

export function createKrytonClient(options: KrytonClientOptions) {
  const { baseUrl, ...rest } = options;
  return createClient<paths>({
    baseUrl,
    credentials: "include",
    ...rest,
  });
}

export type KrytonClient = ReturnType<typeof createKrytonClient>;
