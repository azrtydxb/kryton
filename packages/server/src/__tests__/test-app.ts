/**
 * Minimal Express app for route-level integration tests.
 * Sets req.user directly via an inject middleware so we don't need
 * a real better-auth session in tests.
 */
import express, { Router, Request, Response, NextFunction } from "express";

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export function createTestApp(
  routerMount: string,
  router: Router,
  user: TestUser,
): express.Express {
  const app = express();
  app.use(express.json());

  // Inject user into req so requireUser() works
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  });

  app.use(routerMount, router);
  return app;
}
