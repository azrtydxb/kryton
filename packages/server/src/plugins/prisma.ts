import fp from "fastify-plugin";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Decorates the Fastify instance with a singleton Prisma client backed by
 * better-sqlite3. Connects on ready, disconnects on close.
 */
export const prismaPlugin = fp(async (app) => {
  const dbPath = process.env.DATABASE_URL?.replace("file:", "") || path.resolve("data/kryton.db");
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter });

  await prisma.$connect();
  app.log.info({ dbPath }, "Prisma connected");

  app.decorate("prisma", prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
    app.log.info("Prisma disconnected");
  });
}, { name: "prisma" });

export type { PrismaClient };
