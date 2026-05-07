import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../lib/errors.js";
import {
  syncPullBodySchema,
  syncPullResponseSchema,
  syncPushBodySchema,
  syncPushResponseSchema,
  tier2ParamsSchema,
  tier2QuerySchema,
  tier2ResponseSchema,
} from "../schemas/sync.schemas.js";
import type { SyncService } from "../services/sync.service.js";
import type { EntityOp } from "../services/sync-handlers.service.js";

interface SyncRoutesDeps {
  syncService: SyncService;
}

const SYNC_RESOURCE = { type: "Kryton::Sync", id: "*" };

export const syncRoutes = (deps: SyncRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const { syncService } = deps;

    const enforceSyncAction = async (agentId: string | null): Promise<void> => {
      // Human users (no agentId) bypass policy checks.
      if (!agentId) return;
      const agent = await app.prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent || !agent.policyText) {
        throw new ForbiddenError("no policy attached to agent");
      }
      await app.cedar.enforce({
        policy: agent.policyText,
        principal: { type: "Kryton::Agent", id: agent.id },
        action: 'Kryton::Action::"sync"',
        resource: SYNC_RESOURCE,
      });
    };

    // POST /api/sync/v2/pull
    typed.post(
      "/pull",
      {
        schema: {
          tags: ["collab"],
          summary: "Pull changes since cursor",
          body: syncPullBodySchema,
          response: { 200: syncPullResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        const user = ctx.user;
        await enforceSyncAction(ctx.agentId);
        let cursor: bigint;
        try {
          cursor = BigInt(req.body.cursor);
        } catch {
          throw new ValidationError("Invalid cursor");
        }
        return syncService.pullChanges(user.id, cursor);
      },
    );

    // POST /api/sync/v2/push
    typed.post(
      "/push",
      {
        schema: {
          tags: ["collab"],
          summary: "Push changes",
          body: syncPushBodySchema,
          response: { 200: syncPushResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const ctx = await app.auth.requireAuth(req);
        const user = ctx.user;
        await enforceSyncAction(ctx.agentId);
        return syncService.pushChanges(
          user.id,
          req.body.changes as Record<string, EntityOp[]>,
        );
      },
    );

    // GET /api/sync/v2/tier2/:entityType/:parentId
    typed.get(
      "/tier2/:entityType/:parentId",
      {
        schema: {
          tags: ["collab"],
          summary: "Tier 2 entity fetch",
          params: tier2ParamsSchema,
          querystring: tier2QuerySchema,
          response: { 200: tier2ResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const { entityType, parentId } = req.params;
        const limit = Math.min(req.query.limit ?? 50, 200);

        if (entityType === "history") {
          const rows = await app.prisma.noteRevision.findMany({
            where: { userId: user.id, notePath: parentId },
            orderBy: { createdAt: "desc" },
            take: limit,
          });
          return { entities: rows };
        }

        if (entityType === "access_requests") {
          const rows = await app.prisma.accessRequest.findMany({
            where: { ownerUserId: user.id, notePath: parentId },
            take: limit,
          });
          return { entities: rows };
        }

        if (entityType === "plugin_storage") {
          const rows = await app.prisma.pluginStorage.findMany({
            where: { pluginId: parentId },
            take: limit,
          });
          return { entities: rows };
        }

        throw new NotFoundError(`Unknown entity type: ${entityType}`);
      },
    );
  };
