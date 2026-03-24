import { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string; name: string; role: string };
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
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
