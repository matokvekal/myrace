-- verify.sql — read-only checks after running 001–005 on commissaire_live.
-- Run: psql "<commissaire_live connection>" -f verify.sql
-- Every query should return the "expected" shown in its comment.

-- 1. All migrations applied. Expected: 001…005, five rows.
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

-- 4. Race isolation: every race-data table has a NOT NULL "raceUuid" referencing races.
--    Expected: 8 rows, all nullable = 'NO' and references_races = true.
SELECT c.table_name, c.is_nullable AS nullable,
       EXISTS (
         SELECT 1
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage u ON u.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY' AND k.table_name = c.table_name
           AND k.column_name = 'raceUuid' AND u.table_name = 'races'
       ) AS references_races
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.column_name = 'raceUuid'
ORDER BY 1;

-- 5. No triggers or stored functions: rules stay in TypeScript. Expected: 0 and 0.
SELECT (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema = 'public') AS triggers,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public') AS functions;

-- 6. Owner and access. Expected: owner = commissaire_live; public_can_connect = false.
SELECT pg_get_userbyid(d.datdba) AS owner,
       has_database_privilege('public', d.datname, 'CONNECT') AS public_can_connect
FROM pg_database d WHERE d.datname = current_database();
