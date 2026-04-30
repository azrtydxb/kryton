import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.js";

const dbPath = process.env.DATABASE_URL?.replace("file:", "") ||
  path.resolve("data/kryton.db");

const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });

export const prisma = new PrismaClient({ adapter });
