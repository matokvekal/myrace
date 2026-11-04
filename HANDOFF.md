# Commissaire — Handoff (2026-11-04)

Read `CLAUDE.md` first (project rules), then this file. Nothing here is deployed
beyond what "Production" below says.

## Git

- Branch: **`chore/cleanup-tests`** — the commit holding this file is its tip (`git log -1`).
- `main` = `61885bd` (Release 0.1.12, pushed). The branch is AHEAD of main with the work
  after 0.1.12 (soft delete, publish/unpublish, build-integrity fix, restored tests).
  **Not merged into main and not pushed yet** — next session: push, merge, release.
- Untracked `_bmad/` is not ours — leave it alone, never commit it.

## Production

- **Broken mixed state.** The Linux agent installed release `release-61885bd` (0.1.12):
  the client is 0.1.12, but the **server archive contained a stale `server/dist`**
  (built before the access-rules commit), so `GET /races/:uuid/share-link` and
  `/api/v1/public/*` don't exist in production. Health may report `61885bd` although
  the server code is older. Cause fixed locally (see "Build integrity").
- The 0.1.12 release must NOT be edited — ship a new version (0.1.13).
- Deploys are done by the Linux production agent from a GitHub release; the user
  relays it. Do not deploy from this machine; do not message other sessions to deploy.
  The user said: no release / deploy until they give instructions.

## Completed (local, committed)

| Feature | State |
|---|---|
| Login / logout, after-auth → All Races, Create Race needs account + sync My Races | done, tested (unit + e2e), in 0.1.12 client |
| Owner-only writes (members read-only; Live screen needs `live.update`) | done; server unit; DB test written (needs test DB) |
| Guests: no lists (`AccountOnly` → sign in), read-only `/share/:token` page (Info, Riders, Categories, Schedule, Board, Results) | done; e2e `tests/guest-share.spec.ts` 8/8 (PC + phone, mocked API) |
| Share links (signed token), **Publish / Unpublish** (only published races are public) | done; server unit + DB test written; local API smoke of share link earlier |
| Guest polling: 10 s, stops when finished or 24 h after scheduled start (server 410) | done; unit tests (shared rule) + e2e |
| My Races = signed-in account's races only | done (`raceVisibleToAccount`) |
| **Soft delete**: active race deleted by owner → gone for everyone (410 + socket + `removed` list); finished race / member delete → hidden for that user (`race_hidden`); offline deletes queued; queued actions of a deleted race dropped; rows kept | done; DB tests written (need test DB); migration 010 |
| Finish Race / Finish Wave: on course → FINISHED on completed laps, never started → DNS, DNF/DSQ/DNS kept; one plan (`shared/race/finalPlan.ts`) for modal, local, server; server refuses a 2nd finalize (409) | done; unit + e2e (finish-race 7/7) |
| Finish Race modal lists exact impact; chequered-flag button | done; e2e |
| Live cards redesign (bib + one dark 5 px timing panel, rectangular medals, Classic + PRO); Finish Wave squared 7 px button | done; screenshots reviewed (desktop + phone, both skins) |
| **Build integrity**: `pack-release.sh` rebuilds `dist` from a clean tree at `<sha>` and checks `release-markers.txt`; `pack-web-release.sh` checks HEAD, clean tree, freshness and `web-release-markers.txt` | done; marker check run on a clean server build: all present |
| Restored the 4 removed server tests (cloud PostgreSQL only, no PGlite): `test/tls.test.ts` (unit, runs), `test/db/restored-schema-and-dist.test.ts` (startup schema, 009/010 re-run, dist bundle smoke — needs test DB) | done |

## Test results (this commit)

- Typecheck: client ✔, server ✔.
- Client unit: **542 passed** (73 files).
- Server unit: **24 passed** (incl. new access-rules + tls).
- Server DB suites (`test/db/**`, incl. new access-rules / soft delete / restored): **NOT RUN** —
  no `commissaire_test` database exists (creating it was blocked; needs the user/DB admin).
- e2e full suite (dev server without a server URL): 62 passed, 11 skipped (need a real API),
  15 "failed" — all explained: 8 `guest-share` + 1 scratch visual need a server-URL build
  (guest-share is 8/8 on one); 4 `finish-race` failed only on the stale :3400 dev server
  (7/7 on a fresh :3500 server); `wave-start-blocked` is flaky (3/3 on repeat); `i18n` is
  environmental (below). Always run e2e on a FRESH dev server.
- e2e `tests/guest-share.spec.ts` on an app built with `VITE_SERVER_URL=http://localhost:4999`
  (API mocked): **8/8** PC + phone.
- Known environmental failure: `tests/i18n.spec.ts` "switching language…" expects
  "Register / Login", which only exists with a server URL. Not a regression.

## Known issues / not done

1. **PC ↔ Mobile live-sync audit (`tests/live-sync-audit.spec.ts`) has never produced
   numbers.** Against production it stopped at setup (selector fixed since). It needs a
   server with migration 010: production after 0.1.13, or a local API on a test DB.
   Local runs against the cloud DB showed ~60 s lag earlier only because of ~120 ms per
   query from this machine; production has the API next to the DB.
2. **Test database**: create `commissaire_test` on the cloud server (`CREATE DATABASE
   commissaire_test;` as an admin), then `TEST_DATABASE_URL=… npm test` in `server/`
   (global setup rebuilds its schema from `server/sql`). Never point tests at production.
   `server/.env` = PRODUCTION database: a local API started with it runs on production
   data, and with the new code it refuses to start until 010 is applied there.
3. Multi-user DB suite `test/db/lifecycle.test.ts` runs with `COMMISSAIRE_MEMBER_WRITES=1`
   (roles are future scope).
4. Test accounts to clean up in the cloud DB (identify only, **delete only with explicit
   approval**): emails like `sync-e2e.*`, `sync-audit.*`, `access-smoke.*` `@test.invalid`,
   and `owner.*`/`later.*`/`down.*`/`sync.*`/`phone.*`/`menu.*` `@x.test`, plus their races.
5. Dev server on :3000 (started 11/03) is stale — use a fresh one (:3400) for e2e.
6. Open bugs: `BUGS.md` (BUG-03, BUG-05, BUG-13).

## Branches

- Keep: `main`, `ver1`, `gh-pages` (deploy branch), release tags, `chore/cleanup-tests` (has unreleased work).
- Obsolete — already in main (verified with `git cherry` / diff), **delete only after a
  successful production deploy**: local `backup-main-before-sync`, `chore/cloud-postgres-only`,
  `feature/checkin-add-rider`, `feature/create-ui-cleanup`, `feature/m0-*` (6),
  `feature/m1-2.1-shared-race-model`, `feature/m2-db-schema`, `feature/m2-server`,
  `feature/m4-client-live`, `fix/pack-release-output`, `release/frontend-2026-11-02`,
  `server`; and the matching `origin/*` branches (`origin/feature/m4-client-live` only adds
  then removes a temp workflow; `origin/fix/pack-release-output`'s fix is in main).
- Old draft release `release-4a1b551` can be deleted (superseded).

## Exact next steps

1. Commit anything left; `git push origin chore/cleanup-tests`.
2. (Recommended) create `commissaire_test`, run `server` DB suites; fix anything red.
3. Bump `src/app/version.json` to **0.1.13**, commit, `git checkout main && git merge --ff-only chore/cleanup-tests && git push origin main`.
4. Build web: PowerShell `$env:VITE_SERVER_URL='/'; npm run build`.
5. Pack (Git Bash, POSIX out dir via `cygpath -u`): `bash server/deploy/pack-release.sh <sha> <out>`
   (it rebuilds + verifies the server) and `bash server/deploy/pack-web-release.sh <sha> dist <out>`;
   `sha256sum *.tar.gz > SHA256SUMS`; check each archive's `REVISION`.
   Also inspect the server archive: `tar -xzOf <server>.tar.gz server/dist/server.js | grep -c share-link`.
6. Publish a NEW release `release-<sha7>` (Latest) with notes like release-61885bd, plus:
   **run migration 010 first** (`psql … -f server/sql/010-race-deletion-publishing.sql`,
   then `node dist/db/migrate-cli.js --check`), additive only; smoke tests: health =
   new sha, `/api/v1/public/races/x` → 404, `/api/v1/races` → 401 without auth, Share
   Race → Publish → link opens in a private window, Unpublish → link 404, Finish Race modal.
7. Only when the user says so: they relay it to the Linux agent. After the deploy:
   verify health shows the new sha, run `tests/live-sync-audit.spec.ts` with
   `E2E_BASE_URL=E2E_API_URL=https://commissaire.us` (dedicated test race only), report
   latencies; then delete the obsolete branches listed above.
