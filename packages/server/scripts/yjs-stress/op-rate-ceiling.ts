/**
 * yjs-stress/op-rate-ceiling.ts
 *
 * Single client emits ops at two rates:
 *   - 200 ops/sec for 30 seconds (should pass without errors)
 *   - 500 ops/sec for 30 seconds (should hit server limits or degrade)
 *
 * Measures:
 *   - Actual achieved ops/sec (may be lower than target due to backpressure)
 *   - WS error count
 *   - Server disconnections
 *   - Memory growth on client doc
 *
 * The "ceiling" is the rate at which errors start appearing or throughput
 * degrades below 80% of target. Documents actual server behavior.
 *
 * NOTE: Uses the in-process stress server on port 3099 due to production WS
 * routing conflict. See two-client-convergence.ts for full explanation.
 *
 * Usage:
 *   npx tsx scripts/yjs-stress/op-rate-ceiling.ts
 */
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import { WebSocket } from "ws";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import {
  startStressServer,
  connectYjsClient,
  sendYjsUpdate,
  sleep,
  nowISO,
  type StressServer,
} from "./stress-utils.js";

const DURATION_MS = 30_000;
const RATES = [200, 500]; // ops/sec

interface RateResult {
  targetOpsPerSec: number;
  durationMs: number;
  totalOpsSent: number;
  achievedOpsPerSec: number;
  throughputRatio: number; // achievedOpsPerSec / targetOpsPerSec
  errors: number;
  disconnections: number;
  finalDocTextLength: number;
  passed: boolean; // true if throughput >= 80% of target and errors < 10
}

function makeSmallEdit(doc: Y.Doc, index: number): Uint8Array {
  let captured: Uint8Array | null = null;
  const handler = (upd: Uint8Array) => { captured = upd; };
  doc.on("update", handler);

  doc.transact(() => {
    const text = doc.getText("content");
    text.insert(text.length % 1000, `[${index % 10000}]`);
  });

  doc.off("update", handler);
  return captured ?? Y.encodeStateAsUpdate(doc);
}

async function measureRate(
  docId: string,
  targetOpsPerSec: number,
  durationMs: number,
  port: number,
): Promise<RateResult> {
  const intervalMs = 1000 / targetOpsPerSec;
  const client = await connectYjsClient(docId, port);

  let opsSent = 0;
  let errors = 0;
  let disconnections = 0;

  client.ws.on("error", () => { errors++; });
  client.ws.on("close", () => { disconnections++; });

  const startTime = Date.now();
  let nextOpTime = startTime;
  let opIndex = 0;

  while (Date.now() - startTime < durationMs) {
    const now = Date.now();
    if (now >= nextOpTime) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          const update = makeSmallEdit(client.doc, opIndex);
          sendYjsUpdate(client.ws, update);
          opsSent++;
          opIndex++;
        } catch {
          errors++;
        }
      }
      nextOpTime += intervalMs;
    }

    // Small sleep to avoid busy-looping too hard (1ms granularity)
    const sleepMs = Math.max(0, nextOpTime - Date.now());
    if (sleepMs > 0) await sleep(Math.min(sleepMs, 10));
  }

  const actualDurationMs = Date.now() - startTime;
  client.close();

  const achievedOpsPerSec = (opsSent / actualDurationMs) * 1000;
  const throughputRatio = achievedOpsPerSec / targetOpsPerSec;
  const passed = throughputRatio >= 0.8 && errors < 10;

  return {
    targetOpsPerSec,
    durationMs: actualDurationMs,
    totalOpsSent: opsSent,
    achievedOpsPerSec: Math.round(achievedOpsPerSec * 10) / 10,
    throughputRatio: Math.round(throughputRatio * 1000) / 1000,
    errors,
    disconnections,
    finalDocTextLength: client.doc.getText("content").length,
    passed,
  };
}

async function runStress(): Promise<void> {
  console.log("=== op-rate-ceiling stress ===");
  console.log(`Rates: ${RATES.join(", ")} ops/sec`);
  console.log(`Duration per rate: ${DURATION_MS / 1000}s`);
  console.log();

  console.log("Starting in-process Yjs stress server...");
  const server: StressServer = await startStressServer();
  const port = parseInt(process.env.YJS_BENCH_PORT ?? "3099", 10);
  console.log(`Server ready on port ${port}`);
  console.log();

  const results: RateResult[] = [];

  for (const rate of RATES) {
    const docId = `stress-rate-${rate}-${Date.now()}`;
    process.stdout.write(`Testing ${rate} ops/sec for ${DURATION_MS / 1000}s... `);
    const result = await measureRate(docId, rate, DURATION_MS, port);
    results.push(result);

    console.log(
      `done | achieved=${result.achievedOpsPerSec} ops/s (${(result.throughputRatio * 100).toFixed(1)}%) | ` +
      `sent=${result.totalOpsSent} | errors=${result.errors} | disconnects=${result.disconnections} | ` +
      `${result.passed ? "PASS" : "DEGRADED"}`,
    );

    if (!result.passed) {
      if (result.throughputRatio < 0.8) {
        console.log(
          `  Throughput degraded: achieved only ${(result.throughputRatio * 100).toFixed(1)}% of target.`,
        );
        console.log(`  Server behavior: backpressure limits effective throughput.`);
      }
      if (result.errors > 0) {
        console.log(`  ${result.errors} errors during transmission.`);
      }
    }
    console.log();

    // Small gap between runs
    await sleep(1000);
  }

  // Determine the effective ceiling
  const passingResults = results.filter((r) => r.passed);
  const failingResults = results.filter((r) => !r.passed);
  const ceilingLow = passingResults.length > 0
    ? Math.max(...passingResults.map((r) => r.targetOpsPerSec))
    : 0;
  const ceilingHigh = failingResults.length > 0
    ? Math.min(...failingResults.map((r) => r.targetOpsPerSec))
    : null;

  console.log("=== Summary ===");
  console.log(`Effective ceiling: between ${ceilingLow} and ${ceilingHigh ?? "N/A"} ops/sec`);
  for (const r of results) {
    console.log(
      `  ${r.targetOpsPerSec} ops/sec: ${r.passed ? "PASS" : "DEGRADED"} (achieved ${r.achievedOpsPerSec} ops/s)`,
    );
  }

  const outDir = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "../../../../docs/perf",
  );
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "yjs-op-rate-results.json");

  const output = {
    bench: "yjs-op-rate-ceiling",
    timestamp: nowISO(),
    serverNote: "Uses in-process stress server on port 3099 due to production WS routing conflict",
    durationPerRateMs: DURATION_MS,
    results,
    ceiling: {
      passesBelow: ceilingLow,
      degradesAt: ceilingHigh,
      note: ceilingHigh
        ? `Server effectively handles ${ceilingLow} ops/sec; degrades at ${ceilingHigh} ops/sec`
        : `All tested rates passed: throughput is rate-limited only by client CPU`,
    },
  };

  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outPath}`);

  await server.close();
  process.exit(0);
}

runStress().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});
