import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Disable file-level parallelism so the shared Postgres test database
    // (booted in global-setup) isn't hammered by concurrent test suites.
    fileParallelism: false,
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
