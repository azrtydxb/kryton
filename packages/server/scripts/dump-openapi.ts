/**
 * Dump the live OpenAPI 3.1 spec from the Fastify app.
 *
 * Usage:
 *   tsx scripts/dump-openapi.ts            # writes openapi.snapshot.json
 *   tsx scripts/dump-openapi.ts --check    # exit 1 if spec drifted from snapshot
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadEnv } from "../src/config/index.js";
import { buildApp } from "../src/app.js";

const SNAPSHOT_PATH = path.resolve(import.meta.dirname, "..", "openapi.snapshot.json");

/** Sort all object keys recursively so the JSON output is stable. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortKeys(obj[k]);
    }
    return sorted;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");

  // Override env: don't try to read .env or fail on missing secrets at dump time.
  process.env.NODE_ENV ??= "test";
  process.env.LOG_LEVEL ??= "silent";
  process.env.DATABASE_URL ??= "file:./data/openapi-dump.db";
  process.env.BETTER_AUTH_SECRET ??=
    "openapi-dump-secret-must-be-at-least-32-characters";
  process.env.OPENAPI_ENABLED = "true";

  const config = loadEnv();
  // discoverPlugins=false so the spec only reflects core, in-tree routes.
  // Plugin-defined routes are environment-dependent and would cause the
  // snapshot to drift between machines.
  const app = await buildApp({ config, discoverPlugins: false });
  await app.ready();

  const spec = app.swagger() as Record<string, unknown>;
  await app.close();

  const serialized = stableStringify(spec);

  if (checkOnly) {
    let existing: string;
    try {
      existing = await fs.readFile(SNAPSHOT_PATH, "utf8");
    } catch {
      console.error(
        `OpenAPI snapshot missing at ${SNAPSHOT_PATH}. Run \`tsx scripts/dump-openapi.ts\` first.`,
      );
      process.exit(1);
    }
    if (existing !== serialized) {
      console.error(
        "OpenAPI spec drift detected. The current spec differs from the snapshot.",
      );
      console.error(`Snapshot: ${SNAPSHOT_PATH}`);
      console.error("Run `npm run openapi:dump --workspace=packages/server` to update.");
      process.exit(1);
    }
    console.log("OpenAPI snapshot up-to-date.");
    process.exit(0);
  }

  await fs.writeFile(SNAPSHOT_PATH, serialized, "utf8");
  console.log(`OpenAPI snapshot written to ${SNAPSHOT_PATH}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
