# Performance Baselines — Kryton Server

> Generated: 2026-04-30 on MacBook Air M2 (Darwin 25.3.0, arm64).
> All numbers are real measurements on local dev hardware with SQLite.
> These are baselines for regression detection — not aspirational targets.

## Hardware

```
Darwin Pascals-MacBook-Air.local 25.3.0 Darwin Kernel Version 25.3.0:
Wed Jan 28 20:49:24 PST 2026; root:xnu-12377.81.4~5/RELEASE_ARM64_T8132 arm64
```

## Running the Benches

```bash
# Start server first (adjust DATABASE_URL to your SQLite path)
cd packages/server
DATABASE_URL="file:$(pwd)/data/kryton.db" PORT=3001 NOTES_DIR="$(pwd)/data/notes" \
  BETTER_AUTH_SECRET="local-dev-secret-change-me-in-production-at-least-32-chars" \
  APP_URL=http://localhost:5173 BETTER_AUTH_URL=http://localhost:3001 \
  WEBAUTHN_RP_ID=localhost npx tsx src/index.ts &

# Run individual benches
npm run bench:pull
npm run bench:push
npm run bench:tier2
npm run bench:attachments

# Yjs stress (no production server needed — uses in-process server on :3099)
npm run stress:yjs:converge
npm run stress:yjs:reconnect
npm run stress:yjs:rate
```

---

## 4A: Pull Throughput (`/api/sync/v2/pull`)

**Script:** `scripts/bench/pull-throughput.ts`
**Results:** `pull-throughput-results.json`

Measures pull latency (cursor=0, full sync) at increasing entity counts.
Each result JSON records p50/p95/p99 latency and total payload size.

### Baseline Measurements

| Entities in DB | p50 (ms) | p95 (ms) | p99 (ms) | Payload |
|---|---|---|---|---|
| ~4000 (n=100 seed) | 140 | 155 | 158 | 663 KB |
| ~5000 (n=1000 seed) | 162 | 165 | 168 | 816 KB |
| 5000 (seeding) | SKIPPED — rate limit | | | |

**Note:** The benches seed entities cumulatively. By the n=100 measurement, there were ~4000 entities from prior DB state. By n=1000, ~5000. These numbers reflect real DB-as-written performance, not isolated N-entity benchmarks.

### Threshold (regression alert)

- p95 > 500ms for any N: investigate DB query performance.
- Payload > 5 MB for N ≤ 5000: investigate response serialization.

### Finding: Rate Limiter Constrains Bench Depth

The server applies a `syncLimiter` of 200 requests per 15-minute window to `/api/sync/v2/*`. Seeding N=5000 entities requires ~100 batch push requests alone, combined with prior requests, exhausting the window before full measurement is possible.

**Impact:** Benches beyond N=1000 require a dedicated bench server with rate limiting disabled or a wider window.

**Not fixed here** — rate limiter is correct production behavior. Bench scripts handle 429 gracefully and skip the size.

---

## 4A: Push Throughput (`/api/sync/v2/push`)

**Script:** `scripts/bench/push-throughput.ts`
**Results:** `push-throughput-results.json`

Measures push latency for creates and updates with varying version-skew.

### Baseline Measurements

| Scenario | p50 (ms) | p95 (ms) | Accepted | Conflicts | Conflict Rate |
|---|---|---|---|---|---|
| Create burst (1 note/req) | 3.6 | 13.2 | 20/20 | 0 | 0% |
| Update, skew=0 (current version) | 2.3 | 2.7 | 20/20 | 0 | 0% |
| Update, skew=1 (1 behind) | 1.2 | 1.6 | 0/20 | 20 | 100% |
| Update, skew=3 (3 behind) | 1.0 | 2.7 | 0/20 | 20 | 100% |
| Update, skew=5 | SKIPPED — rate limit | | | | |

### Finding: Conflict Detection Is Strict

Any version skew (even 1 behind) produces 100% conflict rate. This is correct per-spec: the server uses exact version matching. Conflict responses are fast (~1ms) because no write occurs.

### Threshold (regression alert)

- Create p95 > 50ms: investigate DB write path.
- Conflict response p95 > 10ms: investigate DB read path.

---

## 4A: Tier-2 History (`/api/sync/v2/tier2/history/:notePath`)

**Script:** `scripts/bench/tier2-history.ts`
**Results:** `tier2-history-results.json`

### Finding: NoteRevision Table Not Written by Production Code

The `NoteRevision` table is queried by `/api/sync/v2/tier2/history/:notePath` but is **never written** by any production code path:

- `sync v2 push` writes `NoteVersion` (sync cursor) and `SearchIndex` (search), NOT `NoteRevision`.
- `noteService.ts` saves filesystem snapshots to `.history/` directory, NOT the DB.
- The only code that creates `NoteRevision` rows is the test suite (direct DB insert).

This means the tier2/history endpoint **always returns 0 rows** in a live system. The bench seeds rows directly via better-sqlite3 to measure what latency WOULD be.

### Baseline Measurements (synthetic rows, directly seeded)

| Revisions | Cold p50 (ms) | Cold p95 (ms) | Warm p50 (ms) | Warm p95 (ms) | Rows Returned |
|---|---|---|---|---|---|
| 10 | 2.5 | 6.9 | 1.5 | 2.0 | 10 |
| 100 | 1.5 | 1.7 | 1.3 | 1.7 | 100 |
| 1000 | 1.6 | 2.0 | 1.6 | 8.3 | 200 (limit) |

The endpoint limits response to 200 rows (`limit=200`). At 1000 stored revisions, only 200 are returned.

### Threshold (regression alert)

- p95 > 50ms at any tested revision count: investigate query plan.

---

## 4A: Attachments (`/api/attachments`)

**Script:** `scripts/bench/attachments.ts`
**Results:** `attachments-results.json`

Upload + download round-trip latency. All measurements are local filesystem I/O.

### Baseline Measurements

| Size | Upload p95 (ms) | Download p95 (ms) | Round-trip p95 (ms) |
|---|---|---|---|
| 1 KB | 3.0 | 2.1 | 5.1 |
| 100 KB | 2.0 | 1.3 | 3.3 |
| 10 MB | 20.2 | 12.7 | 31.9 |

### Finding: 50 MB Upload Returns 500, Not 413

Multer is configured with `limits: { fileSize: 50 * 1024 * 1024 }`. When a file exceeds this limit, multer emits an error, but the Express error handler in `attachments.ts` catches it as a generic 500 rather than a 413 Payload Too Large.

**Actual behavior:** POST /api/attachments with 50 MB + 1 byte → HTTP 500.
**Expected behavior:** HTTP 413.

**Not fixed here** — this needs a dedicated multer error handler in `src/routes/attachments.ts` that checks `err.code === 'LIMIT_FILE_SIZE'`. Tracked as a finding.

### Threshold (regression alert)

- Upload p95 > 100ms for 1 KB or 100 KB: investigate middleware overhead.
- Round-trip p95 > 500ms for 10 MB: investigate filesystem performance.

---

## 4B: Yjs Two-Client Convergence

**Script:** `scripts/yjs-stress/two-client-convergence.ts`
**Results:** `yjs-convergence-results.json`

### Configuration

- 2 clients, 1000 edits each, 10–100ms inter-edit delay
- Settle period: 2000ms after all edits complete

### Result

| Metric | Value |
|---|---|
| Total edits (A + B) | 2000 |
| Client A errors | 0 |
| Client B errors | 0 |
| State merge convergence | **PASS** |
| Live client convergence | **PASS** |
| Client A final text length | 17,191 chars |
| Client B final text length | 17,191 chars |
| Total time | ~62 seconds |

### Finding: Production WS Routing Conflict

The stress tests use an **in-process server on port 3099**, NOT the production server. The production server has a WebSocket routing bug:

`PluginWebSocket` is constructed with `{server: httpServer, path: "/ws/plugins"}`. The `ws` library registers a listener on `httpServer.on("upgrade", ...)`. For upgrade requests to paths that don't match `/ws/plugins`, the `ws` library's `handleUpgrade` calls `shouldHandle(req)` → returns `false` → calls `abortHandshake(socket, 400)`. The socket is destroyed before Yjs's `httpServer.on("upgrade", ...)` listener runs.

**Result:** All WebSocket upgrade requests to `/ws/yjs/*` receive HTTP 400 from the production server.

**Fix required (not done in this stream):** Change `PluginWebSocket` to `noServer: true` mode and manually call `wss.handleUpgrade` only for `/ws/plugins`, letting other upgrade events pass through.

---

## 4B: Yjs Reconnect Storm

**Script:** `scripts/yjs-stress/reconnect-storm.ts`
**Results:** `yjs-reconnect-results.json`

### Configuration

- 100 offline edits accumulated in a fresh Y.Doc
- Reconnect and flush all updates via WS
- Observer connects separately to verify

### Result

| Metric | Value |
|---|---|
| Offline edits accumulated | 100 |
| Edit markers seen by observer | 100 |
| Missing edits | 0 |
| All edits present | **PASS** |
| Text matches offline doc | **PASS** |

---

## 4B: Yjs Op-Rate Ceiling

**Script:** `scripts/yjs-stress/op-rate-ceiling.ts`
**Results:** `yjs-op-rate-results.json`

### Configuration

- Single client, 30 seconds per rate
- Rates tested: 200 ops/sec, 500 ops/sec

### Result

| Rate (ops/sec) | Achieved (ops/sec) | Throughput % | Errors | Disconnects | Status |
|---|---|---|---|---|---|
| 200 | 200 | 100% | 0 | 0 | **PASS** |
| 500 | 500 | 100% | 0 | 0 | **PASS** |

The in-process Yjs server (SQLite-free, in-memory only) handles 500 ops/sec without backpressure. The production server with SQLite persistence would have lower throughput (each update triggers `appendYjsUpdate` via Prisma).

### Threshold (regression alert)

- Achieved < 80% of 200 ops/sec target: investigate WS message processing path.
- Errors > 10 at 500 ops/sec: investigate memory or event loop saturation.

---

## Summary of Findings

| # | Finding | Severity | Fix Required |
|---|---|---|---|
| 1 | Sync rate limiter (200 req/15min) prevents bench from seeding N≥5000 | Low | Separate bench flag to disable limiter |
| 2 | NoteRevision table is never written by production code | Medium | Wire `noteService.ts` to write DB rows on save |
| 3 | 50 MB attachment upload returns 500 instead of 413 | Medium | Add LIMIT_FILE_SIZE handler in attachments route |
| 4 | Production WS routing conflict: /ws/yjs/* returns 400 | High | Fix PluginWebSocket to noServer mode |
| 5 | Pull at n=1000 cumulative: p95 = 165ms on dev hardware | Info | Baseline — acceptable for local SQLite |

All findings are documented only. No fixes applied in this stream per phase 4 scope.
