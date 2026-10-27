import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The server package folder (where server/package.json is), found upward from a
 * module. The same folder is found from the sources (src/**, tsx) and from the
 * esbuild bundles (dist/server.js, dist/db/migrate-cli.js), whose depth differs:
 * never build paths like new URL("../../x", import.meta.url).
 */
export function serverRoot(from: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(from));
  while (!existsSync(join(dir, "package.json"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("server/package.json not found above " + fileURLToPath(from));
    dir = up;
  }
  return dir;
}
