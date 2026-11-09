-- 014 — Quick Trial Access: a race owner's link that lets a NEW judge try the system
-- without registering. Opening the link creates a temporary user, an ordinary race
-- membership (existing roles and authorization) and a session, all bound to one race.
--
-- Additive only: two new tables. No foreign keys (policy, see 006), no triggers or
-- functions (schema.test). Existing tables and rows are not touched. Safe to re-run.
--
--   trial_links       One per link the owner creates. Only a SHA-256 hash of the link
--                     secret is stored. "expiresAt" = until when the LINK can be opened;
--                     "accessUntil" = until when the trial users it creates may work.
--                     The two are independent: an expired link never ends an active trial.
--   temporary_users   One per trial user (users row without email or identities).
--                     The user may act only in "raceUuid" and only until "expiresAt";
--                     the users row, membership and race_events are never deleted
--                     (audit history stays after the trial ends).

CREATE TABLE IF NOT EXISTS trial_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceUuid"      uuid NOT NULL,
  "createdBy"     uuid NOT NULL,
  "tokenHash"     text NOT NULL,
  roles           text[] NOT NULL,
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "maxUses"       integer NOT NULL DEFAULT 10,
  "useCount"      integer NOT NULL DEFAULT 0,
  "expiresAt"     timestamptz NOT NULL,
  "accessUntil"   timestamptz NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "revokedAt"     timestamptz,
  "revokedBy"     uuid,
  CONSTRAINT trial_links_token_key UNIQUE ("tokenHash"),
  CONSTRAINT trial_links_roles_known CHECK (roles <@ ARRAY['start', 'counter', 'checkin', 'results', 'viewer']::text[]),
  CONSTRAINT trial_links_permissions_object CHECK (jsonb_typeof(permissions) = 'object'),
  CONSTRAINT trial_links_use_count CHECK ("maxUses" >= 1 AND "useCount" BETWEEN 0 AND "maxUses")
);
CREATE INDEX IF NOT EXISTS trial_links_race_idx ON trial_links ("raceUuid", "createdAt");

CREATE TABLE IF NOT EXISTS temporary_users (
  "userId"        uuid PRIMARY KEY,
  "raceUuid"      uuid NOT NULL,
  "linkId"        uuid NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "expiresAt"     timestamptz NOT NULL,
  "revokedAt"     timestamptz
);
CREATE INDEX IF NOT EXISTS temporary_users_race_idx ON temporary_users ("raceUuid");
CREATE INDEX IF NOT EXISTS temporary_users_link_idx ON temporary_users ("linkId");

INSERT INTO schema_migrations (version) VALUES ('014-trial-access') ON CONFLICT (version) DO NOTHING;

-- Verification (read-only). Expected: 2 new tables, 0 foreign keys.
SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public'
          AND tablename IN ('trial_links', 'temporary_users')) AS new_tables,
       (SELECT count(*)::int FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace) AS foreign_keys;
