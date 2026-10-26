-- 004 — The shared action log and synchronization.
--
-- race_events keeps the name of the app's IndexedDB "race_events" store. Every
-- shared change to a race (all 52 audited write paths, as the closed list of
-- action types below) is one row. Rows are appended, never updated or deleted
-- while the race exists; this is the race's audit history (AD-7) and the
-- source the rider state in 002 is computed from.

CREATE TABLE race_events (
  "actionId"        uuid PRIMARY KEY,            -- created on the device at tap time; the idempotency key
  "raceUuid"        uuid NOT NULL REFERENCES races (uuid) ON DELETE CASCADE,
  seq               bigint NOT NULL CHECK (seq >= 1), -- gap-free per race, assigned by the server
  type              text NOT NULL CHECK (type IN (
                      'AddLap', 'Undo', 'RiderFinished', 'LapCountCorrection', 'StatusCorrection',
                      'WaveStarted', 'WaveFinished', 'CategoryFinished',
                      'CategoryAdded', 'CategoryEdited', 'CategoryDeleted',
                      'RiderAdded', 'RiderEdited', 'RiderDeleted', 'RidersImported',
                      'RiderCheckedIn', 'CommentSet', 'RaceEdited', 'SettingChanged',
                      'MemberChanged', 'Finalized', 'Amended')),
  payload           jsonb NOT NULL,              -- refers to riders/categories by uuid
  heat              integer,                     -- wave the action concerns (set by the server); null = whole race
  "deviceTime"      timestamptz NOT NULL,        -- device clock at tap time, as sent
  "clockOffsetMs"   integer NOT NULL DEFAULT 0,  -- device → server clock offset measured before the tap, as sent
  -- The event's time on the server clock: deviceTime + clockOffsetMs. Laps are
  -- timed by it; a late (offline) delivery never changes it. See "clockCheck".
  "eventAt"         timestamptz NOT NULL,
  -- null = plausible; 'future' = dated after its own arrival, held to serverReceivedAt;
  -- 'offset_ignored' = offset beyond +/-24 h, device time used as is.
  "clockCheck"      text CHECK ("clockCheck" IN ('future', 'offset_ignored')),
  "deviceId"        text NOT NULL,
  "protocolVersion" integer NOT NULL,
  "userId"          uuid REFERENCES users (id) ON DELETE SET NULL, -- author (the signed-in account)
  "serverReceivedAt" timestamptz NOT NULL DEFAULT now(),           -- server clock on arrival (audit)
  applied           boolean NOT NULL,
  reason            text CHECK (reason IN ('not_member', 'forbidden', 'out_of_scope', 'race_official', 'locked', 'invalid', 'upgrade_required')),
  CONSTRAINT race_events_race_seq_key UNIQUE ("raceUuid", seq),
  CONSTRAINT race_events_reason_when_not_applied CHECK (applied = (reason IS NULL))
);
-- Catch-up and history for a member limited to some waves.
CREATE INDEX race_events_race_heat_idx ON race_events ("raceUuid", heat, seq);
-- Per-rider history ("what happened to bib 42").
CREATE INDEX race_events_rider_idx ON race_events ("raceUuid", (payload ->> 'riderUuid'))
  WHERE payload ? 'riderUuid';

-- The race as published (seq 0). Replaying race_events on top of it must give
-- the stored race state (tested, and checked by a periodic job).
CREATE TABLE race_snapshots (
  "raceUuid"  uuid NOT NULL REFERENCES races (uuid) ON DELETE CASCADE,
  seq         bigint NOT NULL CHECK (seq >= 0),
  data        jsonb NOT NULL,                    -- { race, categories, riders } as JSON
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("raceUuid", seq)
);

-- Where each device is: its sync cursor and queue depth, for catch-up and the
-- owner's team sync view. Reported by the device; one row per race and device.
CREATE TABLE sync_cursors (
  "raceUuid"     uuid NOT NULL REFERENCES races (uuid) ON DELETE CASCADE,
  "deviceId"     text NOT NULL,
  "userId"       uuid REFERENCES users (id) ON DELETE CASCADE,
  "lastSeq"      bigint NOT NULL DEFAULT 0,
  "pendingCount" integer NOT NULL DEFAULT 0 CHECK ("pendingCount" >= 0),
  "appVersion"   text,
  "lastSeenAt"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("raceUuid", "deviceId")
);

INSERT INTO schema_migrations (version) VALUES ('004-race-events');
