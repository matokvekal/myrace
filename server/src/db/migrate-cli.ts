/**
 * Command line for the schema (kept out of migrate.ts so the dist/server.js
 * bundle never contains it):
 *
 *   npm run migrate        Migrates the local PGlite dev database only
 *                          (autoMigrateAllowed); on any other database it lists
 *                          the files not applied and exits 1 if there are any.
 *   npm run check:schema   (node dist/db/migrate-cli.js --check) Read-only, on any
 *                          database: migration files recorded, required tables
 *                          present, no foreign keys. Exit 1 on any problem.
 *                          Never migrates, whatever the settings. Deployments
 *                          run it before switching to a new release.
 */
import { checkSchema, migratePool, missingMigrations } from "./migrate.js";
import { autoMigrateAllowed, closePool, pool } from "./pool.js";

const check = process.argv.includes("--check");

try {
  if (check) {
    const s = await checkSchema(pool);
    const problems = [
      ...(s.missingMigrations.length ? [`migrations not applied (run by hand, in order): ${s.missingMigrations.join(", ")}`] : []),
      ...(s.missingTables.length ? [`tables missing: ${s.missingTables.join(", ")}`] : []),
      ...(s.foreignKeys ? [`foreign keys present: ${s.foreignKeys} (policy: none; run 006)`] : []),
    ];
    if (problems.length) {
      console.error(`Schema check failed:\n  ${problems.join("\n  ")}`);
      process.exitCode = 1;
    } else console.log("Schema check passed.");
  } else if (autoMigrateAllowed()) {
    const ran = await migratePool(pool);
    console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
  } else {
    const missing = await missingMigrations(pool);
    if (missing.length) {
      console.log(`Not applied (run by hand, in this order):\n  ${missing.join("\n  ")}`);
      process.exitCode = 1;
    } else console.log("All migrations are applied.");
  }
} catch (err) {
  // pg errors carry no connection string; print only the message and code.
  const e = err as { message?: string; code?: string };
  console.error(`Cannot check the database: ${e.message ?? "unknown error"}${e.code ? ` (${e.code})` : ""}`);
  process.exitCode = 1;
} finally {
  await closePool().catch(() => {});
}
