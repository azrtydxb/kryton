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
    // per-test fastify boot can take several seconds on a bad day. 30 s
    // is an honest envelope — if a test actually does anything that
    // takes that long the timeout still flags a real bug.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/**/__tests__/**"],
    },
  },
});
