import { defineConfig } from "vitest/config";

// One shared in-memory PostgreSQL (see test/global-setup.ts); files run one at a
// time in a single fork because the PGlite socket serves one connection.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
