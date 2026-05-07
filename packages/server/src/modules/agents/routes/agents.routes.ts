import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createAgentBodySchema,
  setPolicyBodySchema,
  mintTokenBodySchema,
  agentIdParamsSchema,
  tokenIdParamsSchema,
  agentSchema,
  listAgentsResponseSchema,
  mintTokenResponseSchema,
} from "../schemas/agent.schemas.js";
import type { AgentService } from "../services/agent.service.js";
import { NotFoundError } from "../../../lib/errors.js";

interface AgentsRoutesDeps {
  agentService: AgentService;
}

/**
 * Agent management routes — mounted under `/api/agents`. Session-authenticated
 * (the owner manages their own agents from a browser session).
 */
export const agentsRoutes = (deps: AgentsRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const { agentService } = deps;

    /** POST /api/agents — create a new agent */
    typed.post(
      "/",
      {
        schema: {
          tags: ["agents"],
          summary: "Create a new agent",
          body: createAgentBodySchema,
          response: { 201: agentSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req, reply) => {
        const user = await app.auth.requireUser(req);
        const agent = await agentService.create(user.id, req.body);
        reply.status(201);
        return agent;
      },
    );

    /** GET /api/agents — list agents owned by the current user */
    typed.get(
      "/",
      {
        schema: {
          tags: ["agents"],
          summary: "List agents owned by the current user",
          response: { 200: listAgentsResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req) => {
        const user = await app.auth.requireUser(req);
        const agents = await agentService.list(user.id);
        return { agents };
      },
    );

    /** DELETE /api/agents/:id — delete an agent (and cascade its tokens) */
    typed.delete(
      "/:id",
      {
        schema: {
          tags: ["agents"],
          summary: "Delete an agent",
          params: agentIdParamsSchema,
          response: { 204: z.null() },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req, reply) => {
        const user = await app.auth.requireUser(req);
        const agent = await agentService.findById(req.params.id);
        if (!agent || agent.ownerUserId !== user.id) {
          throw new NotFoundError();
        }
        await agentService.delete(agent.id);
        reply.status(204);
        return null;
      },
    );

    /** POST /api/agents/:id/policies — set/replace the Cedar policy for an agent */
    typed.post(
      "/:id/policies",
      {
        schema: {
          tags: ["agents"],
          summary: "Set or replace the Cedar policy for an agent",
          params: agentIdParamsSchema,
          body: setPolicyBodySchema,
          response: { 204: z.null() },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req, reply) => {
        const user = await app.auth.requireUser(req);
        const agent = await agentService.findById(req.params.id);
        if (!agent || agent.ownerUserId !== user.id) {
          throw new NotFoundError();
        }
        await agentService.setPolicy(agent.id, req.body.policyText);
        reply.status(204);
        return null;
      },
    );

    /** POST /api/agents/:id/tokens — mint a bearer token for an agent */
    typed.post(
      "/:id/tokens",
      {
        schema: {
          tags: ["agents"],
          summary: "Mint a bearer token for an agent",
          params: agentIdParamsSchema,
          body: mintTokenBodySchema,
          response: { 201: mintTokenResponseSchema },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req, reply) => {
        const user = await app.auth.requireUser(req);
        const agent = await agentService.findById(req.params.id);
        if (!agent || agent.ownerUserId !== user.id) {
          throw new NotFoundError();
        }
        const result = await agentService.mintToken(agent.id, req.body);
        reply.status(201);
        return result;
      },
    );

    /** POST /api/agents/tokens/:tokenId/revoke — revoke a specific token */
    typed.post(
      "/tokens/:tokenId/revoke",
      {
        schema: {
          tags: ["agents"],
          summary: "Revoke an agent token",
          params: tokenIdParamsSchema,
          response: { 204: z.null() },
        },
        preHandler: async (req) => {
          await app.auth.requireUser(req);
        },
      },
      async (req, reply) => {
        const user = await app.auth.requireUser(req);
        const tokenRow = await agentService.findTokenById(req.params.tokenId);
        if (!tokenRow) {
          throw new NotFoundError();
        }
        const agent = await agentService.findById(tokenRow.agentId);
        if (!agent || agent.ownerUserId !== user.id) {
          throw new NotFoundError();
        }
        await agentService.revokeToken(tokenRow.id);
        reply.status(204);
        return null;
      },
    );
  };
