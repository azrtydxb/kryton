import { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { AppError, ForbiddenError } from "../lib/errors.js";
import { validateApiKey } from "../services/apiKeyService.js";
import { prisma } from "../prisma.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string; name: string; role: string };
    apiKey?: { id: string; scope: string };
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Check for bearer token first
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer mnemo_")) {
      const rawKey = authHeader.slice(7); // Remove "Bearer "
      const keyData = await validateApiKey(rawKey);

      if (!keyData) {
        res.status(401).json({ error: "Invalid or expired API key" });
        return;
      }

      // Fetch user to check disabled status
      const user = await prisma.user.findUnique({
        where: { id: keyData.userId },
        select: { id: true, email: true, name: true, role: true, disabled: true },
      });

      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      if (user.disabled) {
        res.status(403).json({ error: "Account is disabled" });
        return;
      }

      req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
      req.apiKey = { id: keyData.keyId, scope: keyData.scope };
      next();
      return;
    }

    // Fall through to session-based auth
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({ error: "Missing or invalid session" });
      return;
    }

    if ((session.user as Record<string, unknown>).disabled) {
      res.status(403).json({ error: "Account is disabled" });
      return;
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: ((session.user as Record<string, unknown>).role as string) || "user",
    };

    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

export function requireUser(req: Request): { id: string; email: string; name: string; role: string } {
  if (!req.user) {
    throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  }
  return req.user;
}

export function requireScope(req: Request, scope: "read-only" | "read-write"): void {
  if (!req.apiKey) return; // Session auth — full access
  if (scope === "read-only") return; // Both scopes satisfy read-only
  if (req.apiKey.scope === "read-write") return; // read-write satisfies read-write
  throw new ForbiddenError("Insufficient API key scope — read-write access required");
}

export function requireSession(req: Request): void {
  if (req.apiKey) {
    throw new ForbiddenError("This endpoint requires browser session authentication");
  }
}

export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
