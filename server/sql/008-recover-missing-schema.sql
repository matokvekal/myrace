-- 008 — Recovery: create the application tables and indexes that are missing,
-- and make schema_migrations match the schema that actually exists.
--
-- Why: a database was found with only the 001 tables (users, sessions,
-- user_identities, otp_codes, schema_migrations) while schema_migrations listed
-- 001, 002 and 005. The 002–005 tables were never created.
--
-- What it does (one transaction: all of it or nothing):
--   0. Checks the preconditions and stops with a clear message if one fails.
--   1. Creates each missing table of 002–005 with its columns, primary key,
--      unique and check constraints exactly as in 002–005, but WITHOUT foreign
--      keys (policy, see 006). Existing tables are left as they are.
--   2. Creates each missing index of 001–005 and 007 (IF NOT EXISTS).
--   3. Drops any of the 25 foreign keys 001–005 created (006). Only constraints
--      are removed; no table, column or row is changed.
--   4. Records 001–008 in schema_migrations; existing rows are kept.
-- It never drops or rewrites a table and never deletes or updates a row.
-- Safe to re-run: a second run changes nothing.
--
-- On a database where 001–007 already ran (every local dev/test database) it is
-- a no-op apart from recording 008.
--
-- Run in DBeaver as a SCRIPT (Alt+X, "Execute SQL Script"), not Ctrl+Enter,
-- which runs only the statement under the cursor. Connect as the role that owns
-- the existing "users" table (the API's role).

BEGIN;

-- 0. Preconditions ----------------------------------------------------------
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '008: PostgreSQL 15 or later is required (categories uses UNIQUE NULLS NOT DISTINCT); this server is %',
      current_setting('server_version');
  END IF;
  IF to_regclass('public.schema_migrations') IS NULL OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION '008: schema_migrations or users is missing; run 001 first. Nothing was changed.';
  END IF;
  IF (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') <> current_user THEN
    RAISE EXCEPTION '008: connected as %, but users is owned by %. Connect as the owner so the API can use the new tables. Nothing was changed.',
      current_user, (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users');
  END IF;
END $$;

-- 1. Missing tables (from 002–005, without foreign keys) ----------------------

-- 002
CREATE TABLE IF NOT EXISTS races (
  uuid              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerUserId"     uuid NOT NULL,
  "raceId"          text,
  owner             text NOT NULL DEFAULT '',
  name              text NOT NULL,
  location          text NOT NULL DEFAULT '',
  time              text NOT NULL DEFAULT '',
  date              text NOT NULL DEFAULT '',
  image             text NOT NULL DEFAULT '',
  heat              text NOT NULL DEFAULT '',
  status            text CHECK (status IN ('upcoming', 'running', 'finished')),
  type              text NOT NULL DEFAULT '',
  "raceType"        text CHECK ("raceType" IN ('MTB', 'Gravel')),
  level             text NOT NULL DEFAULT '',
  orgenizer         text NOT NULL DEFAULT '',
  manager           text NOT NULL DEFAULT '',
  phone             text NOT NULL DEFAULT '',
  takanon           text NOT NULL DEFAULT '',
  site              text NOT NULL DEFAULT '',
  map               text NOT NULL DEFAULT '',
  distance          double precision NOT NULL DEFAULT 0,
  "isActive"        boolean NOT NULL DEFAULT true,
  "autoColor"       boolean,
  "leaderFinishAll" boolean,
  "waveColors"      jsonb,
  "mapCenter"       jsonb,
  "mapZoom"         double precision,
  "trackPoints"     jsonb,
  "mapMarkers"      jsonb,
  tracks            jsonb,
  "joinCode"        text UNIQUE,
  "lastSeq"         bigint NOT NULL DEFAULT 0,
  "changedSeq"      bigint NOT NULL DEFAULT 0,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "lastUpdateAt"    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  uuid            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceUuid"      uuid NOT NULL,
  name            text NOT NULL,
  "subCategory"   text,
  laps            integer CHECK (laps >= 0),
  "startTime"     text,
  "isConnected"   boolean,
  color           text,
  heat            integer,
  status          text CHECK (status IN ('upcoming', 'running', 'finished')),
  "linkedFinish"  boolean,
  "linkGroup"     text,
  "startedAt"     bigint,
  "finishedAt"    bigint,
  "importOrder"   integer,
  "changedSeq"    bigint NOT NULL DEFAULT 0,
  CONSTRAINT categories_name_key UNIQUE NULLS NOT DISTINCT ("raceUuid", name, "subCategory")
);

CREATE TABLE IF NOT EXISTS riders (
  uuid                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceUuid"             uuid NOT NULL,
  "bibNumber"            integer,
  category               text NOT NULL,
  "subCategory"          text,
  checked                boolean NOT NULL DEFAULT false,
  "firstName"            text NOT NULL DEFAULT '',
  "middleName"           text,
  "lastName"             text NOT NULL DEFAULT '',
  flag                   text,
  team                   text,
  standing               integer,
  heat                   integer,
  status                 text NOT NULL DEFAULT 'standing'
                           CHECK (status IN ('standing', 'running', 'finished', 'DNF', 'DSQ', 'DNS')),
  comment                text,
  image                  text,
  "chipNumber"           text,
  points                 double precision,
  "uciPoints"            double precision,
  federation             text,
  "uciNumber"            text,
  "viewOrder"            integer NOT NULL DEFAULT 0,
  "raceStatus"           text NOT NULL DEFAULT 'upcoming' CHECK ("raceStatus" IN ('upcoming', 'running', 'finished')),
  "timeStartRace"        text,
  "timeArrive"           text,
  "lapsCounter"          integer NOT NULL DEFAULT 0 CHECK ("lapsCounter" >= 0),
  "lapsDetails"          jsonb NOT NULL DEFAULT '[]'::jsonb,
  "totalLaps"            integer NOT NULL DEFAULT 0,
  "elapsedLastLap"       text,
  "elapsedTimeFromStart" text,
  distance               double precision,
  position_start         integer,
  position_category      integer NOT NULL DEFAULT 0,
  position_race          integer NOT NULL DEFAULT 0,
  color                  text,
  "changedSeq"           bigint NOT NULL DEFAULT 0,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now()
);

-- 003
CREATE TABLE IF NOT EXISTS invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceUuid"      uuid NOT NULL,
  email           text CHECK (email = lower(email)),
  "userId"        uuid,
  "tokenHash"     text NOT NULL UNIQUE,
  roles           text[] NOT NULL DEFAULT '{}',
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "maxUses"       integer NOT NULL DEFAULT 1 CHECK ("maxUses" >= 1),
  "useCount"      integer NOT NULL DEFAULT 0,
  "createdBy"     uuid NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "expiresAt"     timestamptz NOT NULL,
  "sentAt"        timestamptz,
  "revokedAt"     timestamptz,
  CONSTRAINT invitations_roles_known CHECK (roles <@ ARRAY['admin', 'start', 'counter', 'checkin', 'viewer']::text[]),
  CONSTRAINT invitations_permissions_object CHECK (jsonb_typeof(permissions) = 'object'),
  CONSTRAINT invitations_use_count CHECK ("useCount" BETWEEN 0 AND "maxUses")
);

CREATE TABLE IF NOT EXISTS race_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceUuid"      uuid NOT NULL,
  "userId"        uuid NOT NULL,
  roles           text[] NOT NULL DEFAULT '{}',
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "invitationId"  uuid,
  "addedBy"       uuid,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  "revokedAt"     timestamptz,
  CONSTRAINT race_members_race_user_key UNIQUE ("raceUuid", "userId"),
  CONSTRAINT race_members_roles_known CHECK (roles <@ ARRAY['admin', 'start', 'counter', 'checkin', 'viewer']::text[]),
  CONSTRAINT race_members_permissions_object CHECK (jsonb_typeof(permissions) = 'object')
);

CREATE TABLE IF NOT EXISTS contact_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerUserId" uuid NOT NULL,
  name          text NOT NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_groups_owner_name_key UNIQUE ("ownerUserId", name)
);

CREATE TABLE IF NOT EXISTS contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerUserId" uuid NOT NULL,
  name          text NOT NULL DEFAULT '',
  email         text CHECK (email = lower(email)),
  "userId"      uuid,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_reachable CHECK (email IS NOT NULL OR "userId" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS contact_group_members (
  "groupId"   uuid NOT NULL,
  "contactId" uuid NOT NULL,
  PRIMARY KEY ("groupId", "contactId")
);

-- 004
CREATE TABLE IF NOT EXISTS race_events (
  "actionId"        uuid PRIMARY KEY,
  "raceUuid"        uuid NOT NULL,
  seq               bigint NOT NULL CHECK (seq >= 1),
  type              text NOT NULL CHECK (type IN (
                      'AddLap', 'Undo', 'RiderFinished', 'LapCountCorrection', 'StatusCorrection',
                      'WaveStarted', 'WaveFinished', 'CategoryFinished',
                      'CategoryAdded', 'CategoryEdited', 'CategoryDeleted',
                      'RiderAdded', 'RiderEdited', 'RiderDeleted', 'RidersImported',
                      'RiderCheckedIn', 'CommentSet', 'RaceEdited', 'SettingChanged',
                      'MemberChanged', 'Finalized', 'Amended')),
  payload           jsonb NOT NULL,
  heat              integer,
  "deviceTime"      timestamptz NOT NULL,
  "clockOffsetMs"   integer NOT NULL DEFAULT 0,
  "eventAt"         timestamptz NOT NULL,
  "clockCheck"      text CHECK ("clockCheck" IN ('future', 'offset_ignored')),
  "deviceId"        text NOT NULL,
  "protocolVersion" integer NOT NULL,
  "userId"          uuid,
  "serverReceivedAt" timestamptz NOT NULL DEFAULT now(),
  applied           boolean NOT NULL,
  reason            text CHECK (reason IN ('not_member', 'forbidden', 'out_of_scope', 'race_official', 'locked', 'invalid', 'upgrade_required')),
  CONSTRAINT race_events_race_seq_key UNIQUE ("raceUuid", seq),
  CONSTRAINT race_events_reason_when_not_applied CHECK (applied = (reason IS NULL))
);

CREATE TABLE IF NOT EXISTS race_snapshots (
  "raceUuid"  uuid NOT NULL,
  seq         bigint NOT NULL CHECK (seq >= 0),
  data        jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("raceUuid", seq)
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  "raceUuid"     uuid NOT NULL,
  "deviceId"     text NOT NULL,
  "userId"       uuid,
  "lastSeq"      bigint NOT NULL DEFAULT 0,
  "pendingCount" integer NOT NULL DEFAULT 0 CHECK ("pendingCount" >= 0),
  "appVersion"   text,
  "lastSeenAt"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("raceUuid", "deviceId")
);

-- 005
CREATE TABLE IF NOT EXISTS official_versions (
  "raceUuid"         uuid NOT NULL,
  "officialVersion"  integer NOT NULL CHECK ("officialVersion" >= 1),
  version            text NOT NULL,
  algo               text NOT NULL DEFAULT 'SHA-256' CHECK (algo = 'SHA-256'),
  at                 timestamptz NOT NULL DEFAULT now(),
  by                 text NOT NULL,
  nonce              text NOT NULL,
  payload            text NOT NULL,
  token              text NOT NULL,
  "riderCount"       integer NOT NULL,
  "categoryCount"    integer NOT NULL,
  "issuedBy"         uuid NOT NULL,
  signature          text NOT NULL,
  "keyId"            text NOT NULL,
  "atSeq"            bigint NOT NULL,
  "prevToken"        text,
  reason             text,
  "includeActionIds" uuid[] NOT NULL DEFAULT '{}',
  PRIMARY KEY ("raceUuid", "officialVersion"),
  CONSTRAINT official_versions_chain CHECK (("officialVersion" = 1) = ("prevToken" IS NULL)),
  CONSTRAINT official_versions_reason CHECK ("officialVersion" = 1 OR reason IS NOT NULL)
);

-- 2. Missing indexes (001–005, 007) -------------------------------------------
-- 001
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities ("userId");
CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON sessions ("userId") WHERE "revokedAt" IS NULL;
CREATE INDEX IF NOT EXISTS otp_codes_destination_idx ON otp_codes (channel, destination, "createdAt" DESC);
-- 002
CREATE INDEX IF NOT EXISTS races_owner_idx ON races ("ownerUserId");
CREATE INDEX IF NOT EXISTS categories_race_heat_idx ON categories ("raceUuid", heat);
CREATE INDEX IF NOT EXISTS categories_race_changed_idx ON categories ("raceUuid", "changedSeq");
CREATE INDEX IF NOT EXISTS riders_race_idx ON riders ("raceUuid");
CREATE INDEX IF NOT EXISTS riders_race_bib_idx ON riders ("raceUuid", "bibNumber");
CREATE INDEX IF NOT EXISTS riders_race_changed_idx ON riders ("raceUuid", "changedSeq");
-- 003
CREATE INDEX IF NOT EXISTS invitations_race_idx ON invitations ("raceUuid");
CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS invitations_user_idx ON invitations ("userId") WHERE "userId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS race_members_user_idx ON race_members ("userId") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_owner_email_key ON contacts ("ownerUserId", email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_owner_user_key ON contacts ("ownerUserId", "userId") WHERE "userId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_group_members_contact_idx ON contact_group_members ("contactId");
-- 004 (jsonb_exists(payload, k) is the same test as payload ? k, written without
-- a "?" so DBeaver never asks for a parameter value)
CREATE INDEX IF NOT EXISTS race_events_race_heat_idx ON race_events ("raceUuid", heat, seq);
CREATE INDEX IF NOT EXISTS race_events_rider_idx ON race_events ("raceUuid", (payload ->> 'riderUuid'))
  WHERE jsonb_exists(payload, 'riderUuid');
-- 007
CREATE INDEX IF NOT EXISTS race_events_undo_target_idx ON race_events ("raceUuid", (payload ->> 'targetActionId'))
  WHERE type = 'Undo';

-- 3. No foreign keys (006): drop any that 001–005 created -------------------
ALTER TABLE user_identities       DROP CONSTRAINT IF EXISTS "user_identities_userId_fkey";
ALTER TABLE sessions              DROP CONSTRAINT IF EXISTS "sessions_userId_fkey";
ALTER TABLE sessions              DROP CONSTRAINT IF EXISTS "sessions_replacedBy_fkey";
ALTER TABLE races                 DROP CONSTRAINT IF EXISTS "races_ownerUserId_fkey";
ALTER TABLE categories            DROP CONSTRAINT IF EXISTS "categories_raceUuid_fkey";
ALTER TABLE riders                DROP CONSTRAINT IF EXISTS "riders_raceUuid_fkey";
ALTER TABLE invitations           DROP CONSTRAINT IF EXISTS "invitations_raceUuid_fkey";
ALTER TABLE invitations           DROP CONSTRAINT IF EXISTS "invitations_userId_fkey";
ALTER TABLE invitations           DROP CONSTRAINT IF EXISTS "invitations_createdBy_fkey";
ALTER TABLE race_members          DROP CONSTRAINT IF EXISTS "race_members_raceUuid_fkey";
ALTER TABLE race_members          DROP CONSTRAINT IF EXISTS "race_members_userId_fkey";
ALTER TABLE race_members          DROP CONSTRAINT IF EXISTS "race_members_invitationId_fkey";
ALTER TABLE race_members          DROP CONSTRAINT IF EXISTS "race_members_addedBy_fkey";
ALTER TABLE contact_groups        DROP CONSTRAINT IF EXISTS "contact_groups_ownerUserId_fkey";
ALTER TABLE contacts              DROP CONSTRAINT IF EXISTS "contacts_ownerUserId_fkey";
ALTER TABLE contacts              DROP CONSTRAINT IF EXISTS "contacts_userId_fkey";
ALTER TABLE contact_group_members DROP CONSTRAINT IF EXISTS "contact_group_members_groupId_fkey";
ALTER TABLE contact_group_members DROP CONSTRAINT IF EXISTS "contact_group_members_contactId_fkey";
ALTER TABLE race_events           DROP CONSTRAINT IF EXISTS "race_events_raceUuid_fkey";
ALTER TABLE race_events           DROP CONSTRAINT IF EXISTS "race_events_userId_fkey";
ALTER TABLE race_snapshots        DROP CONSTRAINT IF EXISTS "race_snapshots_raceUuid_fkey";
ALTER TABLE sync_cursors          DROP CONSTRAINT IF EXISTS "sync_cursors_raceUuid_fkey";
ALTER TABLE sync_cursors          DROP CONSTRAINT IF EXISTS "sync_cursors_userId_fkey";
ALTER TABLE official_versions     DROP CONSTRAINT IF EXISTS "official_versions_raceUuid_fkey";
ALTER TABLE official_versions     DROP CONSTRAINT IF EXISTS "official_versions_issuedBy_fkey";

-- 4. schema_migrations: the schema now equals 001–007 applied, plus this file.
INSERT INTO schema_migrations (version) VALUES
  ('001-users-auth'),
  ('002-races'),
  ('003-members-invitations-contacts'),
  ('004-race-events'),
  ('005-official-results'),
  ('006-remove-foreign-keys'),
  ('007-add-basic-indexes'),
  ('008-recover-missing-schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Verification (read-only) ----------------------------------------------------

-- V1. Tables. Expected: 17 rows, missing = false everywhere, one owner for all.
SELECT t AS table_name, to_regclass('public.' || t) IS NULL AS missing,
       (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = t) AS owner
FROM unnest(ARRAY[
  'schema_migrations', 'users', 'user_identities', 'sessions', 'otp_codes',
  'races', 'categories', 'riders',
  'invitations', 'race_members', 'contact_groups', 'contacts', 'contact_group_members',
  'race_events', 'race_snapshots', 'sync_cursors', 'official_versions'
]) AS t
ORDER BY 1;

-- V2. Columns per table. Expected: each table's actual = expected (a table that
--     existed before with another shape shows here).
SELECT e.t AS table_name, e.n AS expected,
       (SELECT count(*)::int FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = e.t) AS actual
FROM (VALUES
  ('schema_migrations', 2), ('users', 6), ('user_identities', 9), ('sessions', 10), ('otp_codes', 8),
  ('races', 35), ('categories', 16), ('riders', 38),
  ('invitations', 14), ('race_members', 10), ('contact_groups', 5), ('contacts', 7), ('contact_group_members', 2),
  ('race_events', 16), ('race_snapshots', 4), ('sync_cursors', 7), ('official_versions', 18)
) AS e(t, n)
ORDER BY 1;

-- V3. Indexes. Expected: 23 rows, present = true everywhere.
SELECT i AS index_name, to_regclass(format('public.%I', i)) IS NOT NULL AS present
FROM unnest(ARRAY[
  'users_email_key', 'user_identities_user_idx', 'sessions_user_active_idx', 'otp_codes_destination_idx',
  'races_owner_idx', 'categories_race_heat_idx', 'categories_race_changed_idx',
  'riders_race_idx', 'riders_race_bib_idx', 'riders_race_changed_idx',
  'invitations_race_idx', 'invitations_email_idx', 'invitations_user_idx', 'race_members_user_idx',
  'contacts_owner_email_key', 'contacts_owner_user_key', 'contact_group_members_contact_idx',
  'race_events_race_heat_idx', 'race_events_rider_idx', 'race_events_undo_target_idx',
  'races_joinCode_key', 'categories_name_key', 'race_events_race_seq_key'
]) AS i
ORDER BY 1;

-- V4. Foreign keys. Expected: 0.
SELECT count(*)::int AS foreign_keys FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace;

-- V5. schema_migrations. Expected: 8 rows, 001 … 008.
SELECT version, "appliedAt" FROM schema_migrations ORDER BY version;
