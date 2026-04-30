import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Disable file-level parallelism to prevent SQLite BUSY lock errors
    // when multiple test files share the same better-sqlite3 database.
    fileParallelism: false,
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/**/__tests__/**"],
    },
  },
});
