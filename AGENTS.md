# AGENTS.md — how to work on Commissaire

Start here after any context reset. Then read `docs/CURRENT_STATE.md` (version, progress,
pending work) and, for feature details, `CLAUDE.md`.

## 1. What Commissaire is
Cycling race timing and management: races, categories/waves, riders, live lap recording, results.
Local-first PWA (works offline) + an optional server for shared races where several judges work on
the same race at the same time.

## 2. Architecture
- **App:** React + Vite + React Router v6 + TypeScript + Zustand; IndexedDB (`idb`) is the local
  source of truth for local races; routes are lazy (`src/App.tsx`); not Next.js despite `[id]` folders.
- **Shared rules:** `src/shared/race/*` — pure TS used by app AND server: roles/permissions
  (`roles.ts`, `access.ts`), Action catalog (`actions.ts`), rules engine (`engine.ts`).
- **Server:** Node + Express (`server/src`), PostgreSQL (no ORM, SQL in `server/sql/NNN-*.sql`,
  applied by hand), Socket.IO for live pushes. The ONLY write path for shared race data is
  `POST /api/v1/races/:id/actions` (`server/src/races/actions.ts`): one transaction under the race
  row lock, authorization per Action, append to `race_events` (the audit log), derive rider state.
- **Sync (app):** `src/app/services/live/liveClient.ts` — outbox in IndexedDB → batched sends;
  socket `race:changes` + HTTP catch-up/snapshot; one writer per race; refused actions kept for review.
- **Server is the source of truth** for shared races. First write wins per rider + lap.

## 3. Development rules (binding)
1. **Protect what works.** No rewrites; minimal, additive changes; reuse existing modules
   (race_members, invitations, race_events, access.ts, Socket.IO). No parallel permission or audit systems.
2. **Security on the server.** The app only hides controls; the server enforces every rule.
   Never trust client-supplied identity.
3. **Database:** additive migrations only, **no foreign keys** (policy 006), **no triggers/functions**,
   update `REQUIRED_TABLES` (`server/src/db/migrate.ts`) and tests. Never destructive.
4. **Never read or print `server/.env`** (production credentials). Never connect to the cloud/production DB.
5. **Tests:** server DB tests only on the isolated Docker DB (`cd server && npm run test:db`;
   guard: DB name ends `_test`, loopback host). Client: `npx vitest run`, `npm run typecheck`
   (2 known baseline errors). Never weaken a test to pass; record baseline failures in
   `docs/v2/baseline-issues.md`.
6. **UI:** mobile-first, 44 px targets, Hebrew + English (`t(key, default)` + `public/locales/he/common.json`
   flat keys), `dir="auto"`, BASE_URL for `public/` assets, keep the eager bundle small (lazy screens).
7. **Git:** work on a feature branch; commit only reviewed work; **never merge into `main` or deploy
   without the user's explicit approval.** Commit trailer: `Co-Authored-By: Claude …`.
8. **Business rules are the user's.** Don't change approved rules; mark undecided UX/timing as OPEN
   and ask. Approved decisions are logged in `docs/v2/DEVLOG.md`.

## 4. Workflow (Manager → Worker → QA)
- The manager breaks work into small tasks, gives each worker only the files/rules it needs, and
  verifies results itself (runs the tests) before committing.
- Every completed task gets an **independent QA review** (read-only, separate agent); fix findings,
  re-verify. A worker never approves its own work.
- Don't run two agents that edit the same files or both use the test DB/ports at the same time.
  Never switch branches while an agent is reviewing the working tree.
- Keep `docs/v2/DEVLOG.md` (decisions, tasks, QA outcomes) and `docs/CURRENT_STATE.md` current.

## 5. Local environments
- DB tests: Docker Desktop running → `cd server && npm run test:db` (`npm run test:db:down` removes it).
- Full stack for multi-browser E2E: `npm --prefix server run e2e:stack` (isolated `commissaire_e2e_test`,
  API :4100, app :3100); stop with `npm --prefix server run e2e:stack -- --stop`. Specs that need it are
  opt-in (`MULTIUSER_E2E=1`, `E2E_API_URL`, `E2E_BASE_URL`): `tests/event-judges.spec.ts`,
  `multiuser.spec.ts`, `cloud-sync.spec.ts`. Use `--workers=1` (memory).
- Build the production web app from **PowerShell** with `$env:VITE_SERVER_URL='/'` (Git Bash rewrites `/`).

## 6. Production deployment procedure
Production = one Linux server: app in `/var/www/commissaire`, API = PM2 `server-commissaire` on :5000,
same domain (`https://commissaire.us`), PostgreSQL `commissaire` on loopback. Full doc:
`docs/server/deployment.md`.
1. **Here (dev machine), with approval:** bump `src/app/version.json`; commit; build web (PowerShell,
   `VITE_SERVER_URL=/`); `bash server/deploy/pack-web-release.sh <sha> dist <out>`; in `server/`
   `bash deploy/pack-release.sh <sha> <out>` (requires HEAD = sha, clean tree, all lines of
   `server/deploy/release-markers.txt` in the bundle — add a marker for every new route);
   `sha256sum` → `SHA256SUMS`; `gh release create release-<short sha>` with both archives, sums and
   install notes (format: see `release-047e47a`).
2. **On the server — done ONLY by the Linux production agent, never from this machine:** verify sums;
   back up the DB (`pg_dump -Fc`) and `/var/www/commissaire`; `node dist/db/migrate-cli.js --check`;
   apply missing migrations in order with `psql -1 -v ON_ERROR_STOP=1`; unpack the API to a new folder,
   link `.env`, point PM2 `server-commissaire` at it, restart (never `pm2 … all`; El Niño untouched);
   copy `web/`; smoke check (health reports the commit, Socket.IO `sid`, an existing race opens,
   one judge lap syncs).
3. **Rollback:** restore the web backup, point PM2 at the previous API folder, restart. Migrations are
   additive, so the database normally needs no rollback.
4. Never edit a published release; fixes go into a new version.
5. Read-only check of what production runs: `GET https://commissaire.us/api/v1/health` → `release`.

## 7. Where things are documented
| Topic | File |
|---|---|
| Current state / resume steps | `docs/CURRENT_STATE.md` |
| Feature notes per area | `CLAUDE.md` |
| 0.2 plan + requirement status | `version2.md` |
| Decisions, task log, QA outcomes | `docs/v2/DEVLOG.md` |
| Judge workflow readiness | `docs/v2/JUDGE_READINESS.md` |
| Next task (Rapid Lap Entry) | `docs/v2/rapid-lap-entry.md` |
| Baseline failures | `docs/v2/baseline-issues.md` |
| Server tests | `docs/server/testing.md` |
| Deployment | `docs/server/deployment.md` |
