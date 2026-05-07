import fp from "fastify-plugin";
import { ZodError } from "zod";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { Prisma } from "../generated/prisma/client.js";
import {
  AppError,
  classifyError,
  ConflictError,
  NotFoundError,
} from "../lib/errors.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function toErrorBody(err: AppError): ErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  };
}

function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): AppError {
  switch (err.code) {
    case "P2002":
      return new ConflictError("Resource already exists", { fields: err.meta?.target });
    case "P2025":
      return new NotFoundError();
    default:
      return classifyError(err);
  }
}

/**
 * Unified error handler. Maps ZodError, AppError, and Prisma errors to
 * structured JSON responses. Anything else becomes a 500 with the stack
 * logged but not exposed.
 */
export const errorsPlugin = fp(async (app) => {
  app.setErrorHandler((err, request, reply) => {
    // Fastify-flavoured Zod validation errors (from request schemas)
    if (hasZodFastifySchemaValidationErrors(err)) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.validation,
        },
      });
      return;
    }

    if (err instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: err.issues,
        },
      });
      return;
    }

    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        request.log.error({ err }, err.message);
      }
      reply.status(err.statusCode).send(toErrorBody(err));
      return;
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(err);
      reply.status(mapped.statusCode).send(toErrorBody(mapped));
      return;
    }

    // Fastify rate-limit error
    const errObj = err as { statusCode?: number; message?: string };
    if (errObj.statusCode === 429) {
      reply.status(429).send({
        error: { code: "RATE_LIMITED", message: errObj.message ?? "Too many requests" },
      });
      return;
    }

    // Unknown — log full stack, return opaque message
    request.log.error({ err }, "Unhandled error");
    reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });
}, { name: "errors" });
