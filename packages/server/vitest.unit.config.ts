import { defineConfig } from "vitest/config";

// Lightweight config for unit tests that do not need a database.
// Usage: npx vitest run --config vitest.unit.config.ts <path>
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
