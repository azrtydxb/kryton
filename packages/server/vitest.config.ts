import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // File-level parallelism is enabled. Every test suite uses per-suite
    // unique userIds + scoped DELETE cleanups (see helpers.ts files in
    // modules/{notes,identity,agents,knowledge}/__tests__/). Do not
    // re-introduce TRUNCATE CASCADE in any test or helper without going
    // back to fileParallelism: false — under parallelism a truncate in
    // one suite blows away rows owned by another.
    fileParallelism: true,
    // Cap concurrent forks so the self-hosted runner (shared CPU) doesn't
    // get hammered. Mirrors the client-side cap added in PR #125. 4 forks
    // matches the runner's effective core budget under the per-branch
    // concurrency block in ci.yml. Vitest 4 moved this from
    // `poolOptions.forks.maxForks` to a top-level option.
    maxWorkers: 4,
    minWorkers: 1,
    include: ["src/**/__tests__/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    // The self-hosted runner shares CPU with other workloads, so the
    // per-test fastify boot can take several seconds on a bad day. The
    // 30s envelope was tripping during contended CI runs (an 11-test
    // file finishing in 91s wall-time, one test hitting 30s). 60s is
    // generous but anything beyond that is genuinely stuck and worth
    // failing on. The per-branch concurrency block in
    // .github/workflows/ci.yml also cancels older runs for the same
    // ref so a single PR's stacked pushes can't double-load the
    // runner — different PRs can still run concurrently though.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/**/__tests__/**"],
    },
  },
});
