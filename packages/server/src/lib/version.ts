import { execSync } from "child_process";
import { readFileSync } from "fs";
import * as path from "path";

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "../../../../package.json"), "utf-8")
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function getCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export const APP_VERSION = getVersion();
export const APP_COMMIT = getCommit();
export const APP_MAJOR_VERSION = parseInt(APP_VERSION.split(".")[0], 10) || 0;
