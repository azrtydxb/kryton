// packages/core/scripts/verify-generated.ts
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateFromString } from "./generate-schema.js";

// Resolve paths relative to monorepo root regardless of cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MONOREPO_ROOT = resolve(__dirname, "../../..");

const prismaPath = resolve(MONOREPO_ROOT, "packages/server/prisma/schema.prisma");
const out = generateFromString(readFileSync(prismaPath, "utf8"));

const checks: [string, string][] = [
  [resolve(MONOREPO_ROOT, "packages/core/src/generated/schema.sql"), out.sql],
  [resolve(MONOREPO_ROOT, "packages/core/src/generated/types.ts"), out.types],
  [resolve(MONOREPO_ROOT, "packages/core/src/generated/entities.ts"), out.entities],
];

let stale = false;
for (const [path, expected] of checks) {
  const actual = readFileSync(path, "utf8");
  if (actual !== expected) {
    console.error(`STALE: ${path}`);
    stale = true;
  }
}

if (stale) {
  console.error("\nRun `npm run generate --workspace=packages/core` and commit.");
  process.exit(1);
}
console.log("Generated files are up-to-date.");
