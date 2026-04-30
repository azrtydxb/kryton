import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma.js";
import { evaluatePolicy } from "../services/cedar.js";
import type { AuthzResource as CedarResource } from "../services/cedar.js";

export type { CedarResource as AuthzResource };

/**
 * Express middleware factory that enforces a Cedar policy check for agents.
 *
 * Human users (agentId === null) always pass through.
 * Agent requests are evaluated against the agent's stored Cedar policy.
 *
 * @param action      - Cedar action string, e.g. `Kryton::Action::"sync"`
 * @param resourceFn  - Extracts the resource descriptor from the request
 */
export function requirePermission(
  action: string,
  resourceFn: (req: Request) => CedarResource | Promise<CedarResource>,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.auth;

    if (!auth) {
      res.status(401).end();
      return;
    }

    // Human users bypass policy checks
    if (auth.agentId === null) {
      next();
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { id: auth.agentId } });

    if (!agent || !agent.policyText) {
      res.status(403).json({ error: "no policy attached to agent" });
      return;
    }

    const resource = await resourceFn(req);

    const result = await evaluatePolicy(agent.policyText, {
      principal: { type: "Kryton::Agent", id: agent.id },
      action: parseAction(action),
      resource,
    });

    if (!result.allowed) {
      res.status(403).json({ error: "policy denied", reasons: result.reasons });
      return;
    }

    next();
  };
}

/**
 * Parse an action string like `Kryton::Action::"read"` into separate type/id.
 * Falls back gracefully if the string doesn't match the expected format.
 */
function parseAction(action: string): { type: string; id: string } {
  // Match patterns like: Kryton::Action::"read"
  const match = action.match(/^(.+)::"(.+)"$/);
  if (match) {
    return { type: match[1], id: match[2] };
  }
  // Fallback: treat the whole string as the id
  return { type: "Kryton::Action", id: action };
}
