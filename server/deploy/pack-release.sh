#!/usr/bin/env bash
# Packs the built server into an immutable release archive for deploy-gate.sh.
# Run in CI after `npm ci` in server/ (dev dependencies are needed to build).
# It REBUILDS dist/ from the committed source itself (never packs an old build),
# refuses a working tree that differs from <sha> in server/ or src/shared/, and
# checks the bundle for every line of deploy/release-markers.txt.
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
repo=$(cd "$server/.." && pwd)

# The source must be exactly <sha>: REVISION has to describe what is inside.
head=$(git -C "$repo" rev-parse HEAD)
[[ "$head" == "$sha" ]] || { echo "HEAD is $head, not $sha: check out the release commit first" >&2; exit 1; }
if [[ -n "$(git -C "$repo" status --porcelain -- server src/shared)" ]]; then
  echo "uncommitted changes in server/ or src/shared/ — commit them or stash them first:" >&2
  git -C "$repo" status --short -- server src/shared >&2
  exit 1
fi

# Clean build from that source (a stale dist/ shipped once: 0.1.12).
rm -rf "$server/dist"
(cd "$server" && npm run build) >&2
[[ -f "$server/dist/server.js" && -f "$server/dist/db/migrate-cli.js" ]] || { echo "server build produced no dist/server.js" >&2; exit 1; }
missing=0
while IFS= read -r marker; do
  [[ -z "$marker" || "$marker" == \#* ]] && continue
  grep -qF -- "$marker" "$server/dist/server.js" || { echo "compiled server is missing: $marker" >&2; missing=1; }
done < "$server/deploy/release-markers.txt"
[[ $missing -eq 0 ]] || exit 1

id="$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/server"
cp -R "$server/dist" "$server/sql" "$server/package.json" "$server/package-lock.json" "$stage/server/"
# Production dependencies only; no install scripts; no .bin symlinks (the gate refuses links).
# Its output goes to stderr: stdout is GITHUB_OUTPUT, where "added N packages" is invalid.
(cd "$stage/server" && npm ci --omit=dev --ignore-scripts --no-bin-links --no-audit --no-fund --loglevel=error) >&2
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
