import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import { z } from "zod";

const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

const readyResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.record(z.string(), z.object({ ok: z.boolean(), message: z.string().optional() })),
});

export const healthRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/healthz",
    {
      schema: {
        tags: ["platform"],
        summary: "Liveness probe",
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  typed.get(
    "/readyz",
    {
      schema: {
        tags: ["platform"],
        summary: "Readiness probe",
        response: {
          200: readyResponseSchema,
          503: readyResponseSchema,
        },
      },
    },
    async (_req, reply) => {
      const checks: Record<string, { ok: boolean; message?: string }> = {};

      try {
        await app.db.execute(sql`SELECT 1`);
        checks.database = { ok: true };
      } catch (err) {
        checks.database = { ok: false, message: err instanceof Error ? err.message : "unknown" };
      }

      const allOk = Object.values(checks).every((c) => c.ok);
      const body = {
        status: allOk ? ("ok" as const) : ("degraded" as const),
        checks,
      };

      reply.status(allOk ? 200 : 503);
      return body;
    },
  );
};
