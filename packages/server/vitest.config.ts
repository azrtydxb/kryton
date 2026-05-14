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
    // Default 5 s per test is borderline on the self-hosted runner —
    // first-test-per-file pays node-import + fastify boot (~3-5 s) on a
    // contended box and was tipping into timeouts. 20 s is the real
    // budget for the slow boot; assertions inside still need to be fast.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/**/__tests__/**"],
    },
  },
});
