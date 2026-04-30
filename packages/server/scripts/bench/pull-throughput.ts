/**
 * bench/pull-throughput.ts
 *
 * Measures /api/sync/v2/pull p50/p95/p99 latency at N = 100, 1000, 5000 notes.
 *
 * Usage:
 *   npx tsx scripts/bench/pull-throughput.ts
 *
 * Environment:
 *   BENCH_SERVER_URL  (default: http://localhost:3001)
 *   BENCH_EMAIL       (default: bench@test.local)
 *   BENCH_PASSWORD    (default: Bench123!)
 *   BENCH_ITERATIONS  (default: 50 per N)
 *   BENCH_SIZES       (default: 100,1000,5000)
 */
import { performance } from "node:perf_hooks";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import {
  SERVER_URL,
  provisionUser,
  authFetch,
  seedNotes,
  seedFolders,
  seedTags,
  percentiles,
  hardware,
  nowISO,
  type AuthSession,
  type PctResult,
} from "./bench-utils.js";

const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS ?? "50", 10);
const SIZES = (process.env.BENCH_SIZES ?? "100,1000,5000")
  .split(",")
  .map((s) => parseInt(s.trim(), 10));

interface SizeResult {
  n: number;
  iterations: number;
  latencyMs: PctResult;
  payloadSizeBytes: number;
  totalEntities: number;
}

/** Minimum inter-request delay to stay comfortably under the 200/15min rate limit */
const INTER_REQUEST_DELAY_MS = 100;

async function measurePull(
  session: AuthSession,
  iterations: number,
): Promise<{ latencies: number[]; payloadBytes: number; totalEntities: number }> {
  const latencies: number[] = [];
  let payloadBytes = 0;
  let totalEntities = 0;

  for (let i = 0; i < iterations; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));

    const start = performance.now();
    const res = await authFetch(session, `${SERVER_URL}/api/sync/v2/pull`, {
      method: "POST",
      body: JSON.stringify({ cursor: "0" }),
    });
    const elapsed = performance.now() - start;

    if (!res.ok) {
      throw new Error(`pull returned ${res.status}: ${await res.text()}`);
    }

    const text = await res.text();
    latencies.push(elapsed);

    if (i === 0) {
      // Only parse full response once for size/count inspection
      payloadBytes = Buffer.byteLength(text, "utf8");
      try {
        const body = JSON.parse(text) as { changes: Record<string, { created: unknown[] }> };
        for (const table of Object.values(body.changes)) {
          totalEntities += table.created?.length ?? 0;
        }
      } catch {
        // ignore parse errors for size-only tracking
      }
    }
  }

  return { latencies, payloadBytes, totalEntities };
}

async function runBench(): Promise<void> {
  console.log("=== pull-throughput bench ===");
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Sizes: ${SIZES.join(", ")}`);
  console.log(`Iterations per size: ${ITERATIONS}`);
  console.log();

  const session = await provisionUser();
  console.log(`Authenticated as userId=${session.userId}`);

  const results: SizeResult[] = [];
  let seededNotes = 0;
  let seededFolders = 0;
  let seededTags = 0;

  for (const n of SIZES) {
    const noteTarget = Math.floor(n * 0.6);
    const folderTarget = Math.floor(n * 0.2);
    const tagTarget = n - noteTarget - folderTarget;

    const newNotes = Math.max(0, noteTarget - seededNotes);
    const newFolders = Math.max(0, folderTarget - seededFolders);
    const newTags = Math.max(0, tagTarget - seededTags);

    if (newNotes > 0 || newFolders > 0 || newTags > 0) {
      process.stdout.write(`Seeding ${newNotes + newFolders + newTags} new entities for n=${n}... `);
      try {
        if (newNotes > 0) await seedNotes(session, newNotes, seededNotes);
        if (newFolders > 0) await seedFolders(session, newFolders, seededFolders);
        if (newTags > 0) await seedTags(session, newTags, seededTags);
        seededNotes = noteTarget;
        seededFolders = folderTarget;
        seededTags = tagTarget;
        console.log("done");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429") || msg.includes("rate limit")) {
          console.log(`SKIPPED (rate limit hit — server allows 200 sync requests per 15 min)`);
          console.log(`  Finding: N=${n} seeding requires >${200} sync requests. Run with a fresh server.`);
          break;
        }
        throw err;
      }
    }

    process.stdout.write(`Warming up (3 pulls)... `);
    // Warm up: 3 pulls to prime DB caches
    for (let i = 0; i < 3; i++) {
      const res = await authFetch(session, `${SERVER_URL}/api/sync/v2/pull`, {
        method: "POST",
        body: JSON.stringify({ cursor: "0" }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429) { console.log(`\n  Warmup hit rate limit: ${text}`); break; }
        throw new Error(`warmup pull failed: ${res.status} ${text}`);
      }
      await res.text();
    }
    console.log("done");

    process.stdout.write(`Measuring ${ITERATIONS} pulls at n=${n}... `);
    let measureResult: { latencies: number[]; payloadBytes: number; totalEntities: number } | null = null;
    try {
      measureResult = await measurePull(session, ITERATIONS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) {
        console.log(`SKIPPED (rate limit hit during measurement)`);
        break;
      }
      throw err;
    }
    console.log("done");

    const { latencies, payloadBytes, totalEntities } = measureResult;
    const pct = percentiles(latencies);
    const result: SizeResult = {
      n,
      iterations: ITERATIONS,
      latencyMs: pct,
      payloadSizeBytes: payloadBytes,
      totalEntities,
    };
    results.push(result);

    console.log(`  n=${n}: p50=${pct.p50.toFixed(1)}ms p95=${pct.p95.toFixed(1)}ms p99=${pct.p99.toFixed(1)}ms mean=${pct.mean.toFixed(1)}ms payload=${(payloadBytes / 1024).toFixed(1)}KB entities=${totalEntities}`);
    console.log();
  }

  // Write results JSON
  const outDir = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "../../../../docs/perf",
  );
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "pull-throughput-results.json");

  const output = {
    bench: "pull-throughput",
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
