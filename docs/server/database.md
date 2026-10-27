# Commissaire server database

PostgreSQL design for the multi-user server. It mirrors what the app already
keeps in IndexedDB (`commissireDb` v9) and adds only what accounts, membership,
invitations, sync and official results need. Business rules stay in TypeScript
(`src/shared/race`); the database has no triggers or stored functions.

Migrations: `server/sql/001-…005-*.sql`, applied in order by the API's runner
(each records itself in `schema_migrations`). `000-create-database.sql` is run
once by hand. `verify.sql` checks the result.

## Conventions

- **Same field names as the app.** Columns use the client's camelCase names
  (quoted in SQL: `"bibNumber"`), so a row is the JSON the app already reads.
  A few RaceProps/RiderProps names that are already snake_case or misspelled
  (`position_category`, `orgenizer`) are kept as they are.
- **Server key = `uuid`.** Races already have a `uuid`; riders and categories get
  one when the race is published. The numeric `id` stays on the device.
- **Every race record carries `"raceUuid"`** (the name RiderProps and
  CategoryProps already use), `NOT NULL` and the leading column of an index.
  Every query filters by it; deleting a race removes only its rows (tested).
- **No foreign keys** (006 removed the 25 that 001–005 created). Tables are
  independent; relationship columns (`"raceUuid"`, `"userId"`, `"groupId"`, ...)
  stay, with primary keys, unique constraints, NOT NULL and indexes. The API
  keeps the relations — see "Relations without foreign keys" below.
- One PostgreSQL database for all races; isolation is by `"raceUuid"`.

## IndexedDB → PostgreSQL

| IndexedDB store (type) | PostgreSQL | Notes |
|---|---|---|
| `races` (RaceProps) | `races` | Same fields. Key `uuid`. Adds `"ownerUserId"`, `"joinCode"`, `"lastSeq"`. Not stored (device-only): `id`, `isFavorite`, `viewOnly`, `syncedAt`, `serverVersion`, `isPrivate`/`password`. `finalized` comes from `official_versions`. |
| `categories` (CategoryProps) | `categories` | Same fields. Key `uuid`. Not stored (derived): `lapsCounter`, `riders` (count). |
| `riders` (RiderProps) | `riders` | Same fields. Key `uuid`. Lap and position fields are the current state computed by the rules engine. Not stored: `id` (device-local), `extraFields` ("Keep as info", AD-12). |
| `race_events` (RaceEvent, old cloud log) | `race_events` | Same purpose and name; rows are now the Action envelope (`"actionId"`, `type`, `payload`, `"deviceTime"`, `"clockOffsetMs"`, `"deviceId"`, `"userId"`, `seq`, `applied`, `reason`). The device-side `syncStatus` becomes the outbox state on the device. |
| `users`, `roles` (local RBAC) | — | Device-only token and preset lists; not migrated. Server accounts are `users` + `user_identities`; roles live on `race_members`. |
| Laps (`rider.lapsDetails`) | `riders."lapsDetails"` + `race_events` | The app has no laps store. Each lap is an `AddLap` row in `race_events`; `lapsDetails` keeps the computed list in the same JSON shape. |
| RaceProps.`finalized` | `official_versions` | One row per official version (1 = finalize, 2+ = amendments). The API returns the latest as the same RaceFinalization JSON. |
| Device-only (stay in IndexedDB/localStorage) | — | Favorites, view-only downloads, Jokers, action-log view, board hold, voice/theme/Results preferences, club dictionary, import templates, demo race. |

## ERD

```mermaid
erDiagram
  users ||--o{ user_identities : "signs in with"
  users ||--o{ sessions : has
  users ||--o{ races : owns
  users ||--o{ race_members : "is member"
  races ||--o{ race_members : has
  races ||--o{ invitations : has
  invitations |o--o{ race_members : "accepted as"
  users ||--o{ contact_groups : keeps
  users ||--o{ contacts : keeps
  contact_groups ||--o{ contact_group_members : ""
  contacts ||--o{ contact_group_members : ""
  races ||--o{ categories : has
  races ||--o{ riders : has
  races ||--o{ race_events : logs
  races ||--o{ race_snapshots : "published as"
  races ||--o{ sync_cursors : "devices at"
  races ||--o{ official_versions : issues
```

## Tables with no IndexedDB equivalent

| Table | Why it is needed |
|---|---|
| `schema_migrations` | Which migration files have run. |
| `users` | One row per person; everything points at `users.id`, never at an email. |
| `user_identities` | Sign-in methods per user (password, Google, email OTP, SMS later). Several per user = account linking. Passwords only as a hash. |
| `sessions` | Refresh-token sessions for sign-out and revoke (hash only). |
| `otp_codes` | Email OTP now, SMS OTP later (hash only, short expiry, purged after 24 h). |
| `race_members` | Who may do what in which race: a set of roles plus an optional category scope. One user can be in many races with different roles. |
| `invitations` | Email, existing-user, link and QR invitations. Access exists only after the invitee signs in and accepts (then a `race_members` row is created). Only a hash of the link secret is stored. |
| `contact_groups`, `contacts`, `contact_group_members` | An organizer's reusable directory ("Federation A"). Grants no race access by itself. |
| `race_snapshots` | The race as published (`seq` 0); replaying `race_events` on it must give the stored state. |
| `sync_cursors` | Last `seq` and queue depth per device, for catch-up and the owner's team sync view. |
| `official_versions` | Signed official results and amendments, kept as a chain. |

## Access: roles, screen permissions, data scope

Per race and per member, three independent parts (rules in `src/shared/race/access.ts`):

| Part | Stored in | Meaning |
|---|---|---|
| Roles | `race_members.roles` | Any set of `admin`, `start`, `counter`, `checkin`, `viewer` (FR-10). The owner is `races."ownerUserId"` and always has full access; nothing can override it. Roles give default screen permissions. |
| Screen permissions | `race_members.permissions.screens` | Per screen (`info`, `map`, `schedule`, `categories`, `riders`, `results`, `start`, `checkin`, `board`, `status`, `live`, `team`, `settings`): `view`, `create`, `update`, `delete`. Overrides of the role defaults set by the owner or an admin. No write without view. |
| Data scope | `race_members.permissions.waves` / `.categories` | Waves (heat numbers) and, for counters, categories the member may see and act on. Unset = all. |

Examples: a spectator is `roles: []`, `permissions: {"screens": {"live": {"view": true}, "results": {"view": true}}, "waves": [3]}`; a wave-1 lap commissaire is `roles: ["counter"]`, `permissions: {"waves": [1]}`.

The API checks the exact operation each Action needs (e.g. Undo needs `live.delete`) and
filters everything it sends (responses, snapshots, catch-up, socket events) with the
same rules: hidden waves, out-of-scope riders, lap data without a results-type screen,
and private rider details without Riders or Check-In are never sent.
`race_events.heat` (wave of each action) and `"changedSeq"` on races, categories and
riders let catch-up return only rows a member may see.

## Timing

`race_events` stores both clocks: `"deviceTime"` + `"clockOffsetMs"` (the
device's offset to the server clock, measured before the tap) and
`"receivedAt"` (server clock on arrival). Lap times use
`deviceTime + clockOffsetMs`, which is server-clock time at the moment of the tap.
`receivedAt` alone would time an offline lap, or a lap sent after a bunch
of taps, at the moment it reached the server.

## Unavoidable differences

1. Riders and categories get a server `uuid`; the device keeps its numeric `id` and maps it.
2. `"raceUuid"` everywhere (as in RiderProps), so the Action envelope's `raceId`
   and payload `riderId`/`categoryId` (Story 2.1 draft) become `raceUuid`,
   `riderUuid`, `categoryUuid`. `RaceProps.raceId` keeps its existing meaning
   (readable "YYYY-MM-DD-name").
3. Derived category counters and the rider's "Keep as info" `extraFields` are not stored.
4. Duplicate bibs are not blocked by the database (the app allows them during setup with a warning); the rules engine rejects them where Story 2.6 says so.
5. Append-only `race_events` is enforced by the API code (no UPDATE/DELETE statements) and checked by tests; no trigger.

## Setup (you run this; nothing here touches El Niño)

Commissaire uses its own PostgreSQL database (cloud-hosted or self-hosted),
never El Niño's. Migrations are applied **by hand with psql**; the API never
applies them to a cloud/external database.

1. Create the database and a login for it. Cloud provider: use its console and
   skip `000`. Self-hosted, as a superuser:
   `sudo -u postgres psql -v app_password='<new secret>' -f server/sql/000-create-database.sql`
   and add one `pg_hba.conf` line for the API host, then `SELECT pg_reload_conf();`.
2. Apply 001–007 in order, each as one transaction (the files have no BEGIN/COMMIT;
   each records itself in `schema_migrations`):
   `for f in 001 002 003 004 005 006 007; do psql "<connection string>" -1 -v ON_ERROR_STOP=1 -f server/sql/$f-*.sql; done`
   then `008` (it has its own BEGIN/COMMIT, so without `-1`). On a database where
   001–007 really ran it only records itself. It exists to repair a database where
   files were recorded without their tables: it creates every missing table and
   index of 001–007 (no foreign keys), keeps all existing tables and rows, and
   records 001–008. In DBeaver run it as a script (Alt+X).
3. Check: `psql "<connection string>" -f server/sql/verify.sql` (check 6 expects
   owner `commissaire_live`; with a provider-created database the owner differs).
4. Put the connection string in `server/.env` as
   `DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME` (password URL-encoded),
   remove `DEV_PGLITE`, and set `DB_POOL_MAX` to about 10. `COMMISSAIRE_DATABASE_URL`
   is still read as a fallback. The value in `server/.env` wins over a `DATABASE_URL`
   inherited from the shell.
5. **TLS** (`src/db/tls.ts`). A non-local database always uses TLS with full
   verification: the certificate chain must lead to a trusted CA and the
   certificate must carry the host name. It cannot be turned off
   (`sslmode=disable` and `ssl=no-verify` stop the API). `sslmode`, `sslrootcert`,
   `sslcert` and `sslkey` in the URL are read and then removed from it, because pg
   would otherwise replace the verified settings with its own.
   - Publicly signed certificate: nothing to set.
   - Private CA or self-signed server certificate: set `DATABASE_CA_CERT_FILE` to
     that CA's (or that certificate's) PEM file, or put the PEM in
     `DATABASE_CA_CERT` (`\n` escapes allowed). Get it from the provider or the
     server admin (for self-hosted PostgreSQL, the file named by `ssl_ca_file`,
     or `ssl_cert_file` when self-signed).
   - Connecting by IP, or to a host name the certificate does not carry: set
     `DATABASE_TLS_SERVERNAME` to the name the certificate does carry. It is still
     checked.
6. `npm run migrate` on that database only lists missing files (exit 1 if any).
   On start the API checks the schema read-only and refuses to start, naming
   what is missing, while any migration file is not recorded in
   `schema_migrations` or any required table does not exist. It logs a warning
   if any foreign key exists.

## Relations without foreign keys

The API, not the database, keeps referential integrity, race isolation and
ownership. Rules:

- **Every write touching race rows runs in one transaction under the race row
  lock** (`SELECT … FROM races WHERE uuid = $1 FOR UPDATE`, or `FOR SHARE` for
  a plain insert). Actions, finalize/amend, members, invitation accept and
  create, transfer and device sync all do. A race deleted meanwhile is found
  missing (404) and nothing is left behind.
- **Deleting a race** (`deleteRaceRows`, `server/src/races/repo.ts`): one
  transaction, race row locked, then every table in `RACE_TABLES`, then the
  race. A new table with `"raceUuid"` must be added to `RACE_TABLES` (a test
  fails otherwise).
- **Directory:** deleting a contact removes its group memberships; deleting a
  group removes its member rows and keeps the contacts; replacing a group's
  contacts locks the group and the chosen contacts. Only the owner's own rows.
- **Ids the database used to check** are checked by the API: invited and
  contact accounts must exist; group members must be the owner's contacts.
- No cascades and no `ON DELETE` actions anywhere. Users are never deleted, so
  rows pointing at a user (`createdBy`, `addedBy`, `issuedBy`, ...) stay valid.

## Indexes

Every relationship and lookup column the API queries is indexed (reviewed in
007): `"raceUuid"` leads an index on every race table; membership
(`"raceUuid"`, `"userId"`) unique plus "My races" (`"userId"`, active); rider
bib (`"raceUuid"`, `"bibNumber"`); events (`"raceUuid"`, seq) unique, wave
catch-up (`"raceUuid"`, heat, seq), per-rider history (`"raceUuid"`,
`payload->>'riderUuid'`) and the Undo check (`"raceUuid"`,
`payload->>'targetActionId'`, 007); live sync (`"raceUuid"`, `"changedSeq"`) on
riders and categories; invitations by `"tokenHash"` (unique) and race;
sessions by `"refreshTokenHash"` (unique) and active `"userId"`; identities by
(provider, subject) and `"userId"`; group members by group and contact.
`riders_race_idx` duplicates the leading column of two other indexes; it is
harmless and left as applied.

## Schema changes

- Every change is a new file `NNN-short-name.sql` (next number), ending with
  `INSERT INTO schema_migrations (version) VALUES ('NNN-short-name');`.
- Never edit a file that has been run on the cloud database; add a new one.
- **No foreign keys, `REFERENCES` or `ON DELETE` actions** in any migration (a
  schema test fails on `REFERENCES`/`FOREIGN KEY` after 005). Index new
  relationship columns instead, and keep the relation in the API.
- New indexes: `CREATE INDEX IF NOT EXISTS`; schema changes stay additive.
- Only the local PGlite dev database (`npm run db:dev`, `DEV_PGLITE=true`, loopback
  host) and the test setup are migrated by code.
