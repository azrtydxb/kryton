/**
 * yjs-stress/two-client-convergence.ts
 *
 * Two WebSocket clients connect to the same docId, make 1000 random edits each
 * with realistic timing (10ms-100ms inter-edit). After a settle period, both
 * clients' Y.Doc states must match.
 *
 * Assertion: Y.encodeStateAsUpdate(c1.doc) produces the same logical state as c2.doc
 * (checked via Y.applyUpdate + text content comparison).
 *
 * NOTE: This script runs against a minimal in-process Yjs server on port 3099
 * because the production server has a WebSocket routing conflict where
 * PluginWebSocket (registered first with {server, path:"/ws/plugins"}) intercepts
 * ALL upgrade events and rejects non-/ws/plugins paths with HTTP 400 before the
 * Yjs handler runs. This is documented as a finding in docs/perf/README.md.
 *
 * Usage:
 *   npx tsx scripts/yjs-stress/two-client-convergence.ts
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
} from "./stress-utils.js";

const DOC_ID = `stress-convergence-${Date.now()}`;
const EDITS_PER_CLIENT = 1000;
const MIN_DELAY_MS = 10;
const MAX_DELAY_MS = 100;
const SETTLE_MS = 2000;

function randomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

function makeRandomEdit(doc: Y.Doc, clientId: string, editIndex: number): Uint8Array {
  const text = doc.getText("content");
  const len = text.length;
  const update = Y.encodeStateAsUpdate(doc);

  // Apply update directly to get the new update bytes
  // We capture the update via doc.on("update") pattern
  let capturedUpdate: Uint8Array | null = null;
  const handler = (upd: Uint8Array) => { capturedUpdate = upd; };
  doc.on("update", handler);

  doc.transact(() => {
    if (len === 0 || Math.random() < 0.7) {
      // Insert at random position
      const pos = len === 0 ? 0 : Math.floor(Math.random() * len);
      text.insert(pos, `[${clientId}:${editIndex}]`);
    } else {
      // Delete a small chunk
      const pos = Math.floor(Math.random() * len);
      const delLen = Math.min(5, len - pos);
      if (delLen > 0) text.delete(pos, delLen);
    }
  }, clientId);

  doc.off("update", handler);
  return capturedUpdate ?? update;
}

async function clientEditLoop(
  docId: string,
  clientId: string,
  edits: number,
  port: number,
): Promise<{ doc: Y.Doc; editsMade: number; errors: number }> {
  const client = await connectYjsClient(docId, port);
  let editsMade = 0;
  let errors = 0;

  for (let i = 0; i < edits; i++) {
    try {
      const update = makeRandomEdit(client.doc, clientId, i);
      sendYjsUpdate(client.ws, update);
      editsMade++;
    } catch (err) {
      errors++;
      console.error(`  ${clientId} edit ${i} error:`, err);
    }
    await sleep(randomDelay());
  }

  return { doc: client.doc, editsMade, errors };
}

async function runStress(): Promise<void> {
  console.log("=== two-client-convergence stress ===");
  console.log(`Doc ID: ${DOC_ID}`);
  console.log(`Edits per client: ${EDITS_PER_CLIENT}`);
  console.log(`Inter-edit delay: ${MIN_DELAY_MS}-${MAX_DELAY_MS}ms`);
  console.log(`Settle period: ${SETTLE_MS}ms`);
  console.log();

  console.log("Starting in-process Yjs stress server...");
  const server = await startStressServer();
  const port = parseInt(process.env.YJS_BENCH_PORT ?? "3099", 10);
  console.log(`Server ready on port ${port}`);
  console.log();

  const startTime = Date.now();

  console.log("Starting two client edit loops in parallel...");
  const [result1, result2] = await Promise.all([
    clientEditLoop(DOC_ID, "client-A", EDITS_PER_CLIENT, port),
    clientEditLoop(DOC_ID, "client-B", EDITS_PER_CLIENT, port),
  ]);

  console.log(`Client A: ${result1.editsMade} edits, ${result1.errors} errors`);
  console.log(`Client B: ${result2.editsMade} edits, ${result2.errors} errors`);
  console.log(`\nWaiting ${SETTLE_MS}ms for convergence...`);
  await sleep(SETTLE_MS);

  // Verify convergence by applying each client's state to the other
  const stateA = Y.encodeStateAsUpdate(result1.doc);
  const stateB = Y.encodeStateAsUpdate(result2.doc);

  // Apply A's state to B and vice versa
  const docCheck1 = new Y.Doc();
  Y.applyUpdate(docCheck1, stateA);
  Y.applyUpdate(docCheck1, stateB);

  const docCheck2 = new Y.Doc();
  Y.applyUpdate(docCheck2, stateB);
  Y.applyUpdate(docCheck2, stateA);

  const textA = docCheck1.getText("content").toString();
  const textB = docCheck2.getText("content").toString();
  const converged = textA === textB;

  // Also check that both clients have identical text after settling
  const liveTextA = result1.doc.getText("content").toString();
  const liveTextB = result2.doc.getText("content").toString();
  const liveConverged = liveTextA === liveTextB;

  const elapsed = Date.now() - startTime;

  console.log();
  console.log("=== Results ===");
  console.log(`Total time: ${elapsed}ms`);
  console.log(`State merge convergence: ${converged ? "PASS" : "FAIL"}`);
  console.log(`Live client convergence: ${liveConverged ? "PASS" : "FAIL"}`);
  console.log(`Client A text length: ${liveTextA.length}`);
  console.log(`Client B text length: ${liveTextB.length}`);

  if (!converged || !liveConverged) {
    console.error("CONVERGENCE FAILURE: Client states do not match after settling");
    if (!liveConverged) {
      console.error("  A text (first 100):", liveTextA.slice(0, 100));
      console.error("  B text (first 100):", liveTextB.slice(0, 100));
    }
  }

  const outDir = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    "../../../../docs/perf",
  );
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "yjs-convergence-results.json");

  const output = {
    bench: "yjs-two-client-convergence",
    timestamp: nowISO(),
    serverNote: "Uses in-process stress server on port 3099 due to production WS routing conflict (PluginWebSocket intercepts /ws/yjs/* with 400)",
    docId: DOC_ID,
    editsPerClient: EDITS_PER_CLIENT,
    interEditDelayMs: { min: MIN_DELAY_MS, max: MAX_DELAY_MS },
    settleMs: SETTLE_MS,
    totalElapsedMs: elapsed,
    results: {
      clientA: { editsMade: result1.editsMade, errors: result1.errors, finalTextLength: liveTextA.length },
      clientB: { editsMade: result2.editsMade, errors: result2.errors, finalTextLength: liveTextB.length },
      stateMergeConverged: converged,
      liveConverged,
    },
    passed: converged && liveConverged,
  };

  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to ${outPath}`);

  await server.close();
  process.exit(converged && liveConverged ? 0 : 1);
}

runStress().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});
