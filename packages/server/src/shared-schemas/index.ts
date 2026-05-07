/**
 * Shared Zod schemas registered in a global registry.
 *
 * Schemas registered here with an `id` will appear as named entries in
 * `components.schemas` of the generated OpenAPI spec, and any route schema
 * that references one will emit `$ref: "#/components/schemas/<Id>"` rather
 * than inlining the shape. Cleaner, smaller spec; cleaner generated SDKs.
 *
 * Usage in a route:
 *   import { errorResponseSchema } from "../../../shared-schemas/index.js";
 *   typed.get("/foo", {
 *     schema: { response: { 401: errorResponseSchema } }
 *   }, handler);
 */
import { z } from "zod";

export const sharedSchemaRegistry = z.registry<{ id: string }>();

// ── Error envelope ─────────────────────────────────────────────────────
// Matches the shape produced by plugins/errors.ts setErrorHandler.
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().describe("Machine-readable error code, e.g. NOT_FOUND"),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .register(sharedSchemaRegistry, { id: "ErrorResponse" });

// ── User shape (public) ────────────────────────────────────────────────
// What gets returned by identity / admin user endpoints.
export const userSchema = z
  .object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(["user", "admin"]),
    disabled: z.boolean().optional(),
    createdAt: z.union([z.string(), z.date()]).optional(),
  })
  .register(sharedSchemaRegistry, { id: "User" });

// Domain types (FileTreeNode, NoteData, etc.) live with their owning
// module under modules/<m>/schemas/ and register themselves in this
// registry. Keep this file lean — only put truly cross-module shapes
// here (errors, users).

// ── Tag with count ─────────────────────────────────────────────────────
export const tagWithCountSchema = z
  .object({
    tag: z.string(),
    count: z.number().int().nonnegative(),
  })
  .register(sharedSchemaRegistry, { id: "TagWithCount" });

// ── Backlink entry ─────────────────────────────────────────────────────
export const backlinkSchema = z
  .object({
    path: z.string(),
    title: z.string(),
  })
  .register(sharedSchemaRegistry, { id: "Backlink" });

// ── Pagination cursor envelope (used by sync) ──────────────────────────
export const cursorSchema = z
  .object({
    cursor: z.union([z.number(), z.string()]),
  })
  .register(sharedSchemaRegistry, { id: "Cursor" });
