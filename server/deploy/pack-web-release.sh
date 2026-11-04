#!/usr/bin/env bash
# Packs the built web app (./dist) into a release archive for the Linux server,
# where Nginx serves it from /var/www/commissaire (same domain as the API).
# Run after `npm run build` (with VITE_SERVER_URL=/) at the repository root.
#
#   server/deploy/pack-web-release.sh <commit sha, 40 hex> <dist dir> <output dir>
#
# The archive holds REVISION and web/<everything in dist>: regular files and
# directories only. Prints RELEASE_ID=... and SHA256=... (GITHUB_OUTPUT format).
set -euo pipefail

sha=${1:-}
dist=${2:-}
out=${3:-}
usage() { echo "usage: pack-web-release.sh <40-hex commit sha> <dist dir> <output dir>" >&2; exit 1; }
[[ "$sha" =~ ^[0-9a-f]{40}$ && -n "$dist" && -n "$out" ]] || usage
[[ -f "$dist/index.html" && -d "$dist/assets" ]] || { echo "build the app first (npm run build)" >&2; exit 1; }

# The build must be of <sha> and contain every feature marker (no stale dist/).
repo=$(cd "$(dirname "$0")/../.." && pwd)
head=$(git -C "$repo" rev-parse HEAD)
[[ "$head" == "$sha" ]] || { echo "HEAD is $head, not $sha: build the release commit" >&2; exit 1; }
if [[ -n "$(git -C "$repo" status --porcelain -- src public index.html vite.config.ts package.json)" ]]; then
  echo "uncommitted app changes — the build would not match $sha" >&2
  exit 1
fi
newest_src=$(git -C "$repo" log -1 --format=%ct -- src public index.html)
[[ $(stat -c %Y "$dist/index.html") -ge $newest_src ]] || { echo "dist/ is older than the last source commit: rebuild it" >&2; exit 1; }
missing=0
while IFS= read -r marker; do
  [[ -z "$marker" || "$marker" == \#* ]] && continue
  grep -rqF -- "$marker" "$dist/assets" || { echo "built app is missing: $marker" >&2; missing=1; }
done < "$repo/server/deploy/web-release-markers.txt"
[[ $missing -eq 0 ]] || exit 1

id="$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/web"
cp -R "$dist/." "$stage/web/"
printf '%s\n' "$sha" > "$stage/REVISION"

if [[ -n "$(find "$stage" ! -type f ! -type d -print -quit)" ]]; then
  echo "release contains links or special files:" >&2
  find "$stage" ! -type f ! -type d >&2
  exit 1
fi

mkdir -p "$out"
tar -C "$stage" --owner=0 --group=0 --numeric-owner -czf "$out/web-$id.tar.gz" REVISION web
echo "RELEASE_ID=web-$id"
echo "SHA256=$(sha256sum "$out/web-$id.tar.gz" | cut -d' ' -f1)"
