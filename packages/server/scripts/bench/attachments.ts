/**
 * bench/attachments.ts
 *
 * Measures attachment upload + download round-trip at sizes:
 *   1KB, 100KB, 10MB
 * Also confirms that 50MB upload returns HTTP 413.
 *
 * Usage:
 *   npx tsx scripts/bench/attachments.ts
 *
 * Environment:
 *   BENCH_SERVER_URL  (default: http://localhost:3001)
 *   BENCH_EMAIL       (default: bench@test.local)
 *   BENCH_PASSWORD    (default: Bench123!)
 *   BENCH_ITERATIONS  (default: 10)
 */
import { performance } from "node:perf_hooks";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import {
  SERVER_URL,
  provisionUser,
  percentiles,
  hardware,
  nowISO,
  type AuthSession,
  type PctResult,
} from "./bench-utils.js";

const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS ?? "10", 10);

const SIZES_KB: Array<{ label: string; bytes: number }> = [
  { label: "1KB", bytes: 1 * 1024 },
  { label: "100KB", bytes: 100 * 1024 },
  { label: "10MB", bytes: 10 * 1024 * 1024 },
];

const OVERSIZE_BYTES = 50 * 1024 * 1024 + 1; // 50MB + 1 byte — should get 413

interface RoundTripResult {
  sizeLabel: string;
  sizeBytes: number;
  uploadMs: PctResult;
  downloadMs: PctResult;
  roundTripMs: PctResult;
  attachmentId: string;
}

function makeBuffer(bytes: number): Buffer {
  // Fill with deterministic pseudo-random bytes
  const buf = Buffer.allocUnsafe(bytes);
  for (let i = 0; i < bytes; i++) {
    buf[i] = (i * 31 + 7) & 0xff;
  }
  return buf;
}

async function authUpload(
  session: AuthSession,
  buf: Buffer,
  filename: string,
  notePath: string,
): Promise<{ status: number; body: string; attachmentId?: string }> {
  const formData = new FormData();
  formData.append("file", new Blob([buf], { type: "application/octet-stream" }), filename);
  formData.append("notePath", notePath);

  const res = await fetch(`${SERVER_URL}/api/attachments`, {
    method: "POST",
    headers: { Cookie: session.cookieHeader },
    body: formData,
  });

  const body = await res.text();
  let attachmentId: string | undefined;
  try {
    attachmentId = (JSON.parse(body) as { id: string }).id;
  } catch {
    // no-op
  }
  return { status: res.status, body, attachmentId };
}

async function authDownload(
  session: AuthSession,
  attachmentId: string,
): Promise<{ status: number; bytes: number }> {
  const res = await fetch(`${SERVER_URL}/api/attachments/${attachmentId}`, {
    headers: { Cookie: session.cookieHeader },
  });
  const buf = await res.arrayBuffer();
  return { status: res.status, bytes: buf.byteLength };
}

async function measureRoundTrip(
  session: AuthSession,
  sizeBytes: number,
  sizeLabel: string,
  iterations: number,
): Promise<RoundTripResult> {
  const buf = makeBuffer(sizeBytes);
  const uploadLatencies: number[] = [];
  const downloadLatencies: number[] = [];
  const roundTripLatencies: number[] = [];

  // First upload to get an attachment ID for downloads
  const firstUpload = await authUpload(session, buf, `bench-${sizeLabel}.bin`, "bench/attach-test.md");
  if (firstUpload.status !== 200) {
    throw new Error(`Initial upload failed: ${firstUpload.status} ${firstUpload.body.slice(0, 100)}`);
  }
  const primaryId = firstUpload.attachmentId!;

  for (let i = 0; i < iterations; i++) {
    const rtStart = performance.now();

    // Upload
    const upStart = performance.now();
    const up = await authUpload(session, buf, `bench-${sizeLabel}-${i}.bin`, "bench/attach-test.md");
    const upMs = performance.now() - upStart;
    if (up.status !== 200) {
      throw new Error(`Upload failed at iter=${i}: ${up.status}`);
    }
    uploadLatencies.push(upMs);

    // Download the pre-uploaded attachment (consistent ID)
    const dlStart = performance.now();
    const dl = await authDownload(session, primaryId);
    const dlMs = performance.now() - dlStart;
    if (dl.status !== 200) {
      throw new Error(`Download failed at iter=${i}: ${dl.status}`);
    }
    if (dl.bytes !== sizeBytes) {
      throw new Error(`Download size mismatch: expected=${sizeBytes} got=${dl.bytes}`);
    }
    downloadLatencies.push(dlMs);
    roundTripLatencies.push(performance.now() - rtStart);
  }

  return {
    sizeLabel,
    sizeBytes,
    uploadMs: percentiles(uploadLatencies),
    downloadMs: percentiles(downloadLatencies),
    roundTripMs: percentiles(roundTripLatencies),
    attachmentId: primaryId,
  };
}

async function runBench(): Promise<void> {
  console.log("=== attachments bench ===");
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log();

  const session = await provisionUser();
  console.log(`Authenticated as userId=${session.userId}`);
  console.log();

  const results: RoundTripResult[] = [];

  for (const { label, bytes } of SIZES_KB) {
    process.stdout.write(`Testing ${label} (${bytes.toLocaleString()} bytes) × ${ITERATIONS}... `);
    const result = await measureRoundTrip(session, bytes, label, ITERATIONS);
    results.push(result);
    console.log(
      `done | upload p95=${result.uploadMs.p95.toFixed(1)}ms | ` +
      `download p95=${result.downloadMs.p95.toFixed(1)}ms | ` +
      `round-trip p95=${result.roundTripMs.p95.toFixed(1)}ms`,
    );
  }

  // Confirm 50MB returns 413
  process.stdout.write(`Confirming 50MB returns 413... `);
  const oversizeBuf = makeBuffer(OVERSIZE_BYTES);
  const oversizeResult = await authUpload(
    session,
    oversizeBuf,
    "bench-50mb.bin",
    "bench/attach-test.md",
  );
  const got413 = oversizeResult.status === 413;
  console.log(got413 ? `YES (got ${oversizeResult.status})` : `FAIL (got ${oversizeResult.status})`);
  if (!got413) {
    console.warn(`  WARNING: Expected 413 for 50MB upload but got ${oversizeResult.status}`);
  }

  const outDir = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "../../../../docs/perf",
  );
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "attachments-results.json");

  const output = {
    bench: "attachments",
    timestamp: nowISO(),
    hardware: hardware(),
    serverUrl: SERVER_URL,
    iterations: ITERATIONS,
    results,
    oversizeCheck: {
      sizeBytes: OVERSIZE_BYTES,
      expectedStatus: 413,
      actualStatus: oversizeResult.status,
      passed: got413,
    },
  };

  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

runBench().catch((err) => {
  console.error("Bench failed:", err);
  process.exit(1);
});
