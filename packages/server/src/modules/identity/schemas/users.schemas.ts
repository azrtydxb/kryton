import { z } from "zod";

export const userSearchQuerySchema = z.object({
  email: z.string().min(1, "email query parameter is required"),
});

export const userPublicProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
