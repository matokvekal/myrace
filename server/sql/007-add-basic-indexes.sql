-- 007 — Basic indexes missing after the 001–005 review (no foreign keys: policy).
--
-- Reviewed against every query the API runs. Already covered by 001–005:
--   raceUuid on every race table (leading column of a primary key, unique
--   constraint or index), race membership (raceUuid, userId) and "My races"
--   (userId, active), rider bib (raceUuid, bibNumber), events by (raceUuid, seq),
--   wave catch-up (raceUuid, heat, seq), per-rider history
--   (raceUuid, payload->>'riderUuid'), live sync (raceUuid, changedSeq) on riders
--   and categories, invitations by tokenHash and raceUuid, sessions by
--   refreshTokenHash and active userId, identities by (provider, subject) and
--   userId, directory group members by groupId and contactId.
--
-- Missing: the Undo check run for every Undo Action (src/races/actions.ts) —
--   race_events WHERE "raceUuid" = $1 AND type = 'Undo' AND applied
--     AND payload->>'targetActionId' = $2
-- scans all of the race's events. A small partial index covers it.
--
-- Additive only, safe to re-run (IF NOT EXISTS), no data is changed.
-- Plain CREATE INDEX briefly blocks writes to race_events while it builds;
-- run it outside a live race (the table is small until then).

CREATE INDEX IF NOT EXISTS race_events_undo_target_idx
  ON race_events ("raceUuid", (payload ->> 'targetActionId'))
  WHERE type = 'Undo';

INSERT INTO schema_migrations (version) VALUES ('007-add-basic-indexes') ON CONFLICT (version) DO NOTHING;

-- Verification (read-only). Expected: one row, race_events_undo_target_idx.
SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'race_events_undo_target_idx';
