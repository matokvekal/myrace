-- verify.sql — read-only checks after running 001–008 on the Commissaire database.
-- Run: psql "<commissaire_live connection>" -f verify.sql
-- Every query should return the "expected" shown in its comment.

-- 1. All migrations applied. Expected: 001…008, eight rows.
SELECT version, "appliedAt" FROM schema_migrations ORDER BY version;

-- 2. All tables present. Expected: 17 rows, missing = false everywhere.
SELECT t AS table_name, to_regclass('public.' || t) IS NULL AS missing
FROM unnest(ARRAY[
  'schema_migrations', 'users', 'user_identities', 'sessions', 'otp_codes',
  'races', 'categories', 'riders',
  'invitations', 'race_members', 'contact_groups', 'contacts', 'contact_group_members',
  'race_events', 'race_snapshots', 'sync_cursors', 'official_versions'
]) AS t
ORDER BY 1;

-- 3. Privacy: no national ID / passport / free-form extra columns. Expected: 0 rows.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name ~* '(id_?number|national|passport|teudat|extra_?fields|birth)';

-- 4. Race isolation: every race-data table has a NOT NULL "raceUuid" that leads an index
--    (no foreign keys: the API keeps the relation). Expected: 8 rows, nullable = 'NO', indexed = true.
SELECT c.table_name, c.is_nullable AS nullable,
       EXISTS (
         SELECT 1 FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
         WHERE i.indrelid = ('public.' || c.table_name)::regclass AND a.attname = 'raceUuid'
       ) AS indexed
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.column_name = 'raceUuid'
ORDER BY 1;

-- 5. No triggers or stored functions: rules stay in TypeScript. Expected: 0 and 0.
SELECT (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema = 'public') AS triggers,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public') AS functions;

-- 6. Owner and access. Expected: owner = the Commissaire login role (not El Niño's); public_can_connect = false.
SELECT pg_get_userbyid(d.datdba) AS owner,
       has_database_privilege('public', d.datname, 'CONNECT') AS public_can_connect
FROM pg_database d WHERE d.datname = current_database();

-- 7. No foreign keys (policy: tables are independent). Expected: 0.
SELECT count(*)::int AS foreign_keys FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace;
