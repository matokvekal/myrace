-- 015 — Phase 2 Smart Rider Import: the shared column-mapping dictionary.
-- What an organizer CONFIRMED a start-list column header means ("מספר חזה" → bibNumber),
-- with provenance (who, when, how often). Headers are stored normalized
-- (src/shared/import/columnMapping.ts normalizeHeader); never rider data, never
-- identity-document headers.
--
-- One row per (header, user): a user's latest confirmation replaces their earlier one.
-- Others' mappings are only offered as suggestions when they agree (resolveHeaderVotes);
-- the API never returns who confirmed what, only counts.
--
-- Additive only: one new table. No foreign keys (policy, see 006), no triggers or
-- functions (schema.test). Existing tables and rows are not touched. Safe to re-run.

CREATE TABLE IF NOT EXISTS column_mappings (
  header             text NOT NULL,
  "userId"           uuid NOT NULL,
  field              text NOT NULL,
  "timesConfirmed"   integer NOT NULL DEFAULT 1,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "lastConfirmedAt"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT column_mappings_pkey PRIMARY KEY (header, "userId"),
  CONSTRAINT column_mappings_header_len CHECK (char_length(header) BETWEEN 1 AND 100),
  CONSTRAINT column_mappings_field_len CHECK (char_length(field) BETWEEN 1 AND 40),
  CONSTRAINT column_mappings_times CHECK ("timesConfirmed" >= 1)
);
CREATE INDEX IF NOT EXISTS column_mappings_user_idx ON column_mappings ("userId");

INSERT INTO schema_migrations (version) VALUES ('015-column-mappings') ON CONFLICT (version) DO NOTHING;
