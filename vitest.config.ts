import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Fast unit + integration tests (jsdom). Browser E2E stays in Playwright (tests/).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src/app") } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/app/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: { include: [/.+/], modules: { classNameStrategy: "non-scoped" } },
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      include: [
        "src/app/utils/**",
        "src/shared/**",
        "src/app/stores/**",
        "src/app/services/riderRowMapper.ts",
        "src/app/race/[[]id]/raceMode/**",
        "src/app/race/[[]id]/schedule/Schedule.tsx",
        "src/app/race/[[]id]/heat/**/useLapRecording.ts",
      ],
      exclude: ["**/*.test.*", "**/*.module.css"],
    },
  },
});
