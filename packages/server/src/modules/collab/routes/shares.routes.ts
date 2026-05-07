import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../lib/errors.js";
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

const serializeShare = (s: {
  id: string;
  ownerUserId: string;
  path: string;
  isFolder: boolean;
  sharedWithUserId: string;
  permission: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  cursor: bigint;
}) => ({
  ...s,
  cursor: s.cursor.toString(),
});

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
        const { path, isFolder, sharedWithUserId, permission } = req.body;

        if (sharedWithUserId === ctx.user.id) {
          throw new ValidationError("Cannot share with yourself");
        }

        try {
          const saved = await app.prisma.noteShare.create({
            data: {
              ownerUserId: ctx.user.id,
              path,
              isFolder: isFolder ?? false,
              sharedWithUserId,
              permission,
            },
          });
          reply.status(201);
          return serializeShare(saved);
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            throw new ConflictError("Share already exists");
          }
          throw err;
        }
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
        const shares = await app.prisma.noteShare.findMany({
          where: { ownerUserId: user.id },
        });
        return shares.map(serializeShare);
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
        const share = await app.prisma.noteShare.findUnique({
          where: { id: req.params.id },
        });
        if (!share) throw new NotFoundError("Share not found");
        if (share.ownerUserId !== ctx.user.id) {
          throw new ForbiddenError("Not the owner of this share");
        }
        const updated = await app.prisma.noteShare.update({
          where: { id: req.params.id },
          data: { permission: req.body.permission },
        });
        return serializeShare(updated);
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
        const share = await app.prisma.noteShare.findUnique({
          where: { id: req.params.id },
        });
        if (!share) throw new NotFoundError("Share not found");
        if (share.ownerUserId !== ctx.user.id) {
          throw new ForbiddenError("Not the owner of this share");
        }
        await app.prisma.noteShare.delete({ where: { id: req.params.id } });
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

      const ownerUser = await app.prisma.user.findUnique({ where: { id: ownerUserId } });
      if (!ownerUser) throw new ValidationError("Owner user not found");

      const existing = await app.prisma.accessRequest.findFirst({
        where: { requesterUserId: ctx.user.id, ownerUserId, notePath },
      });
      if (existing) {
        if (existing.status === "denied") {
          return app.prisma.accessRequest.update({
            where: { id: existing.id },
            data: { status: "pending" },
          });
        }
        return existing;
      }

      const saved = await app.prisma.accessRequest.create({
        data: {
          requesterUserId: ctx.user.id,
          ownerUserId,
          notePath,
          status: "pending",
        },
      });
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
      return app.prisma.accessRequest.findMany({
        where: { ownerUserId: user.id, status: "pending" },
        include: {
          requester: { select: { id: true, name: true, email: true } },
        },
      });
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
      return app.prisma.accessRequest.findMany({
        where: { requesterUserId: user.id },
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
      const reqRow = await app.prisma.accessRequest.findUnique({
        where: { id: req.params.id },
      });
      if (!reqRow) throw new NotFoundError("Access request not found");
      if (reqRow.ownerUserId !== ctx.user.id) {
        throw new ForbiddenError("Not the owner of the requested note");
      }

      if (action === "approve") {
        if (!permission) {
          throw new ValidationError("permission is required when approving");
        }
        await app.prisma.noteShare.create({
          data: {
            ownerUserId: reqRow.ownerUserId,
            path: reqRow.notePath,
            isFolder: false,
            sharedWithUserId: reqRow.requesterUserId,
            permission,
          },
        });
        return app.prisma.accessRequest.update({
          where: { id: req.params.id },
          data: { status: "approved" },
        });
      }

      return app.prisma.accessRequest.update({
        where: { id: req.params.id },
        data: { status: "denied" },
      });
    },
  );
};
