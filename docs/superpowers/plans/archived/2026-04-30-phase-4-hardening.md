# Phase 4 — Hardening Plan (Realistic Scope)

> **For agentic workers:** Use `superpowers:executing-plans` (most tasks) or `superpowers:subagent-driven-development` (parallelizable suites). Steps use checkbox (`- [ ]`).

**Goal:** Move the v4.4 architecture from "working in dev" to "production-ready" by closing real verification gaps. This is NOT a feature plan — it's a verification + tuning plan with explicit honesty about what can be automated vs. what needs hands-on.

**Status of phases 0-3:** complete on master. 229 unit/integration tests green. Server smokes cleanly on local. Mobile typechecks. `@azrtydxb/core@4.4.0-pre.5` and `@azrtydxb/core-react@4.4.0-pre.5` published.

---

## What Phase 4 *cannot* automate (handing off to operator)

These tasks REQUIRE a person at a keyboard with simulator/device access. Listing them so the gap is explicit; do them in parallel with the automated work below.

| Task | Tool | Why not automatable here |
|---|---|---|
| iOS simulator smoke (login → notes → edit → sync) | Xcode + Expo Dev Client | Needs simulator binary, not CI |
| Android device smoke | Android Studio + Expo | Same |
| Live multi-client Yjs convergence | 2 devices/browsers logged in as same user | Real-time presence is felt, not asserted |
| Production deployment dry run | hosting platform | Requires platform-specific config not in repo |
| Real user data volume profiling | actual notes corpus | Synthetic data hides the slow paths |

The plan below covers the work that *can* land via tests + tooling without manual smoke.

---

## Streams

| Stream | Goal | Files | Parallelizable? |
|---|---|---|---|
| 4A | Server load + perf benchmarks | `packages/server/scripts/bench/**`, results in `docs/perf/` | yes (independent) |
| 4B | Yjs websocket stress test | `packages/server/scripts/yjs-stress/**` | yes |
| 4C | Sync protocol fuzzer + invariant tests | `packages/server/src/__tests__/fuzz/**` | yes |
| 4D | Migration verification (production-shaped data) | `packages/server/scripts/migration-verify.ts` | sequential after 4A-4C |
| 4E | Documentation refresh | `kryton/README.md`, `kryton-mobile/README.md`, ADRs in `docs/superpowers/adrs/` | yes |
| 4F | Deprecation removal: legacy `/api/sync` | `packages/server/src/routes/sync.ts`, mounting | sequential, last |

---

## Stream 4A — Server load + perf benchmarks

Goal: numerical baselines for the sync endpoints under realistic load. We need numbers in `docs/perf/` so future regressions are visible.

### Task 4A-1: Pull-throughput bench

**Files:** Create `packages/server/scripts/bench/pull-throughput.ts`.

- [ ] **Step 1:** Write a script that:
  1. Connects to a local server with a test user.
  2. Pre-seeds N folders + N tags + N notes (configurable).
  3. Calls `/api/sync/v2/pull` with `cursor=0` repeatedly.
  4. Measures p50/p95/p99 latency and total throughput at N=100, 1000, 5000, 10000.

```ts
// packages/server/scripts/bench/pull-throughput.ts
import { performance } from "node:perf_hooks";

interface Result { n: number; p50: number; p95: number; p99: number; mean: number; }

async function bench(serverUrl: string, token: string, n: number, iterations = 50): Promise<Result> {
  const latencies: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const res = await fetch(`${serverUrl}/api/sync/v2/pull`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cursor: "0" }),
    });
    if (!res.ok) throw new Error(`pull ${res.status}`);
    await res.json();
    latencies.push(performance.now() - start);
  }
  latencies.sort((a, b) => a - b);
  return {
    n,
    p50: latencies[Math.floor(iterations * 0.5)]!,
    p95: latencies[Math.floor(iterations * 0.95)]!,
    p99: latencies[Math.floor(iterations * 0.99)]!,
    mean: latencies.reduce((a, b) => a + b, 0) / iterations,
  };
}

// ... seed helpers (createNotes, createFolders) using existing API
// ... write JSON results to docs/perf/pull-throughput-<date>.json
```

- [ ] **Step 2:** Add to `packages/server/package.json`: `"bench:pull": "tsx scripts/bench/pull-throughput.ts"`.

- [ ] **Step 3:** Document baseline thresholds in `docs/perf/README.md` (e.g., "p95 < 500ms for n=1000 on dev hardware"). These thresholds must come from a real first run, not invented.

- [ ] **Step 4:** Commit.

### Task 4A-2: Push-throughput + conflict-rate bench

Same shape as 4A-1 but POSTs to `/api/sync/v2/push` with mixed creates/updates. Track conflict rate at varying base_version skew.

### Task 4A-3: Tier 2 fetch latency (history)

Seed a note with N revisions, measure `/api/sync/v2/tier2/history/:notePath` cold-fetch latency at N = 10, 100, 1000, 10000.

### Task 4A-4: Attachment upload + download

Measure single-request attachment round-trip at sizes 1KB, 100KB, 10MB. Confirm 50MB cap returns 413.

---

## Stream 4B — Yjs websocket stress

Goal: prove the websocket layer survives real edit pressure.

### Task 4B-1: Two-client convergence harness

**Files:** Create `packages/server/scripts/yjs-stress/two-client-convergence.ts`.

- [ ] Two `WebSocket` clients connect to `/ws/yjs/:docId`. Each makes 1000 random edits with realistic timing (10ms–500ms inter-edit). After settle period, both clients' Y.Doc states must match. Assertion: `Y.encodeStateAsUpdate(c1)` === `Y.encodeStateAsUpdate(c2)`.

### Task 4B-2: Reconnect-with-pending storm

- [ ] Client A makes 100 edits offline (queued in `yjs_pending_updates`). Reconnect. Verify all 100 land server-side without loss; verify other clients see them.

### Task 4B-3: Op rate ceiling

- [ ] Single client emits 200 ops/sec for 30 seconds. Server logs should show no backpressure errors. Then 500 ops/sec — server should rate-limit. Confirm the close code documented in the spec.

---

## Stream 4C — Sync protocol fuzzer + invariants

Goal: catch protocol-violation classes that unit tests miss.

### Task 4C-1: Pull/push fuzzer

**Files:** `packages/server/src/__tests__/fuzz/sync-fuzzer.test.ts`.

- [ ] Generates random sequences of pull/push operations across 5 simulated clients sharing a user. Asserts:
  - **Eventual consistency:** after all operations, every client's local DB equals the server's pull from cursor 0.
  - **No lost updates:** every accepted push appears in some pull.
  - **No silent overwrites:** any version-conflict response was returned to the actual loser.

Use `fast-check` for property-based generation.

### Task 4C-2: Cedar permission fuzzer

- [ ] Generate random Cedar policies + random agent requests. Assert: every "Allow" response means the policy actually permits, every "Deny" means it explicitly forbids. Catches policy parser regressions.

---

## Stream 4D — Migration verification (production-shaped)

Goal: prove the Prisma migration applies to a database that resembles production.

### Task 4D-1: Synthetic production-shape DB

**Files:** `packages/server/scripts/migration-verify.ts`.

- [ ] Provision a fresh SQLite DB on the previous schema (pre-sync_v2 migration). Seed it: 10 users × 1000 notes × 50 settings × 30 graph edges × 20 shares × 100 trash items = ~roughly the shape we expect.
- [ ] Apply `prisma migrate deploy`. Assert: no data loss, all foreign keys resolve, version columns default to 0, cursor columns default to 0.
- [ ] Run a full pull as each user; assert response shape and counts match seeded data.

### Task 4D-2: Backfill verification

- [ ] After migration + first sync, the folder backfill must populate Folder rows for every directory in `data/notes/<userId>/`. Tag backfill must populate Tag + NoteTag rows for every tag in SearchIndex. Verify counts.

---

## Stream 4E — Documentation refresh

Goal: README and ADRs reflect the v4.4 architecture, not the v4.3 one.

### Task 4E-1: kryton/README.md update

- [ ] Replace mobile-app section to reference the separate repo.
- [ ] Add a "Sync v2" section describing the architecture (cursor-based, per-row versioning, Yjs for content, Cedar for agents).
- [ ] Update endpoint table (legacy `/api/sync` deprecated; `/api/sync/v2/*` primary).
- [ ] Document `@azrtydxb/core` consumption for desktop sub-project (forward-looking).

### Task 4E-2: kryton-mobile/README.md update

- [ ] Document migration story (legacy → core-react).
- [ ] Document `dev:link` and `.npmrc` workflow.
- [ ] List required dev env vars (`GITHUB_TOKEN`).

### Task 4E-3: ADRs

- [ ] Write one ADR per major decision made during phases 0-3:
  - ADR-001: Scope name `@azrtydxb` (org-owned packages on GitHub Packages).
  - ADR-002: Per-row versioning + global cursor for sync deltas.
  - ADR-003: Yjs for note content, relational sync for everything else.
  - ADR-004: Cedar policies for first-class agent identity.
  - ADR-005: Schema generated from Prisma annotations.
  - ADR-006: NPM_PUBLISH_TOKEN PAT instead of GITHUB_TOKEN.

Each ADR ~250 words: context, decision, consequences. Save to `docs/superpowers/adrs/ADR-NNN-<topic>.md`.

---

## Stream 4F — Deprecation removal: legacy `/api/sync`

**Sequencing:** This MUST be the very last stream. Only run after stream 4D is green AND mobile has been hands-on smoke-tested on a real device.

### Task 4F-1: Deprecate-then-delete

- [ ] **Step 1:** Add a console warning to `/api/sync/pull` and `/api/sync/push` handlers logging "DEPRECATED: client is using legacy sync; upgrade to v2".
- [ ] **Step 2:** Cut a `4.4.0` final release. Operator runs the deprecated server in production for 1 week to confirm no clients still hit the legacy endpoints.
- [ ] **Step 3:** Delete `packages/server/src/routes/sync.ts` and the mount line in `index.ts`. Remove the legacy notes from `MIGRATIONS.md`.
- [ ] **Step 4:** Cut `4.5.0`.

---

## Phase 4 gate

- [ ] All bench results committed to `docs/perf/` with non-fabricated numbers.
- [ ] All fuzzer suites pass at least 1000 generated cases each.
- [ ] Migration verification completes against a 10-user / 10k-note synthetic DB.
- [ ] README + ADRs reflect current architecture.
- [ ] Operator confirms hands-on smoke (per the table at top).
- [ ] Legacy `/api/sync` either documented as deprecated (not yet removed) or fully removed.

---

## Realistic time estimate

| Stream | Engineer-hours |
|---|---|
| 4A perf benches | 4-6h |
| 4B Yjs stress | 6-8h |
| 4C fuzzers | 8-10h |
| 4D migration verify | 4-6h |
| 4E docs + ADRs | 6-8h |
| 4F deprecation cycle | 1h tooling + 1 week soak |
| **Total** | **~30-40h + soak** |

Realistic: this is a week of focused work for one engineer, or 2-3 days with parallel agents. Soak time is real wall-clock.

---

## Out of scope for this plan

- Desktop sub-project (3) — separate plan when ready.
- WebView CodeMirror+Yjs bundler (mobile follow-up) — separate plan.
- Real-time tier 1 push via websocket — explicitly punted in the spec.
- Public release of `@azrtydxb/*` to npm.org — punted.
- E2E mobile via Detox — needs simulator runner not present here; left for operator.
