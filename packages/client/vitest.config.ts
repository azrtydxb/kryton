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
    // jsdom + react-testing-library setup, plus the heavier
    // integration-shaped tests (HttpAdapter, Yjs adapter wiring) take
    // several seconds under CI contention. The default 5s timeout
    // tripped on slower runner conditions; 30s matches the server
    // envelope and is well past anything a healthy test should take.
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
