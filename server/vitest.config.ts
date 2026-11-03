import { defineConfig } from "vitest/config";

// Unit tests only. Commissaire uses the cloud PostgreSQL database exclusively,
// and tests must never write to it, so there are no database tests here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
