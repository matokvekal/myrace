#!/usr/bin/env bash
# End-to-end test of deploy-gate.sh on Linux (CI): real releases packed by
# pack-release.sh, a throwaway in-memory PostgreSQL, the real dist/server.js,
# and a stand-in for pm2. Covers receive (incl. refused archives), activate,
# automatic rollback on a failed health check, manual rollback, the read-only
# schema check, and status. Run from server/ after `npm ci && npm run build`:
#   bash deploy/test/gate-e2e.sh
set -euo pipefail

[[ "$(uname -s)" == Linux ]] || { echo "gate-e2e: Linux only (symlinks, permissions); skipped"; exit 0; }
server=$(cd "$(dirname "$0")/../.." && pwd)
cd "$server"

T=$(mktemp -d)
BASE="$T/base"
PIDS=()
finish() {
  local p
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  [[ -f "$T/api.pid" ]] && kill "$(cat "$T/api.pid")" 2>/dev/null || true
  chmod -R u+w "$T" 2>/dev/null || true
  rm -rf "$T"
}
trap finish EXIT

pass() { echo "ok - $*"; }
fail() { echo "FAIL - $*" >&2; [[ -f "$BASE/state/deploy.log" ]] && tail -n 20 "$BASE/state/deploy.log" >&2; [[ -f "$T/api.log" ]] && tail -n 20 "$T/api.log" >&2; exit 1; }
gate() { SSH_ORIGINAL_COMMAND="$*" "$BASE/bin/deploy-gate.sh"; }
refused() { # <stdin file> <command...>: must fail
  local input=$1; shift
  if gate "$@" < "$input" > "$T/out" 2>&1; then fail "accepted: $*"; fi
}
free_port() { node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
db() { # <full|recorded-only> → URL
  node --import tsx test/support/pg-server.ts "$1" < <(sleep 100000) > "$T/db-$1.out" 2>&1 &
  PIDS+=($!)
  local i
  for i in $(seq 1 60); do
    if grep -q '^PORT ' "$T/db-$1.out"; then echo "postgresql://postgres:postgres@127.0.0.1:$(awk '/^PORT /{print $2}' "$T/db-$1.out")/postgres"; return; fi
    sleep 0.5
  done
  cat "$T/db-$1.out" >&2; fail "test database did not start"
}
health_release() { node -e 'fetch(process.argv[1]).then(r=>r.json()).then(j=>console.log(j.release),()=>console.log("down"))' "http://127.0.0.1:$API_PORT/api/v1/health"; }

# --- Layout as on the server -------------------------------------------------
mkdir -p "$BASE/bin" "$BASE/shared"
cp deploy/deploy-gate.sh deploy/ecosystem.config.cjs "$BASE/bin/"
chmod 0755 "$BASE/bin/deploy-gate.sh"
API_PORT=$(free_port)
FULL=$(db full)
BROKEN=$(db recorded-only)
write_env() {
  cat > "$BASE/shared/.env" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$API_PORT
DATABASE_URL=$1
DB_POOL_MAX=1
JWT_ACCESS_SECRET=gate-e2e-secret-0123456789abcdefghijklmn
LOG_LEVEL=info
EOF
  chmod 600 "$BASE/shared/.env"
}
write_env "$FULL"

# pm2 stand-in: start/delete/stop/save for one app, from the real ecosystem file.
cat > "$T/pm2" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
T=$(dirname "$0")
case "$1" in
  start)
    eval "$(node -e '
      const a = require(process.argv[1]).apps[0];
      const q = (s) => "\x27" + String(s).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
      console.log(`cwd=${q(a.cwd)} script=${q(a.script)} release=${q(a.env.COMMISSAIRE_RELEASE)}`);' "$2")"
    cd "$cwd"
    COMMISSAIRE_RELEASE="$release" nohup node "$script" >> "$T/api.log" 2>&1 &
    echo $! > "$T/api.pid"
    ;;
  delete|stop)
    if [[ -f "$T/api.pid" ]]; then kill "$(cat "$T/api.pid")" 2>/dev/null || true; rm -f "$T/api.pid"; sleep 0.5; fi
    ;;
  save) ;;
  *) echo "pm2 stand-in: unsupported $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$T/pm2"
cat > "$BASE/bin/gate.conf" <<EOF
NODE_BIN=$(command -v node)
PM2_BIN=$T/pm2
HEALTH_URL=http://127.0.0.1:$API_PORT/api/v1/health
EOF

# --- Releases -------------------------------------------------------------------
pack() { # <40-hex sha> → "id sha256"
  local o
  o=$(bash deploy/pack-release.sh "$1" "$T/out-$1")
  echo "$(sed -n 's/^RELEASE_ID=//p' <<< "$o") $(sed -n 's/^SHA256=//p' <<< "$o")"
}
SHA_A=$(printf 'a%.0s' {1..40}); read -r ID_A SUM_A <<< "$(pack "$SHA_A")"; sleep 1
SHA_B=$(printf 'b%.0s' {1..40}); read -r ID_B SUM_B <<< "$(pack "$SHA_B")"; sleep 1
SHA_C=$(printf 'c%.0s' {1..40}); read -r ID_C _ <<< "$(pack "$SHA_C")"
# C: a release that crashes on start (bad build) → must be rolled back automatically.
mkdir "$T/c" && tar -xzf "$T/out-$SHA_C/$ID_C.tar.gz" -C "$T/c"
echo 'process.exit(1);' > "$T/c/server/dist/server.js"
tar -C "$T/c" -czf "$T/c.tar.gz" REVISION server
SUM_C=$(sha256sum "$T/c.tar.gz" | cut -d' ' -f1)

# --- Refused input ------------------------------------------------------------------
refused /dev/null bash -c id;                                     pass "unknown command refused"
refused /dev/null "activate ../../etc";                           pass "path in release id refused"
refused "$T/out-$SHA_A/$ID_A.tar.gz" receive "$ID_A" "$(printf '0%.0s' {1..64})"; pass "checksum mismatch refused"
[[ ! -e "$BASE/releases/$ID_A" ]] || fail "refused archive left a release"
evil() { # <name> <setup in $T/evil-<name>> → archive path; sha
  tar -C "$T/evil-$1" -czf "$T/evil-$1.tar.gz" "${@:2}"
  sha256sum "$T/evil-$1.tar.gz" | cut -d' ' -f1
}
mkdir -p "$T/evil-dots/server" && printf '%s\n' "$SHA_A" > "$T/evil-dots/REVISION" && echo x > "$T/evil-dots/x"
s=$(evil dots --transform 's,^x$,server/../../x,' REVISION server x)
tar -tzf "$T/evil-dots.tar.gz" | grep -q '\.\./' || fail "test archive has no '..' member"
refused "$T/evil-dots.tar.gz" receive "20260101T000000Z-${SHA_A:0:12}" "$s"; pass "'..' path refused"
mkdir -p "$T/evil-link/server" && printf '%s\n' "$SHA_A" > "$T/evil-link/REVISION" && ln -s /etc/passwd "$T/evil-link/server/passwd"
s=$(evil link REVISION server)
refused "$T/evil-link.tar.gz" receive "20260101T000001Z-${SHA_A:0:12}" "$s"; pass "symlink refused"
mkdir -p "$T/evil-env" && tar -xzf "$T/out-$SHA_A/$ID_A.tar.gz" -C "$T/evil-env" && echo "X=1" > "$T/evil-env/server/.env"
s=$(evil env REVISION server)
refused "$T/evil-env.tar.gz" receive "20260101T000002Z-${SHA_A:0:12}" "$s"; pass "server/.env in archive refused"
mkdir -p "$T/evil-other" && printf '%s\n' "$SHA_A" > "$T/evil-other/REVISION" && echo x > "$T/evil-other/run.sh"
s=$(evil other REVISION run.sh)
refused "$T/evil-other.tar.gz" receive "20260101T000003Z-${SHA_A:0:12}" "$s"; pass "path outside server/ refused"
refused "$T/out-$SHA_A/$ID_A.tar.gz" receive "20260101T000004Z-${SHA_B:0:12}" "$SUM_A"; pass "REVISION/id mismatch refused"

# --- Receive and activate A (first deployment) -------------------------------------
gate receive "$ID_A" "$SUM_A" < "$T/out-$SHA_A/$ID_A.tar.gz" || fail "receive A"
[[ -L "$BASE/releases/$ID_A/server/.env" && "$(readlink "$BASE/releases/$ID_A/server/.env")" == "$BASE/shared/.env" ]] || fail ".env link"
if touch "$BASE/releases/$ID_A/server/x" 2>/dev/null; then fail "release is writable"; fi
pass "A received: verified, read-only, .env linked to shared/"
refused "$T/out-$SHA_A/$ID_A.tar.gz" receive "$ID_A" "$SUM_A"; pass "existing release never overwritten"
gate activate "$ID_A" || fail "activate A"
[[ "$(health_release)" == "$SHA_A" && "$(readlink "$BASE/current")" == "releases/$ID_A" ]] || fail "A not serving"
pass "A active and healthy"

# --- B, then a schema problem blocks activation ------------------------------------
gate receive "$ID_B" "$SUM_B" < "$T/out-$SHA_B/$ID_B.tar.gz" || fail "receive B"
write_env "$BROKEN"
refused /dev/null activate "$ID_B"
grep -q "tables missing" "$T/out" || fail "schema check message"
[[ "$(readlink "$BASE/current")" == "releases/$ID_A" && "$(health_release)" == "$SHA_A" ]] || fail "current changed after a failed schema check"
pass "schema check failure: not activated, A keeps running"
write_env "$FULL"
gate activate "$ID_B" || fail "activate B"
[[ "$(health_release)" == "$SHA_B" && "$(readlink "$BASE/previous")" == "releases/$ID_A" ]] || fail "B not serving / previous"
pass "B active, previous = A"

# --- C fails its health check → automatic rollback to B ----------------------------
gate receive "$ID_C" "$SUM_C" < "$T/c.tar.gz" || fail "receive C"
refused /dev/null activate "$ID_C"
grep -q "automatically rolled back to $ID_B" "$T/out" || fail "rollback message"
[[ "$(readlink "$BASE/current")" == "releases/$ID_B" && "$(health_release)" == "$SHA_B" ]] || fail "not rolled back to B"
pass "C unhealthy: automatically rolled back to B"

# --- Manual rollback to the previous release (A) -----------------------------------
gate rollback || fail "rollback"
[[ "$(readlink "$BASE/current")" == "releases/$ID_A" && "$(readlink "$BASE/previous")" == "releases/$ID_B" && "$(health_release)" == "$SHA_A" ]] || fail "rollback state"
pass "rollback: A current, B previous"
gate status > "$T/status" 2>&1 || fail "status"
grep -q "current:  $ID_A" "$T/status" || fail "status output"
pass "status"
grep -q "Applied:" "$T/api.log" && fail "a migration ran"
pass "no migration ran"
echo "gate-e2e: all passed"
