/**
 * bench/tier2-history.ts
 *
 * Measures /api/sync/v2/tier2/history/:notePath cold vs warm fetch
 * at N revisions = 10, 100, 1000.
 *
 * FINDING: The NoteRevision table is not written by any production code path.
 * The sync push endpoint creates NoteVersion rows (for sync cursor tracking)
 * but NOT NoteRevision rows. The notes save service writes filesystem snapshots
 * to .history/ but does NOT write NoteRevision DB rows. The tier2/history
 * endpoint therefore always returns 0 rows in a live system.
 *
 * This bench seeds NoteRevision rows directly into the SQLite database to
 * measure what the endpoint latency WOULD be at scale. The DATABASE_URL
 * environment variable must be set to the same SQLite file the server uses.
 *
 * Usage:
 *   DATABASE_URL="file:/path/to/kryton.db" npx tsx scripts/bench/tier2-history.ts
 *
 * Environment:
 *   BENCH_SERVER_URL  (default: http://localhost:3001)
 *   DATABASE_URL      required — path to the SQLite DB
 *   BENCH_EMAIL       (default: bench@test.local)
 *   BENCH_PASSWORD    (default: Bench123!)
 *   BENCH_ITERATIONS  (default: 20)
 *   BENCH_REV_SIZES   (default: 10,100,1000)
 */
import { performance } from "node:perf_hooks";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import {
  SERVER_URL,
  provisionUser,
  authFetch,
  percentiles,
  hardware,
  nowISO,
  type AuthSession,
  type PctResult,
} from "./bench-utils.js";

const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS ?? "20", 10);
const REV_SIZES = (process.env.BENCH_REV_SIZES ?? "10,100,1000")
  .split(",")
  .map((s) => parseInt(s.trim(), 10));

interface RevResult {
  nRevisions: number;
  cold: PctResult;   // First fetch (cold — simulated by always fetching fresh)
  warm: PctResult;   // Subsequent fetches (warm — cached by SQLite page cache)
  rowsReturned: number;
}

/**
 * Seed N NoteRevision rows directly into SQLite.
 * Uses better-sqlite3 for fast batch inserts.
 *
 * Finding: NoteRevision rows are not written by any production code path.
 * They are only created via direct DB insert in tests.
 */
async function seedRevisions(userId: string, notePath: string, n: number): Promise<void> {
  const dbUrlEnv = process.env.DATABASE_URL ?? "";
  const dbPath = dbUrlEnv.replace(/^file:/, "");
  if (!dbPath) {
    throw new Error("DATABASE_URL must be set (e.g. file:/path/to/kryton.db)");
  }

  // Dynamic import better-sqlite3
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(dbPath);

  const insert = db.prepare(
    "INSERT INTO NoteRevision (id, userId, notePath, content, createdAt) VALUES (?, ?, ?, ?, ?)",
  );

  const insertMany = db.transaction((rows: Array<[string, string, string, string, string]>) => {
    for (const row of rows) insert.run(...row);
  });

  const BATCH = 100;
  let seeded = 0;
  while (seeded < n) {
    const batchSize = Math.min(BATCH, n - seeded);
    const rows = Array.from({ length: batchSize }, (_, i): [string, string, string, string, string] => [
      `rev-bench-${notePath.replace(/\//g, "-")}-${seeded + i}-${Date.now()}`,
      userId,
      notePath,
      `# Revision ${seeded + i}\n\nBench content for revision ${seeded + i}.`.repeat(3),
      new Date(Date.now() - (n - seeded - i) * 1000).toISOString(),
    ]);
    insertMany(rows);
    seeded += batchSize;
    if (seeded % 500 === 0) process.stdout.write(`${seeded}/${n}... `);
  }

  db.close();
}

async function measureTier2(
  session: AuthSession,
  notePath: string,
  iterations: number,
): Promise<{ latencies: number[]; rowsReturned: number }> {
  const latencies: number[] = [];
  let rowsReturned = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const res = await authFetch(
      session,
      `${SERVER_URL}/api/sync/v2/tier2/history/${encodeURIComponent(notePath)}?limit=200`,
    );
    const elapsed = performance.now() - start;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`tier2 fetch failed: ${res.status} ${text}`);
    }

    const body = (await res.json()) as { entities: unknown[] };
    latencies.push(elapsed);
    if (i === 0) rowsReturned = body.entities?.length ?? 0;
  }

  return { latencies, rowsReturned };
}

async function runBench(): Promise<void> {
  console.log("=== tier2-history bench ===");
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Revision counts: ${REV_SIZES.join(", ")}`);
  console.log(`Iterations per size: ${ITERATIONS}`);
  console.log();

  const session = await provisionUser();
  console.log(`Authenticated as userId=${session.userId}`);
  console.log();

  const results: RevResult[] = [];

  console.log();
  console.log("NOTE: NoteRevision rows are seeded directly into SQLite (production server does not write them).");
  console.log();

  for (const n of REV_SIZES) {
    const notePath = `bench-history/note-${n}-revs.md`;
    process.stdout.write(`Seeding ${n} NoteRevision rows for ${notePath}... `);
    await seedRevisions(session.userId, notePath, n);
    console.log("done");

    // Cold measurement: first N/4 iterations (simulating fresh reads)
    const coldIterations = Math.max(3, Math.floor(ITERATIONS / 4));
    process.stdout.write(`Measuring ${coldIterations} cold fetches... `);
    const { latencies: coldLat, rowsReturned } = await measureTier2(session, notePath, coldIterations);
    console.log(`done (rows returned: ${rowsReturned})`);

    // Warm measurement: remaining iterations (DB page cache warm)
    const warmIterations = ITERATIONS - coldIterations;
    process.stdout.write(`Measuring ${warmIterations} warm fetches... `);
    const { latencies: warmLat } = await measureTier2(session, notePath, warmIterations);
    console.log("done");

    const cold = percentiles(coldLat);
    const warm = percentiles(warmLat);

    const result: RevResult = {
      nRevisions: n,
      cold,
      warm,
      rowsReturned,
    };
    results.push(result);

    console.log(
      `  n=${n}: cold p50=${cold.p50.toFixed(1)}ms p95=${cold.p95.toFixed(1)}ms | ` +
      `warm p50=${warm.p50.toFixed(1)}ms p95=${warm.p95.toFixed(1)}ms | ` +
      `rows=${rowsReturned}`,
    );
    console.log();
  }

  const outDir = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "../../../../docs/perf",
  );
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "tier2-history-results.json");

  const output = {
    bench: "tier2-history",
    timestamp: nowISO(),
    hardware: hardware(),
    serverUrl: SERVER_URL,
    iterations: ITERATIONS,
    results,
  };

  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`Results written to ${outPath}`);
}

runBench().catch((err) => {
  console.error("Bench failed:", err);
  process.exit(1);
});
