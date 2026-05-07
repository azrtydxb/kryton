import { z } from "zod";
import { sharedSchemaRegistry } from "../../../shared-schemas/index.js";

export const userSearchQuerySchema = z.object({
  email: z.string().min(1, "email query parameter is required"),
});

export const userPublicProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  })
  .register(sharedSchemaRegistry, { id: "UserPublicProfile" });
