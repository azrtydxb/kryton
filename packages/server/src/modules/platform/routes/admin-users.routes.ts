import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ValidationError, NotFoundError } from "../../../lib/errors.js";

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
      const users = await app.prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
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

      const user = await app.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundError("User not found");
      }

      const { disabled, role } = req.body;
      let shouldInvalidateTokens = false;
      const updateData: Record<string, unknown> = {};

      if (typeof disabled === "boolean") {
        if (disabled && !user.disabled) shouldInvalidateTokens = true;
        updateData.disabled = disabled;
      }

      if (typeof role === "string") {
        if (role !== user.role) shouldInvalidateTokens = true;
        updateData.role = role;
      }

      if (shouldInvalidateTokens) {
        await app.prisma.session.deleteMany({ where: { userId } });
      }

      const saved = await app.prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

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

      const user = await app.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundError("User not found");
      }

      await app.prisma.searchIndex.deleteMany({ where: { userId } });
      await app.prisma.graphEdge.deleteMany({ where: { userId } });
      await app.prisma.settings.deleteMany({ where: { userId } });
      await app.prisma.noteShare.deleteMany({ where: { ownerUserId: userId } });
      await app.prisma.noteShare.deleteMany({ where: { sharedWithUserId: userId } });
      await app.prisma.accessRequest.deleteMany({ where: { requesterUserId: userId } });
      await app.prisma.accessRequest.deleteMany({ where: { ownerUserId: userId } });

      await app.prisma.user.delete({ where: { id: userId } });

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

      const user = await app.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundError("User not found");
      }

      const { hashPassword } = await import("better-auth/crypto");
      const hashedPassword = await hashPassword(newPassword);

      await app.prisma.account.updateMany({
        where: { userId, providerId: "credential" },
        data: { password: hashedPassword },
      });

      await app.prisma.session.deleteMany({ where: { userId } });

      return { ok: true };
    },
  );
};
