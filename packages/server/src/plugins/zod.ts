import fp from "fastify-plugin";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";

/**
 * Registers the Zod type provider. Must be registered before any route schemas
 * are defined. Routes can then declare `schema: { body: zSchema, ... }` and
 * receive fully-typed `request.body`, `request.query`, etc.
 */
export const zodPlugin = fp(async (app) => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
}, { name: "zod" });

export type { ZodTypeProvider };
