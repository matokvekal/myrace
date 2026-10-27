#!/usr/bin/env bash
# Commissaire deploy gate — the ONLY command the GitHub Actions deploy key may run.
#
# Installed once, by hand, root-owned and read-only (a release can never change it):
#   /opt/commissaire-api/                         root:commissaire 1775 (sticky: bin/ cannot be renamed)
#   /opt/commissaire-api/bin/deploy-gate.sh       root:root 0755
#   /opt/commissaire-api/bin/ecosystem.config.cjs root:root 0644
#   /opt/commissaire-api/bin/gate.conf            root:root 0644 (optional: NODE_BIN, PM2_BIN, HEALTH_URL)
# and forced for the deploy key in ~commissaire/.ssh/authorized_keys:
#   restrict,command="/opt/commissaire-api/bin/deploy-gate.sh" ssh-ed25519 AAAA... commissaire-deploy
# It runs as the commissaire user (no sudo) and accepts exactly:
#   receive <release-id> <sha256>   archive on stdin → verified → releases/<id> (read-only)
#   activate <release-id>           read-only schema check → atomic switch → PM2 → health → auto-rollback
#   rollback [release-id]           back to the previous (or named) release, with health check
#   status                          current/previous release, releases, health
# It never runs database migrations and never touches another PM2 process or user.
set -euo pipefail
umask 022

BASE="${COMMISSAIRE_DEPLOY_BASE:-/opt/commissaire-api}"
APP=commissaire-api-live
KEEP=5                                   # releases kept (current and previous always kept)
MAX_BYTES=$((200 * 1024 * 1024))         # archive size limit
ID_RE='^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,40}$'
SHA_RE='^[0-9a-f]{64}$'
NODE_BIN=node
PM2_BIN=pm2
HEALTH_URL=http://127.0.0.1:4000/api/v1/health
# shellcheck source=/dev/null
[[ -f "$BASE/bin/gate.conf" ]] && . "$BASE/bin/gate.conf"
export COMMISSAIRE_DEPLOY_BASE="$BASE" COMMISSAIRE_NODE_BIN="$NODE_BIN"

CLEANUP=()
cleanup() { local d; for d in "${CLEANUP[@]}"; do rm -rf -- "$d"; done; }
trap cleanup EXIT

log() {
  mkdir -p "$BASE/state"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$BASE/state/deploy.log" >&2
}
die() { log "ERROR: $*"; exit 1; }
usage() { die "allowed: receive <release-id> <sha256> | activate <release-id> | rollback [release-id] | status"; }
valid_id() { [[ "$1" =~ $ID_RE ]] || die "invalid release id"; }

lock() {
  mkdir -p "$BASE/state"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$BASE/state/deploy.lock"
    flock -n 9 || die "another deployment is running"
  else
    mkdir "$BASE/state/lock.d" 2>/dev/null || die "another deployment is running (if not, remove $BASE/state/lock.d)"
    CLEANUP+=("$BASE/state/lock.d")
  fi
}

# Target release id of a link (current/previous), or empty.
link_target() { [[ -L "$BASE/$1" ]] && basename "$(readlink "$BASE/$1")" || true; }
# Atomic: a new link is renamed over the old one (rename(2)).
set_link() {
  ln -sfn "releases/$2" "$BASE/.$1.tmp"
  mv -Tf "$BASE/.$1.tmp" "$BASE/$1"
}

check_node() {
  local major
  major=$("$NODE_BIN" -p 'process.versions.node.split(".")[0]') || die "node not found ($NODE_BIN)"
  (( major >= 20 )) || die "Node.js 20 or later is required (found $major)"
}

check_env() {
  local f="$BASE/shared/.env"
  [[ -f "$f" ]] || die "missing $f (production settings live only there)"
  if [[ "$(uname -s)" == Linux ]]; then
    [[ "$(stat -c %a "$f")" =~ ^[46]00$ ]] || die "$f must be mode 600"
    [[ "$(stat -c %U "$f")" == "$(id -un)" ]] || die "$f must be owned by $(id -un)"
  fi
}

schema_check() { # read-only; never migrates (dist/db/migrate-cli.js --check)
  log "read-only schema check with release $1"
  (cd "$BASE/releases/$1/server" && "$NODE_BIN" dist/db/migrate-cli.js --check) >&2
}

health() { # 30 s for {"ok":true,"release":<rev>}
  local rev=$1 i
  for i in $(seq 1 30); do
    if "$NODE_BIN" -e '
      fetch(process.argv[1]).then((r) => r.json())
        .then((j) => process.exit(j.ok === true && j.release === process.argv[2] ? 0 : 1))
        .catch(() => process.exit(1));' "$HEALTH_URL" "$rev"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Restarts only this app, from the release `current` points at. delete + start
# (not reload) so PM2 re-reads cwd, script and env from the new release.
restart_app() {
  "$PM2_BIN" delete "$APP" >/dev/null 2>&1 || true
  "$PM2_BIN" start "$BASE/bin/ecosystem.config.cjs" --only "$APP" >/dev/null
}

start_and_check() { # <release-id>
  local rev
  rev=$(<"$BASE/releases/$1/REVISION")
  restart_app && health "$rev"
}

prune() {
  local cur prev r i=0
  cur=$(link_target current)
  prev=$(link_target previous)
  while IFS= read -r r; do
    i=$((i + 1))
    (( i <= KEEP )) && continue
    [[ "$r" == "$cur" || "$r" == "$prev" ]] && continue
    chmod -R u+w -- "$BASE/releases/$r"
    rm -rf -- "${BASE:?}/releases/$r"
    log "pruned $r"
  done < <(find "$BASE/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E "$ID_RE" | sort -r)
  find "$BASE/incoming" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null || true
}

receive() {
  local id=$1 sha=$2 tmp size names bad rev f
  valid_id "$id"
  [[ "$sha" =~ $SHA_RE ]] || die "invalid sha256"
  [[ ! -e "$BASE/releases/$id" ]] || die "release $id already exists"
  mkdir -p "$BASE/incoming" "$BASE/releases"
  tmp=$(mktemp -d "$BASE/incoming/$id.XXXXXX")
  CLEANUP+=("$tmp")

  head -c $((MAX_BYTES + 1)) > "$tmp/release.tar.gz"
  size=$(stat -c %s "$tmp/release.tar.gz")
  (( size > 0 && size <= MAX_BYTES )) || die "archive size $size is outside 1..$MAX_BYTES bytes"
  echo "$sha  $tmp/release.tar.gz" | sha256sum -c --status || die "checksum mismatch: archive refused"

  # Paths: only REVISION and server/..., relative, no "..", printable.
  names=$(tar -tzf "$tmp/release.tar.gz") || die "not a gzip tar archive"
  while IFS= read -r f; do
    [[ "$f" =~ ^[[:print:]]+$ ]] || die "archive has a non-printable path"
    [[ "$f" =~ ^(\./)?(REVISION|server(/.*)?)$ ]] || die "unexpected path in archive: $f"
    [[ "$f" != /* && ! "$f" =~ (^|/)\.\.(/|$) ]] || die "unsafe path in archive: $f"
  done <<< "$names"
  # Types: regular files and directories only (no symlinks, hard links, devices).
  bad=$(tar -tvzf "$tmp/release.tar.gz" | cut -c1 | grep -v '^[-d]$' | head -n1 || true)
  [[ -z "$bad" ]] || die "archive contains links or special files"

  mkdir "$tmp/x"
  tar -xzf "$tmp/release.tar.gz" -C "$tmp/x" --no-same-owner --no-same-permissions
  rev=$(head -c 41 "$tmp/x/REVISION" 2>/dev/null | tr -d '\n') || true
  [[ "$rev" =~ ^[0-9a-f]{40}$ ]] || die "REVISION must hold the 40-character commit"
  [[ "$rev" == "${id#*-}"* ]] || die "REVISION does not match the release id"
  for f in server/package.json server/dist/server.js server/dist/db/migrate-cli.js; do
    [[ -f "$tmp/x/$f" ]] || die "release is missing $f"
  done
  [[ ! -e "$tmp/x/server/.env" ]] || die "a release must not contain server/.env"

  ln -s "$BASE/shared/.env" "$tmp/x/server/.env"     # settings stay outside the release
  chmod -R u+rwX,go+rX,go-w -- "$tmp/x"
  mv -T "$tmp/x" "$BASE/releases/$id"
  chmod -R a-w -- "$BASE/releases/$id"                # immutable
  log "received $id ($size bytes, sha256 verified)"
}

activate() {
  local id=$1 prev
  valid_id "$id"
  [[ -d "$BASE/releases/$id" ]] || die "no release $id (receive it first)"
  check_node
  check_env
  schema_check "$id" || die "schema check failed: release $id not activated, the current release keeps running. Apply the listed SQL by hand, then deploy again."
  prev=$(link_target current)
  set_link current "$id"
  log "current -> $id (was ${prev:-none})"
  if start_and_check "$id"; then
    [[ -n "$prev" && "$prev" != "$id" ]] && set_link previous "$prev"
    "$PM2_BIN" save >/dev/null 2>&1 || true
    prune
    log "activated $id"
    return 0
  fi
  log "health check failed for $id"
  if [[ -n "$prev" && "$prev" != "$id" && -d "$BASE/releases/$prev" ]]; then
    set_link current "$prev"
    if start_and_check "$prev"; then
      "$PM2_BIN" save >/dev/null 2>&1 || true
      die "activation of $id failed; automatically rolled back to $prev (healthy)"
    fi
    die "activation of $id failed and the rollback to $prev is unhealthy: check 'pm2 logs $APP'"
  fi
  "$PM2_BIN" stop "$APP" >/dev/null 2>&1 || true
  rm -f -- "$BASE/current"
  die "activation of $id failed and there is no previous release; $APP is stopped"
}

rollback() {
  local target=${1:-} cur
  cur=$(link_target current)
  if [[ -z "$target" ]]; then
    target=$(link_target previous)
    [[ -n "$target" ]] || die "no previous release recorded"
  fi
  valid_id "$target"
  [[ -d "$BASE/releases/$target" ]] || die "no release $target"
  [[ "$target" != "$cur" ]] || die "$target is already the current release"
  check_node
  check_env
  schema_check "$target" || die "schema check failed for $target: not rolled back"
  set_link current "$target"
  log "rollback: current -> $target (was ${cur:-none})"
  if start_and_check "$target"; then
    [[ -n "$cur" ]] && set_link previous "$cur"
    "$PM2_BIN" save >/dev/null 2>&1 || true
    log "rolled back to $target"
    return 0
  fi
  if [[ -n "$cur" ]]; then
    set_link current "$cur"
    start_and_check "$cur" || die "rollback to $target failed and $cur is unhealthy: check 'pm2 logs $APP'"
    die "rollback to $target failed its health check; $cur restored"
  fi
  die "rollback to $target failed its health check"
}

status() {
  echo "current:  $(link_target current)"
  echo "previous: $(link_target previous)"
  echo "releases:"
  find "$BASE/releases" -mindepth 1 -maxdepth 1 -type d -printf '  %f\n' 2>/dev/null | sort -r
  echo "health:   $("$NODE_BIN" -e 'fetch(process.argv[1]).then((r) => r.text()).then(console.log, (e) => console.log("unreachable: " + e.message))' "$HEALTH_URL")"
}

# The SSH client's command (forced-command mode), or the arguments when an admin runs it locally.
# read -a splits on whitespace without glob expansion; every argument is validated above.
read -r -a ARGS <<< "${SSH_ORIGINAL_COMMAND:-$*}"
case "${ARGS[0]:-}" in
  receive)  [[ ${#ARGS[@]} -eq 3 ]] || usage; lock; receive "${ARGS[1]}" "${ARGS[2]}" ;;
  activate) [[ ${#ARGS[@]} -eq 2 ]] || usage; lock; activate "${ARGS[1]}" ;;
  rollback) [[ ${#ARGS[@]} -le 2 ]] || usage; lock; rollback "${ARGS[1]:-}" ;;
  status)   [[ ${#ARGS[@]} -eq 1 ]] || usage; status ;;
  *)        usage ;;
esac
