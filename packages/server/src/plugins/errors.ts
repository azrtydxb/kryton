import fp from "fastify-plugin";
import { ZodError } from "zod";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import {
  AppError,
  classifyError,
  ConflictError,
} from "../lib/errors.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * Minimal shape of a `pg` `DatabaseError`. We avoid importing the concrete
 * class to keep this plugin decoupled from the driver package — any error
 * with a string `code` from PostgreSQL will be matched (SQLSTATE codes).
 */
interface PgError {
  code: string;
  detail?: string;
  table?: string;
  constraint?: string;
  column?: string;
}

function isPgError(err: unknown): err is PgError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
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

/**
 * Map a Postgres `DatabaseError` (SQLSTATE) to our `AppError` hierarchy.
 * Returns null when the code isn't a known constraint violation — the
 * caller should fall through to generic error handling.
 *
 * P2025 (Prisma's "record not found") has no Postgres equivalent — Drizzle
 * returns `undefined` / empty arrays for missing rows, so call sites raise
 * `NotFoundError` themselves.
 */
function mapPgError(err: PgError): AppError | null {
  switch (err.code) {
    case "23505": // unique_violation
      return new ConflictError("Resource already exists", {
        constraint: err.constraint,
        detail: err.detail,
      });
    case "23503": // foreign_key_violation
      return new ConflictError("Referenced resource does not exist", {
        constraint: err.constraint,
        detail: err.detail,
      });
    case "22001": // string_data_right_truncation
      return classifyError(
        new Error(err.detail ?? "Value too long for column"),
      );
    default:
      return null;
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

    if (isPgError(err)) {
      const mapped = mapPgError(err);
      if (mapped) {
        reply.status(mapped.statusCode).send(toErrorBody(mapped));
        return;
      }
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
