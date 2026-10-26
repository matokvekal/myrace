-- 003 — Who may do what in which race, how people are invited, and each
-- organizer's reusable commissaire directory. All new: the local app has no
-- equivalent (its IndexedDB "roles" store is a device-only preset list).
--
-- Access is per race, in three independent parts (src/shared/race/access.ts):
--   roles        any set of admin, start, counter, checkin, viewer (FR-10).
--                The owner is races."ownerUserId" and always has full access.
--                No roles and no screen permissions = no access.
--   permissions  JSONB with overrides and data scope (MemberPermissions):
--                { "screens": { "<screen>": { "view": true, "create": false,
--                                              "update": false, "delete": false } },
--                  "waves": [3],              -- unset = all waves
--                  "categories": ["<uuid>"] } -- unset = all categories
--                Unset operations keep the role defaults. The API validates the
--                content (validatePermissions); the database checks the shape.

CREATE TABLE invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceUuid"      uuid NOT NULL REFERENCES races (uuid) ON DELETE CASCADE,
  email           text CHECK (email = lower(email)),            -- set: only this verified email may accept
  "userId"        uuid REFERENCES users (id) ON DELETE CASCADE, -- set: invite of an existing user
  "tokenHash"     text NOT NULL UNIQUE,                         -- hash of the link/QR secret; the secret is not stored
  roles           text[] NOT NULL DEFAULT '{}',
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "maxUses"       integer NOT NULL DEFAULT 1 CHECK ("maxUses" >= 1),
  "useCount"      integer NOT NULL DEFAULT 0,
  "createdBy"     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "expiresAt"     timestamptz NOT NULL,
  "sentAt"        timestamptz,                                  -- invitation email sent
  "revokedAt"     timestamptz,
  CONSTRAINT invitations_roles_known CHECK (roles <@ ARRAY['admin', 'start', 'counter', 'checkin', 'viewer']::text[]),
  CONSTRAINT invitations_permissions_object CHECK (jsonb_typeof(permissions) = 'object'),
  CONSTRAINT invitations_use_count CHECK ("useCount" BETWEEN 0 AND "maxUses")
);
CREATE INDEX invitations_race_idx ON invitations ("raceUuid");
CREATE INDEX invitations_email_idx ON invitations (email) WHERE email IS NOT NULL;
CREATE INDEX invitations_user_idx ON invitations ("userId") WHERE "userId" IS NOT NULL;

-- A membership exists only after the invitation was accepted (or for the
-- owner, created at Publish). Revoking keeps the row with "revokedAt".
CREATE TABLE race_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceUuid"      uuid NOT NULL REFERENCES races (uuid) ON DELETE CASCADE,
  "userId"        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  roles           text[] NOT NULL DEFAULT '{}',
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "invitationId"  uuid REFERENCES invitations (id) ON DELETE SET NULL,
  "addedBy"       uuid REFERENCES users (id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  "revokedAt"     timestamptz,
  CONSTRAINT race_members_race_user_key UNIQUE ("raceUuid", "userId"),
  CONSTRAINT race_members_roles_known CHECK (roles <@ ARRAY['admin', 'start', 'counter', 'checkin', 'viewer']::text[]),
  CONSTRAINT race_members_permissions_object CHECK (jsonb_typeof(permissions) = 'object')
);
CREATE INDEX race_members_user_idx ON race_members ("userId") WHERE "revokedAt" IS NULL; -- "My races"

-- An organizer's reusable directory: people (contacts) and named groups such as
-- "Federation A". Being in a directory grants no race access.
CREATE TABLE contact_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerUserId" uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          text NOT NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_groups_owner_name_key UNIQUE ("ownerUserId", name)
);

CREATE TABLE contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerUserId" uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          text NOT NULL DEFAULT '',
  email         text CHECK (email = lower(email)),
  "userId"      uuid REFERENCES users (id) ON DELETE SET NULL,   -- linked once the person has an account
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_reachable CHECK (email IS NOT NULL OR "userId" IS NOT NULL)
);
CREATE UNIQUE INDEX contacts_owner_email_key ON contacts ("ownerUserId", email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX contacts_owner_user_key ON contacts ("ownerUserId", "userId") WHERE "userId" IS NOT NULL;

CREATE TABLE contact_group_members (
  "groupId"   uuid NOT NULL REFERENCES contact_groups (id) ON DELETE CASCADE,
  "contactId" uuid NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  PRIMARY KEY ("groupId", "contactId")
);
CREATE INDEX contact_group_members_contact_idx ON contact_group_members ("contactId");

INSERT INTO schema_migrations (version) VALUES ('003-members-invitations-contacts');
