-- 006 — Remove every foreign-key constraint (database policy: tables are independent).
--
-- Relationship columns ("raceUuid", "userId", ...) stay, with their NOT NULL,
-- primary keys, unique constraints and indexes. Referential integrity, race
-- isolation, ownership and cascading clean-up are done by the Node API, in
-- transactions. No table, column, index, primary key, unique constraint or row
-- is dropped or changed.
--
-- Safe to re-run: every statement uses DROP CONSTRAINT IF EXISTS and the
-- schema_migrations row is inserted ON CONFLICT DO NOTHING.
--
-- 25 constraints: 3 created by 001, 22 by 002–005. Names are PostgreSQL's
-- generated <table>_<column>_fkey (quoted: the column names are camelCase).

-- 001 — accounts
ALTER TABLE user_identities       DROP CONSTRAINT IF EXISTS "user_identities_userId_fkey";
ALTER TABLE sessions              DROP CONSTRAINT IF EXISTS "sessions_userId_fkey";
ALTER TABLE sessions              DROP CONSTRAINT IF EXISTS "sessions_replacedBy_fkey";

-- 002 — races, categories, riders
ALTER TABLE races                 DROP CONSTRAINT IF EXISTS "races_ownerUserId_fkey";
ALTER TABLE categories            DROP CONSTRAINT IF EXISTS "categories_raceUuid_fkey";
ALTER TABLE riders                DROP CONSTRAINT IF EXISTS "riders_raceUuid_fkey";

-- 003 — invitations, members, directory
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

-- 004 — event log, snapshots, sync cursors
ALTER TABLE race_events           DROP CONSTRAINT IF EXISTS "race_events_raceUuid_fkey";
ALTER TABLE race_events           DROP CONSTRAINT IF EXISTS "race_events_userId_fkey";
ALTER TABLE race_snapshots        DROP CONSTRAINT IF EXISTS "race_snapshots_raceUuid_fkey";
ALTER TABLE sync_cursors          DROP CONSTRAINT IF EXISTS "sync_cursors_raceUuid_fkey";
ALTER TABLE sync_cursors          DROP CONSTRAINT IF EXISTS "sync_cursors_userId_fkey";

-- 005 — official results
ALTER TABLE official_versions     DROP CONSTRAINT IF EXISTS "official_versions_raceUuid_fkey";
ALTER TABLE official_versions     DROP CONSTRAINT IF EXISTS "official_versions_issuedBy_fkey";

INSERT INTO schema_migrations (version) VALUES ('006-remove-foreign-keys') ON CONFLICT (version) DO NOTHING;

-- Verification (read-only). Expected: remaining_foreign_keys = 0.
SELECT count(*) AS remaining_foreign_keys
FROM pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace;
