import type { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  constructor(message: string, public statusCode: number, public code?: string) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") { super(message, 404, "NOT_FOUND"); }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input") { super(message, 400, "VALIDATION_ERROR"); }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied") { super(message, 403, "FORBIDDEN"); }
}

export function classifyError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    if (err.message.includes("ENOENT") || err.message.includes("no such file")) {
      return new NotFoundError(err.message);
    }
    if (err.message.includes("Invalid path")) {
      return new ValidationError(err.message);
    }
  }
  return new AppError("Internal server error", 500, "INTERNAL_ERROR");
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const appError = classifyError(err);
  if (appError.statusCode >= 500) {
    console.error("[error]", err);
  }
  res.status(appError.statusCode).json({
    error: appError.message,
    ...(appError.code ? { code: appError.code } : {}),
  });
}
