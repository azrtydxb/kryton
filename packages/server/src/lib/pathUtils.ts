import path from "path";

export function validatePathWithinBase(fullPath: string, baseDir: string): void {
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error("Invalid path: outside allowed directory");
  }
}

export function decodePathParam(param: string | string[]): string {
  const raw = Array.isArray(param) ? param.join("/") : param;
  return decodeURIComponent(raw);
}

export function ensureExtension(filePath: string, ext: string): string {
  return filePath.endsWith(ext) ? filePath : `${filePath}${ext}`;
}

export function validatePluginId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid plugin ID: must contain only alphanumeric, dash, or underscore");
  }
}

export const GLOBAL_USER_ID = "__global__";
