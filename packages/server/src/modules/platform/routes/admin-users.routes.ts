import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ValidationError, NotFoundError } from "../../../lib/errors.js";
import { account, session, user } from "../../../db/schema/auth.js";
import { graphEdge, searchIndex } from "../../../db/schema/notes.js";
import { settings } from "../../../db/schema/settings.js";
import { accessRequest, noteShare } from "../../../db/schema/sharing.js";

const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  disabled: z.boolean(),
  createdAt: z.date(),
});

const updateUserSchema = z.object({
  disabled: z.boolean().optional(),
  role: z.enum(["user", "admin"]).optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(72),
});

const okResponseSchema = z.object({ ok: z.boolean() });

const userIdParamsSchema = z.object({ id: z.string() });

/**
 * Admin user management routes — mounted under /api/admin.
 */
export const adminUsersRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/users",
    {
      schema: {
        tags: ["platform"],
        summary: "List all users (admin)",
        response: { 200: z.array(userResponseSchema) },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async () => {
      const users = await app.db.query.user.findMany({
        orderBy: desc(user.createdAt),
        columns: {
          id: true,
          email: true,
          name: true,
          role: true,
          disabled: true,
          createdAt: true,
        },
      });
      return users;
    },
  );

  typed.put(
    "/users/:id",
    {
      schema: {
        tags: ["platform"],
        summary: "Update a user (admin)",
        params: userIdParamsSchema,
        body: updateUserSchema,
        response: { 200: userResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (req) => {
      const currentUser = await app.auth.requireUser(req);
      const userId = req.params.id;

      if (userId === currentUser.id) {
        throw new ValidationError("Cannot modify yourself");
      }

      const existing = await app.db.query.user.findFirst({
        where: eq(user.id, userId),
      });
      if (!existing) {
        throw new NotFoundError("User not found");
      }

      const { disabled, role } = req.body;
      let shouldInvalidateTokens = false;
      const updateData: Record<string, unknown> = {};

      if (typeof disabled === "boolean") {
        if (disabled && !existing.disabled) shouldInvalidateTokens = true;
        updateData.disabled = disabled;
      }

      if (typeof role === "string") {
        if (role !== existing.role) shouldInvalidateTokens = true;
        updateData.role = role;
      }

      if (shouldInvalidateTokens) {
        await app.db.delete(session).where(eq(session.userId, userId));
      }

      const [saved] = await app.db
        .update(user)
        .set(updateData)
        .where(eq(user.id, userId))
        .returning();

      return {
        id: saved.id,
        email: saved.email,
        name: saved.name,
        role: saved.role,
        disabled: saved.disabled,
        createdAt: saved.createdAt,
      };
    },
  );

  typed.delete(
    "/users/:id",
    {
      schema: {
        tags: ["platform"],
        summary: "Delete a user (admin)",
        params: userIdParamsSchema,
        response: { 200: okResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (req) => {
      const currentUser = await app.auth.requireUser(req);
      const userId = req.params.id;

      if (userId === currentUser.id) {
        throw new ValidationError("Cannot delete yourself");
      }

      const existing = await app.db.query.user.findFirst({
        where: eq(user.id, userId),
      });
      if (!existing) {
        throw new NotFoundError("User not found");
      }

      await app.db.delete(searchIndex).where(eq(searchIndex.userId, userId));
      await app.db.delete(graphEdge).where(eq(graphEdge.userId, userId));
      await app.db.delete(settings).where(eq(settings.userId, userId));
      await app.db.delete(noteShare).where(eq(noteShare.ownerUserId, userId));
      await app.db.delete(noteShare).where(eq(noteShare.sharedWithUserId, userId));
      await app.db.delete(accessRequest).where(eq(accessRequest.requesterUserId, userId));
      await app.db.delete(accessRequest).where(eq(accessRequest.ownerUserId, userId));

      await app.db.delete(user).where(eq(user.id, userId));

      return { ok: true };
    },
  );

  typed.post(
    "/users/:id/reset-password",
    {
      schema: {
        tags: ["platform"],
        summary: "Reset a user's password (admin)",
        params: userIdParamsSchema,
        body: resetPasswordSchema,
        response: { 200: okResponseSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireAdmin(req);
      },
    },
    async (req) => {
      const userId = req.params.id;
      const { newPassword } = req.body;

      const existing = await app.db.query.user.findFirst({
        where: eq(user.id, userId),
      });
      if (!existing) {
        throw new NotFoundError("User not found");
      }

      const { hashPassword } = await import("better-auth/crypto");
      const hashedPassword = await hashPassword(newPassword);

      await app.db
        .update(account)
        .set({ password: hashedPassword })
        .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));

      await app.db.delete(session).where(eq(session.userId, userId));

      return { ok: true };
    },
  );
};
