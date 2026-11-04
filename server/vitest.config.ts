import { defineConfig } from "vitest/config";

/**
 * Server tests. Never touch production data:
 *  - unit tests (no database) always run;
 *  - database tests (test/db/**) run only when TEST_DATABASE_URL points at a
 *    dedicated database whose name ends in "_test" (e.g. commissaire_test on the
 *    cloud server). Its schema is rebuilt from server/sql before the run.
 */
const withDb = !!process.env.TEST_DATABASE_URL;
export default defineConfig({
  test: {
    include: withDb ? ["test/**/*.test.ts"] : ["test/**/*.test.ts"],
    exclude: withDb ? [] : ["test/db/**"],
    setupFiles: ["test/setup-env.ts"],
    globalSetup: withDb ? ["test/db/global-setup.ts"] : [],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
