import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    // Allow importing "../src/index.js" to resolve to "../src/index.ts" in tests
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
});
