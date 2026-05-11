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
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/**/__tests__/**"],
    },
  },
});
