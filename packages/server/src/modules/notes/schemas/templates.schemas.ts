import { z } from "zod";

export const templatesListResponseSchema = z.array(
  z.object({
    name: z.string(),
    path: z.string(),
  }),
);

export const templateContentResponseSchema = z.object({
  name: z.string(),
  content: z.string(),
});

export const templateNameParamsSchema = z.object({
  name: z.string().min(1),
});
