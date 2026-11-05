-- 009 — Ignored waves, bib colours, minimum lap interval, organizer preferences.
--
-- Additive only: new columns are NULL or have a default, so existing rows keep
-- their meaning; one new table. No foreign keys (policy, see 006). No data is
-- changed. Safe to re-run (IF NOT EXISTS / ON CONFLICT).
--
--   categories."ignored"       Wave ignored by the organizer (Ignore / Restore
--                              Wave): kept with all its riders and laps, left
--                              out of starts, laps, positions and results.
--   categories."bibColor"      Default bib background / text colour for the
--   categories."bibTextColor"  category's riders (normalized "#RRGGBB"; NULL =
--                              not set).
--   riders."bibColor"          Per-rider overrides of the two bib colours
--   riders."bibTextColor"      (NULL = use the category's).
--   races."minLapSeconds"      Minimum time between two counted passages of the
--                              same rider. NULL = 60 s, the rule every existing
--                              race was recorded with; new races get 180.
--   user_preferences           Reusable per-organizer preferences (e.g. learned
--                              Finish Group assignments), kept apart from race
--                              data: resetting a race never erases them.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS "ignored" boolean NOT NULL DEFAULT false;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS "bibColor" text;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS "bibTextColor" text;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS "bibColor" text;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS "bibTextColor" text;
ALTER TABLE races ADD COLUMN IF NOT EXISTS "minLapSeconds" integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'races_min_lap_seconds_range') THEN
    ALTER TABLE races ADD CONSTRAINT races_min_lap_seconds_range CHECK ("minLapSeconds" IS NULL OR "minLapSeconds" BETWEEN 0 AND 3600);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_preferences (
  "userId"    uuid NOT NULL,                     -- the organizer (users.id; kept by the API, no foreign key)
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  value       jsonb NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", key)
);

INSERT INTO schema_migrations (version) VALUES ('009-waves-bibs-laps-preferences') ON CONFLICT (version) DO NOTHING;

-- Verification (read-only). Expected: 6 columns, 1 table, 0 foreign keys.
SELECT (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'categories' AND column_name IN ('ignored', 'bibColor', 'bibTextColor'))
            OR (table_name = 'riders' AND column_name IN ('bibColor', 'bibTextColor'))
            OR (table_name = 'races' AND column_name = 'minLapSeconds'))) AS new_columns,
       (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_preferences') AS new_tables,
       (SELECT count(*)::int FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace) AS foreign_keys;
