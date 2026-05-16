import { defineConfig } from "vitest/config";

// Stand-alone test project for repo-root scripts. Kept out of the root
// `vitest.config.ts` `projects` list (which covers the workspace
// packages) so it can be invoked directly from `npm run sync:check`
// pipelines without booting the server/client suites.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    root: __dirname,
  },
});
