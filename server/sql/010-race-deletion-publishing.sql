-- 010 — Safe race deletion and public publishing (Race Access Rules).
--
-- Additive only: new NULL columns and one new table. No data is changed or
-- deleted, no foreign keys (policy, see 006). Safe to re-run (IF NOT EXISTS /
-- ON CONFLICT).
--
--   races."deletedAt" / "deletedBy"  Soft delete of an ACTIVE race by its owner: the
--                                    race disappears for everyone (API answers 410
--                                    race_deleted), every row and its full history
--                                    stay in the database. NULL = not deleted.
--   races."publishedAt"              The race is publicly readable through its share
--                                    link. NULL = not published (the link answers
--                                    404). Unpublish sets it back to NULL.
--   race_hidden                      A FINISHED race removed from one user's lists
--                                    only ("delete" of a finished race): the race and
--                                    its results stay for everyone else.

ALTER TABLE races ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz;
ALTER TABLE races ADD COLUMN IF NOT EXISTS "deletedBy" uuid;
ALTER TABLE races ADD COLUMN IF NOT EXISTS "publishedAt" timestamptz;

CREATE TABLE IF NOT EXISTS race_hidden (
  "userId"   uuid NOT NULL,
  "raceUuid" uuid NOT NULL,
  "hiddenAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "raceUuid")
);

INSERT INTO schema_migrations (version) VALUES ('010-race-deletion-publishing') ON CONFLICT (version) DO NOTHING;

-- Verification (read-only). Expected: 3 columns, 1 table, 0 foreign keys.
SELECT (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'races' AND column_name IN ('deletedAt', 'deletedBy', 'publishedAt')) AS new_columns,
       (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename = 'race_hidden') AS new_tables,
       (SELECT count(*)::int FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace) AS foreign_keys;
