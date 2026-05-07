import { z } from "zod";

export const tagListResponseSchema = z.array(
  z.object({
    tag: z.string(),
    count: z.number().int(),
  }),
);

export const notesByTagResponseSchema = z.array(
  z.object({
    path: z.string(),
    title: z.string(),
  }),
);

export const tagParamsSchema = z.object({
  tag: z.string().min(1),
});
