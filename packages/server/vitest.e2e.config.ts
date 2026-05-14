import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "server-e2e",
    environment: "node",
    // E2E specs live in packages/server/test/e2e/. Each file boots the
    // real Fastify app via the harness, so files must NOT run in
    // parallel — they'd fight over the listening port and the shared
    // Postgres test database.
    include: ["test/e2e/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["./src/test/global-setup.ts"],
    // Restart-persistence tests stop+start the app; give them headroom.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
