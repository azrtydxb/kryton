import { z } from "zod";

export const yjsParamsSchema = z.object({
  docId: z.string().min(1).max(500),
});

// strict() rejects unknown keys so a client that's still passing
// ?token=… (now unsupported) fails validation loudly instead of being
// silently accepted-but-ignored.
export const yjsQuerySchema = z.object({}).strict();
