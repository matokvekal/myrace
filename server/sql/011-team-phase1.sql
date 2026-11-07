-- 011 — Commissaire 0.2 Phase 1: race teams (judges), original creator, audit coverage.
--
-- Additive only: new NULL / defaulted columns and widened CHECK lists. No row is deleted,
-- no foreign keys (policy, see 006), no triggers (schema.test). Safe to re-run.
--
--   races."createdByUserId"   The account that created the race. Fixed for the race's life:
--                             the API writes it only on insert (ownership can be transferred,
--                             the creator can't). Only the creator may delete the race.
--                             NULL = unknown (a race without its published snapshot).
--   races."memberWrites"      Per race: members (judges) may change race data according to
--                             their roles. false = only the owner writes (0.1.x behaviour).
--   invitations."declinedAt"  The invitee declined (until now a decline looked like a revoke).
--   role "results"            Results judge: lap-count and status corrections only.
--   race_events "RaceAdmin"   Server-written audit entry for owner/admin operations
--                             (transfer, publish, delete, invitations, member writes...).
--   reason "stale"            An Undo of a lap correction that a newer correction replaced.
--   reason "duplicate"        First write wins per rider + lap: a later report of the same
--                             lap (another judge, a late offline report) is kept, not applied.

ALTER TABLE races       ADD COLUMN IF NOT EXISTS "createdByUserId" uuid;
ALTER TABLE races       ADD COLUMN IF NOT EXISTS "memberWrites" boolean NOT NULL DEFAULT false;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS "declinedAt" timestamptz;

-- Backfill from the race as first stored (snapshot seq 0): "ownerUserId" there is the
-- creator. The current races."ownerUserId" is NOT used — it changes on transfer.
UPDATE races r
SET "createdByUserId" = (s.data -> 'race' ->> 'ownerUserId')::uuid
FROM race_snapshots s
WHERE s."raceUuid" = r.uuid
  AND s.seq = 0
  AND r."createdByUserId" IS NULL
  AND (s.data -> 'race' ->> 'ownerUserId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE race_members DROP CONSTRAINT IF EXISTS race_members_roles_known;
ALTER TABLE race_members ADD CONSTRAINT race_members_roles_known
  CHECK (roles <@ ARRAY['admin', 'start', 'counter', 'checkin', 'results', 'viewer']::text[]);
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_roles_known;
ALTER TABLE invitations ADD CONSTRAINT invitations_roles_known
  CHECK (roles <@ ARRAY['admin', 'start', 'counter', 'checkin', 'results', 'viewer']::text[]);

ALTER TABLE race_events DROP CONSTRAINT IF EXISTS race_events_type_check;
ALTER TABLE race_events ADD CONSTRAINT race_events_type_check CHECK (type IN (
  'AddLap', 'Undo', 'RiderFinished', 'LapCountCorrection', 'StatusCorrection',
  'WaveStarted', 'WaveFinished', 'CategoryFinished',
  'CategoryAdded', 'CategoryEdited', 'CategoryDeleted',
  'RiderAdded', 'RiderEdited', 'RiderDeleted', 'RidersImported',
  'RiderCheckedIn', 'CommentSet', 'RaceEdited', 'SettingChanged',
  'MemberChanged', 'Finalized', 'Amended',
  'RaceAdmin'));

ALTER TABLE race_events DROP CONSTRAINT IF EXISTS race_events_reason_check;
ALTER TABLE race_events ADD CONSTRAINT race_events_reason_check
  CHECK (reason IN ('not_member', 'forbidden', 'out_of_scope', 'race_official', 'locked', 'invalid', 'upgrade_required', 'stale', 'duplicate'));

INSERT INTO schema_migrations (version) VALUES ('011-team-phase1') ON CONFLICT (version) DO NOTHING;

-- Verification (read-only).
-- Races whose creator is unknown (exceptions report; nothing is guessed):
SELECT uuid, name, "ownerUserId" FROM races WHERE "createdByUserId" IS NULL ORDER BY "createdAt";
-- Expected: 3 new columns.
SELECT count(*)::int AS new_columns FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'races' AND column_name IN ('createdByUserId', 'memberWrites'))
    OR (table_name = 'invitations' AND column_name = 'declinedAt'));
