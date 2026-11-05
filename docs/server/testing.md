# Server tests

Production data is never touched. `server/.env` (the production database) is never read by tests.

| Kind | Where | Runs |
|---|---|---|
| Unit (no database) | `server/test/*.test.ts` | always: `cd server && npx vitest run` |
| Database (API + PostgreSQL) | `server/test/db/*.test.ts` | only with `TEST_DATABASE_URL` |

## Database tests

They run against a **dedicated test database on the cloud PostgreSQL server**, never a local
one and never production. The name must end in `_test`; `src/config/env.ts` and
`test/db/global-setup.ts` refuse anything else before connecting. The global setup rebuilds
that database's schema from `server/sql` (001…, never 000) at the start of every run.

One-time creation (by an admin, on the cloud server; additive, touches no other database):

```sql
CREATE DATABASE commissaire_test OWNER commissaire_app;
```

Run (PowerShell, from `server/`; the CA settings are the same ones the API uses):

```powershell
$env:TEST_DATABASE_URL = "postgresql://commissaire_app:<password>@<host>:5432/commissaire_test?sslmode=verify-full"
$env:DATABASE_CA_CERT_FILE = "certs/pg-server.crt"   # and DATABASE_TLS_SERVERNAME if connecting by IP
npx vitest run
```

Coverage: sign-in / logout / password reset limits (`password-reset`), member isolation and
roles (`auth-isolation`), the race lifecycle — publish, starts, laps, finishes, statuses,
undo, catch-up (`lifecycle`, `races`, `recovered-lap`), the 2026-11-04 wave-start regression
(`wave-start-sync`), preferences, schema checks and the no-foreign-keys policy.

Not restored yet (they started an in-process PGlite and need a rewrite for a real server):
`migration-009`, `startup-schema`, `tls`, `dist-smoke`.
