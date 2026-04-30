/**
 * bench/push-throughput.ts
 *
 * Measures /api/sync/v2/push with mixed creates/updates.
 * Tracks conflict rate at varying base_version skew.
 *
 * Usage:
 *   npx tsx scripts/bench/push-throughput.ts
 *
 * Environment:
 *   BENCH_SERVER_URL  (default: http://localhost:3001)
 *   BENCH_EMAIL       (default: bench@test.local)
 *   BENCH_PASSWORD    (default: Bench123!)
 *   BENCH_ITERATIONS  (default: 50)
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

const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS ?? "50", 10);

interface ConflictResult {
  skew: number; // base_version skew: 0=current, 1=one behind, 5=five behind
  accepted: number;
  conflicts: number;
  conflictRate: number;
  latencyMs: PctResult;
}

interface PushResult {
  scenario: string;
  latencyMs: PctResult;
  accepted: number;
  conflicts: number;
}

/** Seed baseline notes with known versions, return their current versions */
async function seedBaselineNotes(
  session: AuthSession,
  count: number,
  prefix: string,
): Promise<Map<string, number>> {
  const ops = Array.from({ length: count }, (_, i) => ({
    op: "create" as const,
    id: `push-bench/${prefix}-${i}.md`,
    fields: {
      path: `push-bench/${prefix}-${i}.md`,
      title: `Push Bench ${prefix} ${i}`,
      content: `Initial content for ${prefix}-${i}`,
      tags: "[]",
      modifiedAt: Date.now(),
    },
  }));

  const res = await authFetch(session, `${SERVER_URL}/api/sync/v2/push`, {
    method: "POST",
    body: JSON.stringify({ changes: { notes: ops } }),
  });
  if (!res.ok) throw new Error(`Seed failed: ${res.status}`);
  const body = (await res.json()) as {
    accepted: { notes: Array<{ id: string; version: number }> };
  };

  const versions = new Map<string, number>();
  for (const acc of body.accepted.notes ?? []) {
    versions.set(acc.id, acc.version);
  }
  return versions;
}

async function benchCreateBurst(
  session: AuthSession,
  iterations: number,
): Promise<PushResult> {
  const latencies: number[] = [];
  let accepted = 0;
  let conflicts = 0;

  for (let i = 0; i < iterations; i++) {
    const noteId = `push-bench/create-burst-${Date.now()}-${i}.md`;
    const ops = [
      {
        op: "create" as const,
        id: noteId,
        fields: {
          path: noteId,
          title: `Create burst ${i}`,
          content: `Content ${i}`,
          tags: "[]",
          modifiedAt: Date.now(),
        },
      },
    ];

    const start = performance.now();
    const res = await authFetch(session, `${SERVER_URL}/api/sync/v2/push`, {
      method: "POST",
      body: JSON.stringify({ changes: { notes: ops } }),
    });
    latencies.push(performance.now() - start);

    if (!res.ok) throw new Error(`Push failed: ${res.status}`);
    const body = (await res.json()) as {
      accepted: { notes: Array<unknown> };
      conflicts: Array<unknown>;
    };
    accepted += body.accepted.notes?.length ?? 0;
    conflicts += body.conflicts?.length ?? 0;
  }

  return { scenario: "create-burst", latencyMs: percentiles(latencies), accepted, conflicts };
}

async function benchUpdateWithSkew(
  session: AuthSession,
  versions: Map<string, number>,
  skew: number,
  prefix: string,
  iterations: number,
): Promise<ConflictResult> {
  const noteIds = Array.from(versions.keys());
  const latencies: number[] = [];
  let accepted = 0;
  let conflicts = 0;

  for (let i = 0; i < iterations; i++) {
    const noteId = noteIds[i % noteIds.length]!;
    const currentVersion = versions.get(noteId) ?? 1;
    // Apply skew: use a lower base_version to simulate stale client
    const baseVersion = Math.max(0, currentVersion - skew);

    const ops = [
      {
        op: "update" as const,
        id: noteId,
        base_version: baseVersion,
        fields: {
          path: noteId,
          title: `Updated ${prefix} skew=${skew} iter=${i}`,
          content: `Updated content iter=${i}`,
          tags: "[]",
          modifiedAt: Date.now(),
        },
      },
    ];

    const start = performance.now();
    const res = await authFetch(session, `${SERVER_URL}/api/sync/v2/push`, {
      method: "POST",
      body: JSON.stringify({ changes: { notes: ops } }),
    });
    latencies.push(performance.now() - start);

    if (!res.ok) throw new Error(`Push failed: ${res.status}`);
    const body = (await res.json()) as {
      accepted: { notes: Array<{ id: string; version: number }> };
      conflicts: Array<unknown>;
    };
    const accCount = body.accepted.notes?.length ?? 0;
    accepted += accCount;
    conflicts += body.conflicts?.length ?? 0;

    // Update version map for accepted updates
    for (const acc of body.accepted.notes ?? []) {
      versions.set(acc.id, acc.version);
    }
  }

  const total = accepted + conflicts;
  return {
    skew,
    accepted,
    conflicts,
    conflictRate: total > 0 ? conflicts / total : 0,
    latencyMs: percentiles(latencies),
  };
}

async function runBench(): Promise<void> {
  console.log("=== push-throughput bench ===");
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log();

  const session = await provisionUser();
  console.log(`Authenticated as userId=${session.userId}`);
  console.log();

  // 1. Create burst: pure creates
  process.stdout.write("Benchmarking pure create burst... ");
  const createResult = await benchCreateBurst(session, ITERATIONS);
  console.log(`done | p50=${createResult.latencyMs.p50.toFixed(1)}ms p95=${createResult.latencyMs.p95.toFixed(1)}ms p99=${createResult.latencyMs.p99.toFixed(1)}ms`);

  // 2. Seed baseline notes for update tests (5 notes, 2 update rounds to get version > 1)
  process.stdout.write("Seeding 5 baseline notes for update tests... ");
  const versions = await seedBaselineNotes(session, 5, "update-base");
  // Push a few updates to ensure version > 1 for skew tests
  for (let round = 0; round < 2; round++) {
    for (const [noteId, ver] of versions) {
      const ops = [
        {
          op: "update" as const,
          id: noteId,
          base_version: ver,
          fields: {
            path: noteId,
            title: `Updated round ${round}`,
            content: `Content round ${round}`,
            tags: "[]",
            modifiedAt: Date.now(),
          },
        },
      ];
      const res = await authFetch(session, `${SERVER_URL}/api/sync/v2/push`, {
        method: "POST",
        body: JSON.stringify({ changes: { notes: ops } }),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          accepted: { notes: Array<{ id: string; version: number }> };
        };
        for (const acc of body.accepted.notes ?? []) {
          versions.set(acc.id, acc.version);
        }
      }
    }
  }
  console.log("done");
  console.log();

  // 3. Update with varying skew
  const conflictResults: ConflictResult[] = [];
  for (const skew of [0, 1, 3, 5]) {
    process.stdout.write(`Benchmarking updates with version skew=${skew}... `);
    // Deep-copy versions map for this test
    const versionsCopy = new Map(versions);
    let result: ConflictResult;
    try {
      result = await benchUpdateWithSkew(session, versionsCopy, skew, `skew-${skew}`, ITERATIONS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) {
        console.log(`SKIPPED (rate limit hit — 200 req/15min limit)`);
        break;
      }
      throw err;
    }
    conflictResults.push(result);
    console.log(
      `done | p50=${result.latencyMs.p50.toFixed(1)}ms p95=${result.latencyMs.p95.toFixed(1)}ms ` +
      `accepted=${result.accepted} conflicts=${result.conflicts} ` +
      `conflict_rate=${(result.conflictRate * 100).toFixed(1)}%`,
    );
  }

  // Write results JSON
  const outDir = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "../../../../docs/perf",
  );
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "push-throughput-results.json");

  const output = {
    bench: "push-throughput",
    timestamp: nowISO(),
    hardware: hardware(),
    serverUrl: SERVER_URL,
    iterations: ITERATIONS,
    createBurst: createResult,
    conflictMeasurements: conflictResults,
  };

  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

runBench().catch((err) => {
  console.error("Bench failed:", err);
  process.exit(1);
});
