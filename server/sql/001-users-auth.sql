-- 001 — Accounts, sign-in identities, sessions and one-time codes.
-- New tables: the local app has no server accounts (its IndexedDB "users"
-- store is a device-only token list, not migrated). Column names follow the
-- client's camelCase JSON so rows go to the API without renaming.

CREATE TABLE schema_migrations (
  version     text PRIMARY KEY,
  "appliedAt" timestamptz NOT NULL DEFAULT now()
);

-- One person. Everything else points at users.id, never at an email.
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text,                              -- primary email, lowercase
  name        text NOT NULL DEFAULT '',
  "isActive"  boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (email) WHERE email IS NOT NULL;

-- How a user signs in. One user may have several (account linking):
--   password  : subject = lowercase email, "passwordHash" set (scrypt/argon2id, never plaintext)
--   google    : subject = Google "sub" (not the email)
--   email_otp : subject = lowercase email
--   sms       : subject = E.164 phone (feature-flagged off until enabled)
CREATE TABLE user_identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('password', 'google', 'email_otp', 'sms')),
  subject         text NOT NULL,
  email           text CHECK (email = lower(email)),
  "emailVerified" boolean NOT NULL DEFAULT false,
  "passwordHash"  text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "lastUsedAt"    timestamptz,
  CONSTRAINT user_identities_provider_subject_key UNIQUE (provider, subject),
  CONSTRAINT user_identities_password_hash CHECK ((provider = 'password') = ("passwordHash" IS NOT NULL))
);
CREATE INDEX user_identities_user_idx ON user_identities ("userId");

-- Refresh-token sessions (access tokens are short-lived JWTs and not stored).
-- Only a hash of the refresh token is kept; rotation links old → new.
CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  "refreshTokenHash" text NOT NULL UNIQUE,
  "deviceId"         text,
  "userAgent"        text,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "lastUsedAt"       timestamptz NOT NULL DEFAULT now(),
  "expiresAt"        timestamptz NOT NULL,
  "revokedAt"        timestamptz,
  "replacedBy"       uuid REFERENCES sessions (id) ON DELETE SET NULL
);
CREATE INDEX sessions_user_active_idx ON sessions ("userId") WHERE "revokedAt" IS NULL;

-- One-time codes for email OTP and (later) SMS OTP. Only a hash of the code.
-- Expired or used rows are purged by a scheduled job after 24 h.
CREATE TABLE otp_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       text NOT NULL CHECK (channel IN ('email', 'sms')),
  destination   text NOT NULL,                    -- lowercase email or E.164 phone
  "codeHash"    text NOT NULL,
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "expiresAt"   timestamptz NOT NULL,
  "consumedAt"  timestamptz
);
CREATE INDEX otp_codes_destination_idx ON otp_codes (channel, destination, "createdAt" DESC);

INSERT INTO schema_migrations (version) VALUES ('001-users-auth');
