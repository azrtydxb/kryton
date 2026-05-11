import crypto from "crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { NotFoundError } from "../../../lib/errors.js";
import { inviteCode } from "../../../db/schema/sharing.js";

const createInviteSchema = z.object({
  expiresAt: z.string().datetime().optional(),
});

const inviteResponseSchema = z.object({
  id: z.string(),
  code: z.string(),
  createdById: z.string(),
  usedById: z.string().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
});

const okResponseSchema = z.object({ ok: z.boolean() });

const inviteIdParamsSchema = z.object({ id: z.string() });

/**
 * Admin invite-code routes — mounted under /api/admin.
 */
export const adminInvitesRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/invites",
    {
      schema: {
        tags: ["platform"],
        summary: "Create an invite code (admin)",
        body: createInviteSchema,
        response: { 200: inviteResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const code = crypto.randomBytes(4).toString("hex");

      const [saved] = await app.db
        .insert(inviteCode)
        .values({
          code,
          createdById: user.id,
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        })
        .returning();
      return saved;
    },
  );

  typed.get(
    "/invites",
    {
      schema: {
        tags: ["platform"],
        summary: "List invite codes (admin)",
        response: { 200: z.array(inviteResponseSchema) },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async () => {
      const invites = await app.db.query.inviteCode.findMany({
        orderBy: desc(inviteCode.createdAt),
        columns: {
          id: true,
          code: true,
          createdById: true,
          usedById: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      return invites;
    },
  );

  typed.delete(
    "/invites/:id",
    {
      schema: {
        tags: ["platform"],
        summary: "Delete an invite code (admin)",
        params: inviteIdParamsSchema,
        response: { 200: okResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (req) => {
      const inviteId = req.params.id;
      const invite = await app.db.query.inviteCode.findFirst({
        where: eq(inviteCode.id, inviteId),
      });
      if (!invite) {
        throw new NotFoundError("Invite not found");
      }
      await app.db.delete(inviteCode).where(eq(inviteCode.id, inviteId));
      return { ok: true };
    },
  );
};
