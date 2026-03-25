/* eslint-disable no-console */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const base = `${timestamp} [${level.toUpperCase()}] [${context}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

export function createLogger(context: string) {
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      if (shouldLog("debug")) console.debug(formatMessage("debug", context, message, meta));
    },
    info(message: string, meta?: Record<string, unknown>) {
      if (shouldLog("info")) console.info(formatMessage("info", context, message, meta));
    },
    warn(message: string, meta?: Record<string, unknown>) {
      if (shouldLog("warn")) console.warn(formatMessage("warn", context, message, meta));
    },
    error(message: string, error?: unknown, meta?: Record<string, unknown>) {
      if (shouldLog("error")) {
        console.error(formatMessage("error", context, message, meta));
        if (error instanceof Error) {
          console.error(error.stack || error.message);
        }
      }
    },
  };
}
