/**
 * yjs-stress/reconnect-storm.ts
 *
 * Client A makes 100 offline edits (accumulated locally), then reconnects.
 * Verifies all 100 edits land server-side without loss.
 * A second client (Client B) connects after the storm and verifies it sees all edits.
 *
 * This simulates the "offline queue" scenario: a client collects updates while
 * offline, then flushes them on reconnect.
 *
 * NOTE: Uses the in-process stress server on port 3099 due to production WS routing
 * conflict. See two-client-convergence.ts for full explanation.
 *
 * Usage:
 *   npx tsx scripts/yjs-stress/reconnect-storm.ts
 */
import * as Y from "yjs";
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

const DOC_ID = `stress-reconnect-${Date.now()}`;
const OFFLINE_EDITS = 100;
const SETTLE_MS = 1000;

/**
 * Accumulate N offline edits into a Y.Doc without sending to server.
 * Returns the doc and all update bytes in order.
 */
function makeOfflineEdits(n: number): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];

  doc.on("update", (update: Uint8Array) => {
    updates.push(update);
  });

  const text = doc.getText("content");
  for (let i = 0; i < n; i++) {
    doc.transact(() => {
      text.insert(text.length, `[offline-edit-${i}]`);
    });
  }

  return { doc, updates };
}

async function runStress(): Promise<void> {
  console.log("=== reconnect-storm stress ===");
  console.log(`Doc ID: ${DOC_ID}`);
  console.log(`Offline edits: ${OFFLINE_EDITS}`);
  console.log(`Settle period: ${SETTLE_MS}ms`);
  console.log();

  console.log("Starting in-process Yjs stress server...");
  const server: StressServer = await startStressServer();
  const port = parseInt(process.env.YJS_BENCH_PORT ?? "3099", 10);
  console.log(`Server ready on port ${port}`);
  console.log();

  // Step 1: Make offline edits (local only)
  process.stdout.write(`Accumulating ${OFFLINE_EDITS} offline edits... `);
  const { doc: offlineDoc, updates } = makeOfflineEdits(OFFLINE_EDITS);
  const expectedText = offlineDoc.getText("content").toString();
  console.log(`done (text length: ${expectedText.length}, updates: ${updates.length})`);

  // Step 2: Connect and flush — apply all updates through the WS
  process.stdout.write("Reconnecting and flushing offline edits... ");
  const flushClient = await connectYjsClient(DOC_ID, port);

  // Apply each offline update to the client's doc (triggers WS send)
  for (const update of updates) {
    Y.applyUpdate(flushClient.doc, update);
    sendYjsUpdate(flushClient.ws, update);
    // Small delay to avoid overwhelming the local WS
    await sleep(1);
  }

  await sleep(300); // Let updates propagate
  flushClient.close();
  console.log("done");

  await sleep(SETTLE_MS);

  // Step 3: Observer client connects fresh and reads the server state
  process.stdout.write("Observer client connecting to verify edits... ");
  const observer = await connectYjsClient(DOC_ID, port);
  await sleep(2000); // Let initial sync complete — server sends step1+step2 asynchronously

  const observedText = observer.doc.getText("content").toString();
  console.log(`done (observed text length: ${observedText.length})`);

  // Parse edit markers
  const editMarkers = Array.from(observedText.matchAll(/\[offline-edit-(\d+)\]/g));
  const editIndices = new Set(editMarkers.map((m) => parseInt(m[1]!, 10)));

  let missingEdits = 0;
  for (let i = 0; i < OFFLINE_EDITS; i++) {
    if (!editIndices.has(i)) missingEdits++;
  }

  const allEditsPresent = missingEdits === 0;
  const textMatches = observedText === expectedText;

  console.log();
  console.log("=== Results ===");
  console.log(`Expected edits: ${OFFLINE_EDITS}`);
  console.log(`Observed edit markers: ${editMarkers.length}`);
  console.log(`Missing edits: ${missingEdits}`);
  console.log(`All edits present: ${allEditsPresent ? "PASS" : "FAIL"}`);
  console.log(`Text matches offline doc: ${textMatches ? "PASS" : "FAIL"}`);

  if (!allEditsPresent) {
    const missing = Array.from({ length: OFFLINE_EDITS }, (_, i) => i)
      .filter((i) => !editIndices.has(i))
      .slice(0, 20);
    console.error(`Missing edit indices (first 20): ${missing.join(", ")}`);
  }

  observer.close();

  const outDir = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "../../../../docs/perf",
  );
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "yjs-reconnect-results.json");

  const output = {
    bench: "yjs-reconnect-storm",
    timestamp: nowISO(),
    serverNote: "Uses in-process stress server on port 3099 due to production WS routing conflict",
    docId: DOC_ID,
    offlineEdits: OFFLINE_EDITS,
    settleMs: SETTLE_MS,
    results: {
      editMarkersSeen: editMarkers.length,
      missingEdits,
      allEditsPresent,
      textLengthExpected: expectedText.length,
      textLengthObserved: observedText.length,
      textMatches,
    },
    passed: allEditsPresent && textMatches,
  };

  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outPath}`);

  await server.close();
  process.exit(allEditsPresent && textMatches ? 0 : 1);
}

runStress().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});
