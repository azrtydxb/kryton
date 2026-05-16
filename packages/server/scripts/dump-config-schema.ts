/**
 * Dump the server's env-var config schema to `config-schema.json`.
 *
 * This file is the single source of truth consumed by deployment surfaces
 * (docker-compose, helm chart, operator CRD) and by the drift-prevention
 * CI gate (`scripts/check-deployment-sync.ts`). See
 * `docs/superpowers/specs/2026-05-16-deployment-surfaces-design.md`.
 *
 * Usage:
 *   tsx scripts/dump-config-schema.ts            # writes config-schema.json
 *   tsx scripts/dump-config-schema.ts --check    # exit 1 if file drifted
 *
 * Output format (stable, sorted per-field keys, trailing newline):
 *   {
 *     "fields": [
 *       { "default": ..., "description": "...", "name": "...",
 *         "required": bool, "secret": bool, "type": "...",
 *         "userFacing": bool, "values": [...] },
 *       ...
 *     ]
 *   }
 *
 * The `fields` array preserves declaration order from `env.ts`. The
 * serialization itself lives in `src/config/introspect.ts` so it can be
 * exercised by unit tests under `src/config/__tests__/`.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { envSchema, serializeSchema } from "../src/config/index.js";

const OUT_PATH = path.resolve(import.meta.dirname, "..", "config-schema.json");

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const serialized = serializeSchema(envSchema);

  if (checkOnly) {
    let existing: string;
    try {
      existing = await fs.readFile(OUT_PATH, "utf8");
    } catch {
      console.error(
        `config-schema.json missing at ${OUT_PATH}. ` +
          `Run \`npm run config:dump --workspace=packages/server\` first.`,
      );
      process.exit(1);
    }
    if (existing !== serialized) {
      console.error(
        "config-schema.json drift detected. The Zod env schema differs from " +
          "the committed JSON.",
      );
      console.error(`File: ${OUT_PATH}`);
      console.error("Run `npm run config:dump --workspace=packages/server` to update.");
      process.exit(1);
    }
    console.log("config-schema.json up-to-date.");
    process.exit(0);
  }

  await fs.writeFile(OUT_PATH, serialized, "utf8");
  console.log(`config-schema.json written to ${OUT_PATH}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
