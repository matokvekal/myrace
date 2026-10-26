// Bundles the server (and the shared race model from ../src/shared) into dist/server.js.
// Packages stay external and load from node_modules at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts", "src/db/migrate.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: false,
  logLevel: "info",
});
