import fp from "fastify-plugin";
import { evaluatePolicy } from "../services/cedar.js";
import type { AuthzResource } from "../services/cedar.js";
import { ForbiddenError } from "../lib/errors.js";

export interface CedarCheckInput {
  policy: string;
  principal: { type: string; id: string };
  action: string; // e.g. `Kryton::Action::"sync"`
  resource: AuthzResource;
  context?: Record<string, unknown>;
}

export interface CedarApi {
  /**
   * Evaluate a Cedar policy. Throws ForbiddenError on deny.
   */
  enforce(input: CedarCheckInput): Promise<void>;
  /**
   * Evaluate a Cedar policy and return the decision (no throw).
   */
  check(input: CedarCheckInput): Promise<{ allowed: boolean; reasons?: string[] }>;
}

declare module "fastify" {
  interface FastifyInstance {
    cedar: CedarApi;
  }
}

function parseAction(action: string): { type: string; id: string } {
  const match = action.match(/^(.+)::"(.+)"$/);
  if (match) return { type: match[1], id: match[2] };
  return { type: "Kryton::Action", id: action };
}

export const cedarPlugin = fp(async (app) => {
  const api: CedarApi = {
    async check({ policy, principal, action, resource, context }) {
      return evaluatePolicy(policy, {
        principal,
        action: parseAction(action),
        resource,
        context,
      });
    },
    async enforce(input) {
      const result = await api.check(input);
      if (!result.allowed) {
        throw new ForbiddenError(
          `Policy denied${result.reasons?.length ? `: ${result.reasons.join("; ")}` : ""}`,
        );
      }
    },
  };
  app.decorate("cedar", api);
}, { name: "cedar" });
