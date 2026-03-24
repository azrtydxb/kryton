import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    root: "packages/server",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
