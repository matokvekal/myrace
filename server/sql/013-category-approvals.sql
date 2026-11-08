-- 013 — Commissaire 0.3.5: official podium approval per category + audited name correction.
--
-- Additive only: one new table and a widened CHECK. No row is changed or deleted, no foreign
-- keys (policy, see 006), no triggers/functions. Safe to re-run (IF NOT EXISTS / DROP ... IF EXISTS).
--
--   category_approvals   The CURRENT approval of a category's results (one row per race +
--                        category). "resultDigest" = sha256 of the category's result at the
--                        moment the judge typed APPROVED; the API treats the approval as void
--                        as soon as the result differs, and marks the row 'invalidated'
--                        (who/when/why). The full history (every approval and invalidation)
--                        is in race_events as RaceAdmin entries (categoryApproved /
--                        approvalInvalidated) — the race's one audit trail.
--   race_events.type     + 'RiderNameCorrected' (audited name fix after GO, reason required).

CREATE TABLE IF NOT EXISTS category_approvals (
  "raceUuid"          uuid NOT NULL,
  "categoryUuid"      uuid NOT NULL,
  status              text NOT NULL CHECK (status IN ('approved', 'invalidated')),
  "resultDigest"      text NOT NULL,
  "approvedBy"        uuid NOT NULL,
  "approvedAt"        timestamptz NOT NULL DEFAULT now(),
  "approvedSeq"       bigint NOT NULL,
  "invalidatedAt"     timestamptz,
  "invalidatedBy"     uuid,
  "invalidatedReason" text,
  PRIMARY KEY ("raceUuid", "categoryUuid")
);

ALTER TABLE race_events DROP CONSTRAINT IF EXISTS race_events_type_check;
ALTER TABLE race_events ADD CONSTRAINT race_events_type_check CHECK (type IN (
  'AddLap', 'Undo', 'RiderFinished', 'LapCountCorrection', 'StatusCorrection',
  'WaveStarted', 'WaveFinished', 'CategoryFinished',
  'CategoryAdded', 'CategoryEdited', 'CategoryDeleted',
  'RiderAdded', 'RiderEdited', 'RiderNameCorrected', 'RiderDeleted', 'RidersImported',
  'RiderCheckedIn', 'CommentSet', 'RaceEdited', 'SettingChanged',
  'MemberChanged', 'Finalized', 'Amended',
  'RaceAdmin'));

INSERT INTO schema_migrations (version) VALUES ('013-category-approvals') ON CONFLICT (version) DO NOTHING;

-- Verification (read-only). Expected: the table exists (0 rows) and the CHECK lists RiderNameCorrected.
SELECT count(*) AS category_approvals FROM category_approvals;
SELECT pg_get_constraintdef(oid) LIKE '%RiderNameCorrected%' AS type_check_ok FROM pg_constraint WHERE conname = 'race_events_type_check';
