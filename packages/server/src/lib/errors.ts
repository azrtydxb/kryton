/**
 * Framework-agnostic application error hierarchy.
 * Mapped to HTTP responses by `plugins/errors.ts`.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

export class AuthError extends AppError {
  constructor(message = "Unauthenticated") {
    super(message, 401, "UNAUTHENTICATED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests") {
    super(message, 429, "RATE_LIMITED");
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error") {
    super(message, 500, "INTERNAL_ERROR");
  }
}

/**
 * Best-effort classifier for unknown errors. Used as a fallback when no
 * specific AppError subtype was thrown.
 */
export function classifyError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    if (err.message.includes("ENOENT") || err.message.includes("no such file")) {
      return new NotFoundError();
    }
    if (err.message.includes("Invalid path")) {
      return new ValidationError("Invalid path");
    }
  }
  return new InternalError();
}
