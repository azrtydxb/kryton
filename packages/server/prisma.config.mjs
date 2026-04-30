import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL") || `file:${path.resolve("data/kryton.db")}`,
  },
});
