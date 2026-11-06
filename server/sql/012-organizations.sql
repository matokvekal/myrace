-- 012 — Commissaire 0.2 Phase 2: accounts & organizations.
--
-- Additive only: new tables, one new NULL column, a backfill that only fills NULLs.
-- No row is deleted, no foreign keys (policy, see 006), no triggers/functions
-- (schema.test). Safe to re-run (IF NOT EXISTS / ON CONFLICT / WHERE ... IS NULL).
--
--   accounts             One table for both kinds: type 'personal' (exactly one per user,
--                        "personalUserId" set, always active) or 'organization' (created
--                        'pending' by a request; activated and given an admin ONLY in the
--                        database — creating an organization grants no rights).
--   account_members      Organization membership (incl. the judge pool). Grants NO race
--                        access: race access still comes only from race_members + owner.
--   account_invitations  Organization (judge pool) invitations; mirror of `invitations`
--                        (which needs a raceUuid). Only a hash of the link secret is stored.
--                        Roles manager|judge|member — owner/admin are granted in the DB only.
--   audit_logs           Non-race audit trail (organization events). Race events stay in
--                        race_events. Never holds tokens or secrets.
--   races."accountId"    The account a race belongs to. Backfilled: the creator's
--                        personal account (COALESCE("createdByUserId", "ownerUserId")).

CREATE TABLE IF NOT EXISTS accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text NOT NULL CHECK (type IN ('personal', 'organization')),
  name             text NOT NULL DEFAULT '',
  slug             text,
  status           text NOT NULL CHECK (status IN ('pending', 'active', 'suspended')),
  "requestedBy"    uuid,
  "personalUserId" uuid UNIQUE,
  description      text NOT NULL DEFAULT '',
  contact          text NOT NULL DEFAULT '',
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_personal_user CHECK ((type = 'personal') = ("personalUserId" IS NOT NULL)),
  CONSTRAINT accounts_slug_format CHECK (slug IS NULL OR slug ~ '^[a-z0-9-]{3,40}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_slug_key ON accounts (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_requested_by_idx ON accounts ("requestedBy") WHERE "requestedBy" IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_members (
  "accountId" uuid NOT NULL,
  "userId"    uuid NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'judge', 'member')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  "addedBy"   uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("accountId", "userId")
);
CREATE INDEX IF NOT EXISTS account_members_user_idx ON account_members ("userId");

CREATE TABLE IF NOT EXISTS account_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId"  uuid NOT NULL,
  email        text CHECK (email = lower(email)),
  "userId"     uuid,
  "tokenHash"  text NOT NULL UNIQUE,
  role         text NOT NULL DEFAULT 'judge' CHECK (role IN ('manager', 'judge', 'member')),
  "maxUses"    integer NOT NULL DEFAULT 1 CHECK ("maxUses" >= 1),
  "useCount"   integer NOT NULL DEFAULT 0 CHECK ("useCount" >= 0),
  "createdBy"  uuid NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "expiresAt"  timestamptz NOT NULL,
  "sentAt"     timestamptz,
  "revokedAt"  timestamptz,
  "declinedAt" timestamptz
);
CREATE INDEX IF NOT EXISTS account_invitations_account_idx ON account_invitations ("accountId");
CREATE INDEX IF NOT EXISTS account_invitations_user_idx ON account_invitations ("userId") WHERE "userId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_invitations_email_idx ON account_invitations (email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId"   uuid,
  "raceUuid"    uuid,
  "actorUserId" uuid NOT NULL,
  action        text NOT NULL,
  "entityType"  text NOT NULL,
  "entityId"    text,
  data          jsonb NOT NULL DEFAULT '{}',
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_account_idx ON audit_logs ("accountId", "createdAt") WHERE "accountId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs ("actorUserId", "createdAt");

ALTER TABLE races ADD COLUMN IF NOT EXISTS "accountId" uuid;
CREATE INDEX IF NOT EXISTS races_account_idx ON races ("accountId");

-- Backfill 1: one personal account per existing user, and per race creator that has no
-- users row any more (no FKs: such races still get an account, nothing is guessed).
INSERT INTO accounts (type, name, status, "personalUserId")
SELECT 'personal', COALESCE(us.name, ''), 'active', u.id
FROM (
  SELECT id FROM users
  UNION
  SELECT COALESCE("createdByUserId", "ownerUserId") FROM races WHERE "accountId" IS NULL
) u
LEFT JOIN users us ON us.id = u.id
WHERE u.id IS NOT NULL
ON CONFLICT ("personalUserId") DO NOTHING;

-- Backfill 2: every race belongs to its creator's personal account.
UPDATE races r
SET "accountId" = a.id
FROM accounts a
WHERE r."accountId" IS NULL
  AND a."personalUserId" = COALESCE(r."createdByUserId", r."ownerUserId");

INSERT INTO schema_migrations (version) VALUES ('012-organizations') ON CONFLICT (version) DO NOTHING;

-- Verification (read-only). Expected: 0, 0, 4 new tables, 0 foreign keys.
SELECT (SELECT count(*)::int FROM users u WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a."personalUserId" = u.id)) AS users_without_personal_account,
       (SELECT count(*)::int FROM races WHERE "accountId" IS NULL) AS races_without_account,
       (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public'
          AND tablename IN ('accounts', 'account_members', 'account_invitations', 'audit_logs')) AS new_tables,
       (SELECT count(*)::int FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace) AS foreign_keys;
