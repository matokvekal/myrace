# Server tests

Production data is never touched. `server/.env` (the production database) is never read by tests.

| Kind | Where | Runs |
|---|---|---|
| Unit (no database) | `server/test/*.test.ts` | always: `cd server && npx vitest run` |
| Database (API + PostgreSQL) | `server/test/db/*.test.ts` | only with `TEST_DATABASE_URL` |

## Database tests

They run against an **isolated, throwaway PostgreSQL in Docker** (`docker-compose.test.yml`,
`postgres:16-alpine`, data in tmpfs, bound to `127.0.0.1:55432`). No production data or
credentials: the container's user/password exist only inside it. The global setup rebuilds
the schema from `server/sql` (001…, never 000) at the start of every run.

```powershell
cd server
npm run test:db                              # starts the container, runs unit + database tests
npm run test:db -- test/db/races.test.ts     # extra args go to vitest
npm run test:db:down                         # removes the container
```

Guards (any one stops the run before a connection is made):
- `scripts/test-db.mjs` and `test/db/global-setup.ts` accept only `isSafeTestDatabase`: the
  database name ends in `_test` **and** the host is loopback.
- `src/config/env.ts` (NODE_ENV=test) applies the same check and refuses to read `server/.env`.
- The global setup re-checks `current_database()` ends in `_test` before rebuilding.
- A remote `*_test` database (e.g. CI or the old cloud `commissaire_test`) needs
  `TEST_DATABASE_ALLOW_REMOTE=1` explicitly, plus `TEST_DATABASE_URL`, and TLS settings as the API uses.

CI: start the same compose file (or a `postgres:16` service on 127.0.0.1), then run
`TEST_DB_NO_DOCKER=1 TEST_DATABASE_URL=postgresql://commissaire_test:commissaire_test@127.0.0.1:55432/commissaire_test npm run test:db`.

Coverage: sign-in / logout / password reset limits (`password-reset`), member isolation and
roles (`auth-isolation`), the race lifecycle — publish, starts, laps, finishes, statuses,
undo, catch-up (`lifecycle`, `races`, `recovered-lap`), the 2026-11-04 wave-start regression
(`wave-start-sync`), preferences, schema checks and the no-foreign-keys policy.

Not restored yet (they started an in-process PGlite and need a rewrite for a real server):
`migration-009`, `startup-schema`, `tls`, `dist-smoke`.

## Multi-user browser specs (local full stack)

`cd server && npm run e2e:stack` (`scripts/e2e-stack.mjs`) runs everything locally, never production:
the compose PostgreSQL above, a SEPARATE database `commissaire_e2e_test` in it (created if missing,
schema rebuilt from `server/sql` on every start — `commissaire_test` of the DB tests is never touched),
the API built and started on `127.0.0.1:4100` (NODE_ENV=test, `COMMISSAIRE_SKIP_DOTENV=1`, mail logged),
and the app with Vite on `http://localhost:3100` (`VITE_SERVER_URL` set by the script, not Git Bash).
Flags: `--no-app`, `--no-build`. Logs: `<os tmp>/commissaire-e2e/api.log` (every "sent" email, since
`LOG_LEVEL=info` is set explicitly) and `app.log`. Ctrl+C stops the API and the app.

```bash
MULTIUSER_E2E=1 E2E_API_URL=http://localhost:4100 MULTIUSER_API=http://localhost:4100 E2E_BASE_URL=http://localhost:3100 npx playwright test tests/event-judges.spec.ts tests/multiuser.spec.ts
```

`tests/event-judges.spec.ts`: owner + Start judge + wave-scoped Counter + Results judge in four browser
contexts — invitations, judging switch, concurrent laps, offline once-only delivery, corrections + undo,
revocation mid-race (refused taps listed as "not applied"), judging off, identical results.
