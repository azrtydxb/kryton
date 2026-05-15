import { z } from "zod";

export const yjsParamsSchema = z.object({
  docId: z.string().min(1).max(500),
});

export const yjsQuerySchema = z.object({});
