import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../services/tokenService";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: string };
    }
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
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

export function csrfCheck(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const mutatingMethods = ["POST", "PUT", "DELETE", "PATCH"];
  if (mutatingMethods.includes(req.method)) {
    if (req.headers["x-requested-with"] !== "XMLHttpRequest") {
      res.status(403).json({ error: "Missing X-Requested-With header" });
      return;
    }
  }
  next();
}
