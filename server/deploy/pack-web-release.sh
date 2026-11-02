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
