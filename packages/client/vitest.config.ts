import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
    // The self-hosted CI runner has limited CPU headroom; spawning one
    // worker per core was triggering "Timeout waiting for worker to
    // respond" failures because every fork was contending. Cap forks
    // to a small number so the runner doesn't saturate.
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
    },
    // Same justification as packages/server/vitest.config.ts — fastify
    // boot inside jsdom tests can take several seconds under load. 30s
    // is the honest envelope.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/__tests__/**"],
    },
  },
});
