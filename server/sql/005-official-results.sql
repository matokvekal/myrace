-- 005 — Official results and amendments (AD-13).
--
-- The app keeps the finalized result on the race (RaceProps.finalized, a
-- RaceFinalization). Here each official version is a row, so an amendment adds
-- a version instead of overwriting: version 1 = Finalize, 2+ = Amendments. The
-- API returns the latest row in the same RaceFinalization JSON shape
-- (version, algo, at, by, nonce, payload, token, riderCount, categoryCount).

CREATE TABLE official_versions (
  "raceUuid"         uuid NOT NULL REFERENCES races (uuid) ON DELETE CASCADE,
  "officialVersion"  integer NOT NULL CHECK ("officialVersion" >= 1),
  -- RaceFinalization fields, same names
  version            text NOT NULL,              -- payload format tag
  algo               text NOT NULL DEFAULT 'SHA-256' CHECK (algo = 'SHA-256'),
  at                 timestamptz NOT NULL DEFAULT now(),
  by                 text NOT NULL,              -- display name of who issued it
  nonce              text NOT NULL,
  payload            text NOT NULL,              -- the exact hashed string
  token              text NOT NULL,              -- SHA-256 hex of payload
  "riderCount"       integer NOT NULL,
  "categoryCount"    integer NOT NULL,
  -- Server additions
  "issuedBy"         uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  signature          text NOT NULL,              -- Ed25519 server signature of token
  "keyId"            text NOT NULL,              -- which server key signed it
  "atSeq"            bigint NOT NULL,            -- race_events.seq the result was computed at
  "prevToken"        text,                       -- previous version's token (amendments)
  reason             text,                       -- why it was amended
  "includeActionIds" uuid[] NOT NULL DEFAULT '{}', -- not-applied actions this version accepts
  PRIMARY KEY ("raceUuid", "officialVersion"),
  CONSTRAINT official_versions_chain CHECK (("officialVersion" = 1) = ("prevToken" IS NULL)),
  CONSTRAINT official_versions_reason CHECK ("officialVersion" = 1 OR reason IS NOT NULL)
);

INSERT INTO schema_migrations (version) VALUES ('005-official-results');
