import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq } from "drizzle-orm";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../lib/errors.js";
import { accessRequest, noteShare } from "../../../db/schema/sharing.js";
import { user as userTable } from "../../../db/schema/auth.js";
import {
  createShareBodySchema,
  updateShareBodySchema,
  shareIdParamsSchema,
  shareSchema,
  shareListSchema,
  sharedWithMeListSchema,
  revokeShareResponseSchema,
  createAccessRequestBodySchema,
  updateAccessRequestBodySchema,
  accessRequestIdParamsSchema,
  accessRequestSchema,
  accessRequestListSchema,
  pendingAccessRequestListSchema,
} from "../schemas/share.schemas.js";
import type { ShareService } from "../services/share.service.js";

interface SharesRoutesDeps {
  shareService: ShareService;
}

/**
 * Share routes — mounted at `/api/shares`. All CRUD logic lives in
 * `ShareService` (also exposed as `app.shares`) so the MCP tool
 * executors call the same code path.
 */
export const sharesRoutes = (deps: SharesRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const { shareService } = deps;

    // POST /api/shares — Create a share
    typed.post(
      "/",
      {
        schema: {
          tags: ["collab"],
          summary: "Create a share",
          body: createShareBodySchema,
          response: { 201: shareSchema },
        },
        preHandler: async (req) => {
          const ctx = await app.auth.requireAuth(req);
          app.auth.requireWriteScope(ctx);
        },
      },
      async (req, reply) => {
        const ctx = await app.auth.requireAuth(req);
        const saved = await shareService.create(ctx.user.id, req.body);
        reply.status(201);
        return saved;
      },
    );

    // GET /api/shares — List shares I own
    typed.get(
      "/",
      {
        schema: {
          tags: ["collab"],
          summary: "List shares I own",
          response: { 200: shareListSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        return shareService.listOwned(user.id);
      },
    );

    // GET /api/shares/with-me
    typed.get(
      "/with-me",
      {
        schema: {
          tags: ["collab"],
          summary: "List shares shared with me",
          response: { 200: sharedWithMeListSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        return shareService.getSharedNotesForUser(user.id);
      },
    );

    // PUT /api/shares/:id — Update permission
    typed.put(
      "/:id",
      {
        schema: {
          tags: ["collab"],
          summary: "Update share permission",
          params: shareIdParamsSchema,
          body: updateShareBodySchema,
          response: { 200: shareSchema },
        },
        preHandler: async (req) => {
          const ctx = await app.auth.requireAuth(req);
          app.auth.requireWriteScope(ctx);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        return shareService.updatePermission(
          ctx.user.id,
          req.params.id,
          req.body.permission,
        );
      },
    );

    // DELETE /api/shares/:id
    typed.delete(
      "/:id",
      {
        schema: {
          tags: ["collab"],
          summary: "Revoke a share",
          params: shareIdParamsSchema,
          response: { 200: revokeShareResponseSchema },
        },
        preHandler: async (req) => {
          const ctx = await app.auth.requireAuth(req);
          app.auth.requireWriteScope(ctx);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        await shareService.revoke(ctx.user.id, req.params.id);
        return { message: "Share revoked" };
      },
    );
  };

export const accessRequestsRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // POST /api/access-requests
  typed.post(
    "/",
    {
      schema: {
        tags: ["collab"],
        summary: "Request access to a note",
        body: createAccessRequestBodySchema,
        response: { 200: accessRequestSchema, 201: accessRequestSchema },
      },
      preHandler: async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
      },
    },
    async (req, reply) => {
      const ctx = await app.auth.requireAuth(req);
      const { ownerUserId, notePath } = req.body;

      const ownerUser = await app.db.query.user.findFirst({
        where: eq(userTable.id, ownerUserId),
      });
      if (!ownerUser) throw new ValidationError("Owner user not found");

      const existing = await app.db.query.accessRequest.findFirst({
        where: and(
          eq(accessRequest.requesterUserId, ctx.user.id),
          eq(accessRequest.ownerUserId, ownerUserId),
          eq(accessRequest.notePath, notePath),
        ),
      });
      if (existing) {
        if (existing.status === "denied") {
          const [updated] = await app.db
            .update(accessRequest)
            .set({ status: "pending", updatedAt: new Date() })
            .where(eq(accessRequest.id, existing.id))
            .returning();
          return updated;
        }
        return existing;
      }

      const [saved] = await app.db
        .insert(accessRequest)
        .values({
          requesterUserId: ctx.user.id,
          ownerUserId,
          notePath,
          status: "pending",
        })
        .returning();
      reply.status(201);
      return saved;
    },
  );

  // GET /api/access-requests — list pending requests I need to act on
  typed.get(
    "/",
    {
      schema: {
        tags: ["collab"],
        summary: "List pending access requests I need to act on",
        response: { 200: pendingAccessRequestListSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      const rows = await app.db
        .select({
          id: accessRequest.id,
          requesterUserId: accessRequest.requesterUserId,
          ownerUserId: accessRequest.ownerUserId,
          notePath: accessRequest.notePath,
          status: accessRequest.status,
          createdAt: accessRequest.createdAt,
          updatedAt: accessRequest.updatedAt,
          requester: {
            id: userTable.id,
            name: userTable.name,
            email: userTable.email,
          },
        })
        .from(accessRequest)
        .innerJoin(userTable, eq(userTable.id, accessRequest.requesterUserId))
        .where(
          and(
            eq(accessRequest.ownerUserId, user.id),
            eq(accessRequest.status, "pending"),
          ),
        );
      return rows;
    },
  );

  // GET /api/access-requests/mine
  typed.get(
    "/mine",
    {
      schema: {
        tags: ["collab"],
        summary: "List my outgoing access requests",
        response: { 200: accessRequestListSchema },
      },
      preHandler: async (req) => {
        await app.auth.requireUser(req);
      },
    },
    async (req) => {
      const user = await app.auth.requireUser(req);
      return app.db.query.accessRequest.findMany({
        where: eq(accessRequest.requesterUserId, user.id),
      });
    },
  );

  // PUT /api/access-requests/:id — approve or deny
  typed.put(
    "/:id",
    {
      schema: {
        tags: ["collab"],
        summary: "Approve or deny an access request",
        params: accessRequestIdParamsSchema,
        body: updateAccessRequestBodySchema,
        response: { 200: accessRequestSchema },
      },
      preHandler: async (req) => {
        const ctx = await app.auth.requireAuth(req);
        app.auth.requireWriteScope(ctx);
      },
    },
    async (req) => {
      const ctx = await app.auth.requireAuth(req);
      const { action, permission } = req.body;
      const reqRow = await app.db.query.accessRequest.findFirst({
        where: eq(accessRequest.id, req.params.id),
      });
      if (!reqRow) throw new NotFoundError("Access request not found");
      if (reqRow.ownerUserId !== ctx.user.id) {
        throw new ForbiddenError("Not the owner of the requested note");
      }

      if (action === "approve") {
        if (!permission) {
          throw new ValidationError("permission is required when approving");
        }
        await app.db.insert(noteShare).values({
          ownerUserId: reqRow.ownerUserId,
          path: reqRow.notePath,
          isFolder: false,
          sharedWithUserId: reqRow.requesterUserId,
          permission,
        });
        const [updated] = await app.db
          .update(accessRequest)
          .set({ status: "approved", updatedAt: new Date() })
          .where(eq(accessRequest.id, req.params.id))
          .returning();
        return updated;
      }

      const [updated] = await app.db
        .update(accessRequest)
        .set({ status: "denied", updatedAt: new Date() })
        .where(eq(accessRequest.id, req.params.id))
        .returning();
      return updated;
    },
  );
};
