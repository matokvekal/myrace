#!/usr/bin/env bash
# Packs the built server into an immutable release archive for deploy-gate.sh.
# Run in CI after `npm ci && npm run build` in server/.
#
#   server/deploy/pack-release.sh <commit sha, 40 hex> <output dir>
#
# The archive holds REVISION and server/{dist,sql,package.json,package-lock.json,
# node_modules (production only)}: regular files and directories only, never
# server/.env. Prints RELEASE_ID=... and SHA256=... (GITHUB_OUTPUT format).
set -euo pipefail

sha=${1:-}
out=${2:-}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: pack-release.sh <40-hex commit sha> <output dir>" >&2; exit 1; }
[[ -n "$out" ]] || { echo "usage: pack-release.sh <40-hex commit sha> <output dir>" >&2; exit 1; }
server=$(cd "$(dirname "$0")/.." && pwd)
[[ -f "$server/dist/server.js" && -f "$server/dist/db/migrate-cli.js" ]] || { echo "build the server first (npm run build)" >&2; exit 1; }

id="$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/server"
cp -R "$server/dist" "$server/sql" "$server/package.json" "$server/package-lock.json" "$stage/server/"
# Production dependencies only; no install scripts; no .bin symlinks (the gate refuses links).
(cd "$stage/server" && npm ci --omit=dev --ignore-scripts --no-bin-links --no-audit --no-fund --loglevel=error)
printf '%s\n' "$sha" > "$stage/REVISION"

if [[ -n "$(find "$stage" ! -type f ! -type d -print -quit)" ]]; then
  echo "release contains links or special files:" >&2
  find "$stage" ! -type f ! -type d >&2
  exit 1
fi

mkdir -p "$out"
tar -C "$stage" --owner=0 --group=0 --numeric-owner -czf "$out/$id.tar.gz" REVISION server
echo "RELEASE_ID=$id"
echo "SHA256=$(sha256sum "$out/$id.tar.gz" | cut -d' ' -f1)"
