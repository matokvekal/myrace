-- 002 — Races, categories and riders: the same records the app keeps in
-- IndexedDB (stores "races", "categories", "riders"), field for field.
--
-- Names and types follow RaceProps / CategoryProps / RiderProps in
-- src/app/types/types.ts, so a row is the JSON the client already uses.
-- Differences (see docs/server/database.md):
--   * The server key is `uuid` for every record. Races already have one; riders
--     and categories get one at Publish. The numeric `id` stays device-local.
--   * Device-only fields are not stored (isFavorite, viewOnly, syncedAt,
--     serverVersion, isPrivate/password).
--   * No ID/passport data: riders have no "extraFields" column at all.
--   * Rider lap and position fields hold the current state computed by the
--     shared rules engine from race_events. Clients never write them directly.

CREATE TABLE races (
  uuid              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerUserId"     uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  "raceId"          text,                       -- readable "YYYY-MM-DD-name", not a key
  owner             text NOT NULL DEFAULT '',   -- display text, as today
  name              text NOT NULL,
  location          text NOT NULL DEFAULT '',
  time              text NOT NULL DEFAULT '',
  date              text NOT NULL DEFAULT '',
  image             text NOT NULL DEFAULT '',
  heat              text NOT NULL DEFAULT '',
  status            text CHECK (status IN ('upcoming', 'running', 'finished')),
  type              text NOT NULL DEFAULT '',
  "raceType"        text CHECK ("raceType" IN ('MTB', 'Gravel')),
  level             text NOT NULL DEFAULT '',
  orgenizer         text NOT NULL DEFAULT '',   -- spelling kept from RaceProps
  manager           text NOT NULL DEFAULT '',
  phone             text NOT NULL DEFAULT '',
  takanon           text NOT NULL DEFAULT '',
  site              text NOT NULL DEFAULT '',
  map               text NOT NULL DEFAULT '',
  distance          double precision NOT NULL DEFAULT 0,
  "isActive"        boolean NOT NULL DEFAULT true,
  -- Race settings (one object in the app; null = on, as today)
  "autoColor"       boolean,
  "leaderFinishAll" boolean,
  "waveColors"      jsonb,                      -- { "<heat>": "<colour>" }
  -- Course maps
  "mapCenter"       jsonb,
  "mapZoom"         double precision,
  "trackPoints"     jsonb,
  "mapMarkers"      jsonb,
  tracks            jsonb,
  -- Multi-user
  "joinCode"        text UNIQUE,                -- race code for the join link / QR (≥ 8 chars)
  "lastSeq"         bigint NOT NULL DEFAULT 0,  -- last race_events.seq (AD-6)
  "changedSeq"      bigint NOT NULL DEFAULT 0,  -- seq that last changed this row (catch-up)
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "lastUpdateAt"    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX races_owner_idx ON races ("ownerUserId");

CREATE TABLE categories (
  uuid            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceUuid"      uuid NOT NULL REFERENCES races (uuid) ON DELETE CASCADE,
  name            text NOT NULL,
  "subCategory"   text,                         -- legacy; new categories are null
  laps            integer CHECK (laps >= 0),    -- 0/null = not set yet
  "startTime"     text,                         -- scheduled "HH:MM", display only
  "isConnected"   boolean,
  color           text,
  heat            integer,                      -- wave number
  status          text CHECK (status IN ('upcoming', 'running', 'finished')),
  "linkedFinish"  boolean,
  "linkGroup"     text,
  "startedAt"     bigint,                       -- epoch ms, server clock (WaveStarted)
  "finishedAt"    bigint,                       -- epoch ms, as in CategoryProps
  "importOrder"   integer,
  "changedSeq"    bigint NOT NULL DEFAULT 0,    -- seq that last changed this row (catch-up)
  CONSTRAINT categories_name_key UNIQUE NULLS NOT DISTINCT ("raceUuid", name, "subCategory")
);
CREATE INDEX categories_race_heat_idx ON categories ("raceUuid", heat);
CREATE INDEX categories_race_changed_idx ON categories ("raceUuid", "changedSeq");

CREATE TABLE riders (
  uuid                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceUuid"             uuid NOT NULL REFERENCES races (uuid) ON DELETE CASCADE,
  "bibNumber"            integer,               -- plate number; never the seed order
  category               text NOT NULL,         -- category name, matched with subCategory as today
  "subCategory"          text,
  checked                boolean NOT NULL DEFAULT false,
  "firstName"            text NOT NULL DEFAULT '',
  "middleName"           text,
  "lastName"             text NOT NULL DEFAULT '',
  flag                   text,
  team                   text,
  standing               integer,               -- pre-race seed order
  heat                   integer,
  status                 text NOT NULL DEFAULT 'standing'
                           CHECK (status IN ('standing', 'running', 'finished', 'DNF', 'DSQ', 'DNS')),
  comment                text,
  image                  text,
  "chipNumber"           text,
  points                 double precision,
  "uciPoints"            double precision,
  federation             text,
  "uciNumber"            text,                  -- cycling licence number, not a national ID
  "viewOrder"            integer NOT NULL DEFAULT 0,
  -- Current race state, computed by the shared rules engine (never sent by clients)
  "raceStatus"           text NOT NULL DEFAULT 'upcoming' CHECK ("raceStatus" IN ('upcoming', 'running', 'finished')),
  "timeStartRace"        text,                  -- "HH:MM:SS" display copy of the wave start
  "timeArrive"           text,
  "lapsCounter"          integer NOT NULL DEFAULT 0 CHECK ("lapsCounter" >= 0),
  "lapsDetails"          jsonb NOT NULL DEFAULT '[]'::jsonb,
  "totalLaps"            integer NOT NULL DEFAULT 0,
  "elapsedLastLap"       text,
  "elapsedTimeFromStart" text,
  distance               double precision,
  position_start         integer,
  position_category      integer NOT NULL DEFAULT 0,
  position_race          integer NOT NULL DEFAULT 0,
  color                  text,
  "changedSeq"           bigint NOT NULL DEFAULT 0, -- seq that last changed this row (catch-up)
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX riders_race_idx ON riders ("raceUuid");
CREATE INDEX riders_race_bib_idx ON riders ("raceUuid", "bibNumber");
CREATE INDEX riders_race_changed_idx ON riders ("raceUuid", "changedSeq");

INSERT INTO schema_migrations (version) VALUES ('002-races');
