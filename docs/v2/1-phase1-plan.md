# Commissaire 0.2 — Phase 1 Implementation Plan

**Status:** proposal, waiting for approval · **Date:** 2026-11-05 · **Baseline:** 0.1.17 (`4f00c68`)
**Inputs:** `version2.md`, `docs/v2/0-as-is.md`, approved decisions 1–4 (below).
**Scope rule:** extend `race_members`, `invitations`, `contacts`, `access.ts`, `race_events`,
Socket.IO. No new authorization or audit system. Local dev + `commissaire_test` only.

## Approved decisions → how they are implemented

| # | Decision | Implementation |
|---|---|---|
| 1 | Judge permissions are per race, not global | New `races."memberWrites"` (default **false**). Members write only in races whose owner switched it on. The env flag `COMMISSAIRE_MEMBER_WRITES` stays for tests only. |
| 2 | Only the current owner delegates admin | Server refuses (403 `owner_only_admin`) when a non-owner grants `admin`, edits or revokes an admin, or overrides `team` write access. |
| 3 | Keep transfer; original creator is immutable and is the only one who can delete | New `races."createdByUserId"`, backfilled from the seq-0 snapshot; never written after insert. Soft delete = creator only. |
| 4 | Results Judge: lap + status corrections; finalize/approve owner-only | New role `results` → `results.update` only. `Finalized`/`Amended` and `/finalize`, `/amend` stay owner-only (unchanged). |

---

## Steps (each one: change → its tests → typecheck → next)

### Step 0 — Baseline (no code)
- Run server unit tests + DB suite on `commissaire_test` (`TEST_DATABASE_URL`, see
  `docs/server/testing.md`), shared/client unit tests, typecheck. Record results in
  `docs/v2/1-phase1-report.md`. Failures found here are reported, not fixed silently.

### Step 1 — Migration `server/sql/011-team-phase1.sql` (additive, re-runnable)
```sql
ALTER TABLE races       ADD COLUMN IF NOT EXISTS "createdByUserId" uuid;          -- NULL = unknown (legacy)
ALTER TABLE races       ADD COLUMN IF NOT EXISTS "memberWrites" boolean NOT NULL DEFAULT false;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS "declinedAt" timestamptz;

-- Backfill: the ORIGINAL owner is in the published snapshot (seq 0), not in "ownerUserId" (transferable).
UPDATE races r SET "createdByUserId" = (s.data->'race'->>'ownerUserId')::uuid
FROM race_snapshots s
WHERE s."raceUuid" = r.uuid AND s.seq = 0 AND r."createdByUserId" IS NULL
  AND s.data->'race'->>'ownerUserId' ~* '^[0-9a-f-]{36}$';

-- Role list: + results (both CHECK constraints)
ALTER TABLE race_members DROP CONSTRAINT IF EXISTS race_members_roles_known;
ALTER TABLE race_members ADD CONSTRAINT race_members_roles_known
  CHECK (roles <@ ARRAY['admin','start','counter','checkin','results','viewer']::text[]);
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_roles_known;
ALTER TABLE invitations ADD CONSTRAINT invitations_roles_known
  CHECK (roles <@ ARRAY['admin','start','counter','checkin','results','viewer']::text[]);

-- Audit: one new server-written event type
ALTER TABLE race_events DROP CONSTRAINT IF EXISTS race_events_type_check;
ALTER TABLE race_events ADD CONSTRAINT race_events_type_check CHECK (type IN (<existing 22 types>, 'RaceAdmin'));

INSERT INTO schema_migrations (version) VALUES ('011-team-phase1') ON CONFLICT DO NOTHING;
-- Verification: races with NULL "createdByUserId" (exceptions report — not guessed), constraint list.
```
- No new tables, no FKs, **no triggers** (`schema.test.ts` forbids them) → immutability of
  `createdByUserId` is enforced in code (Step 3) and by a test.
- Applied **by hand** to `commissaire_test` only. Note: the API refuses to start until every
  migration is applied — a local API pointed at the production DB will refuse to start with
  011 present. That is the intended guard; never apply 011 to production in this phase.
- `server/sql/verify.sql`: add the 011 checks.

### Step 2 — Audit coverage via `race_events` (`RaceAdmin`)
One server-only event type; payload `{ op, ...details }`. Ops:
`ownerTransferred {from,to}`, `published`, `unpublished`, `deleted`, `hidden`,
`joinCodeRotated`, `invitationCreated {invitationId, email|userId|link, roles, waves}`,
`invitationRevoked {invitationId}`, `invitationDeclined {invitationId}`,
`memberWritesChanged {enabled}`. Never tokens, secrets, codes or join codes.

| File | Change |
|---|---|
| `src/shared/race/actions.ts` | add `RaceAdmin` to `ACTION_TYPES` + payload type |
| `src/shared/race/engine.ts` | `RaceAdmin` → no-op (same branch as `MemberChanged`) |
| `src/shared/race/access.ts` | `authorizeAction`: `RaceAdmin` → forbidden (server writes it, devices can't) |
| `server/src/races/audit.ts` **(new, small)** | `logServerEvent(d, raceUuid, actorId, type, payload)` + `announceSeq` — moved from `members/routes.ts` (`logMemberChange` becomes a call to it) |
| `server/src/races/routes.ts` | transfer, publication, join-code, delete/hide: change + audit in **one transaction** |
| `server/src/members/routes.ts` | invitation create/revoke/decline audited; reuse helper |

Devices can't send `RaceAdmin`: `payloadError` already rejects types without a device schema.
`/history` already exposes events to `team.view` only — no API change.

### Step 3 — Original creator + creator-only delete
| File | Change |
|---|---|
| `server/src/races/repo.ts` | `insertRace(d, state, createdByUserId)` writes the column; NOT added to `RACE_COLUMNS` / `SharedRace` (no engine/snapshot/projection change, never in an UPDATE) |
| `server/src/races/routes.ts` `POST /`, `POST /publish` | pass the caller as creator |
| `server/src/races/access.ts` | `loadMembership` also reads `createdByUserId`, `memberWrites`; `Membership.isCreator`; `accessSummary` adds `isCreator`, `memberWrites` (additive fields) |
| `server/src/races/routes.ts` `DELETE /:raceUuid` | `creator = createdByUserId ?? ownerUserId` (legacy NULL only). Creator + active race → soft delete for everyone (**membership not required**, so a creator removed after a transfer can still delete). Anyone else (incl. current owner after transfer) → hide for self. Finished race → hide (unchanged). |
| `src/app/services/live/liveClient.ts` (`AccessSummary`) | `isCreator?`, `memberWrites?` |
| `src/app/race/[id]/info/Info.tsx` | Danger Zone wording: "Delete race for everyone" only when `isCreator`; else "Remove from my races". No layout change. |

### Step 4 — Results Judge role
| File | Change |
|---|---|
| `src/shared/race/roles.ts` | `MEMBER_ROLES` + `results`; `PERMISSION_MATRIX`: `correctLapCount`, `setRaceStatus` → `results: "all"` |
| `src/shared/race/access.ts` | `ROLE_DEFAULTS.results` = view all except team + `results: {view, update}`. `authorizeAction` already accepts `["results","update"]` for `LapCountCorrection` / `StatusCorrection`; AddLap/Undo/Start/Finalize stay forbidden. |
| `server/src/members/routes.ts` | `rolesSchema.max(5)` → `MEMBER_ROLES.length` |
| `src/app/live/TeamPanel.tsx` | label for `results` (the `labels` record is typed — compile error if missing); i18n keys en/he |
| Results tab correction controls | verify they gate on `canOnScreen(race,"results","update")`; fix gate only if not |

### Step 5 — Admin delegation (owner only)
`server/src/members/routes.ts` + one pure function `delegationError(actorIsOwner, before, after)`
in `src/shared/race/access.ts` (so the app hides the same choices). A non-owner may not:
- give the `admin` role (PATCH member, POST invitations);
- change or revoke a member who is currently `admin`;
- set a `team` screen override with create/update/delete (back door to admin).
`TeamPanel.tsx`: hide the admin chip / admin members' edit for non-owners.

### Step 6 — Per-race member writes (decision 1)
| File | Change |
|---|---|
| `server/src/races/access.ts` | `phaseAccess(a, isOwner, memberWrites)`: keep writes if owner OR env flag OR `memberWrites` |
| `server/src/races/routes.ts` | `PUT /races/:raceUuid/member-writes {enabled}` — owner only, tx + `RaceAdmin memberWritesChanged`, then refresh every joined socket of the race |
| `server/src/realtime/socket.ts` | `refreshRaceSockets(raceUuid)` = `refreshMemberSockets` for each user in the room |
| `src/app/services/live/liveClient.ts` | `team.setMemberWrites(local, enabled)` |
| `src/app/live/TeamPanel.tsx` | owner switch "Judges can record in this race" (off by default) + one line explaining it |
| `server/deploy/release-markers.txt` | marker for the new route (no release made) |

### Step 7 — Invitation decline status
`server/src/members/routes.ts`: decline sets `declinedAt` (not `revokedAt`);
`invitationStatus` adds `declined`; accept refuses declined (410); `/me/invitations` hides
declined; organizer list returns `declinedAt`. `TeamPanel` shows "declined". Old rows that
were declined before 011 stay "revoked" (no guessing).

### Step 8 — Rejected offline actions kept for review; safe gating
| File | Change |
|---|---|
| `src/app/services/live/liveClient.ts` | `flush`: a rejected entry is **kept** in `live_outbox` with `rejected: {reason, seq, at}` instead of deleted; `outboxList` skips rejected for sending; `rejectedList(local)`, `dismissRejected(local, ids)` (explicit user action only). `notApplied` is loaded from IDB on start, so it survives reload. Same store, **no IndexedDB version bump**. Entries keep their `userId` (other accounts never see them). |
| `src/app/live/RejectedActions.tsx` **(new)** + `SyncBadge.tsx` | badge count opens a small list: time, type, rider/bib, reason; Dismiss per item / all |
| `src/app/services/live/liveBridge.ts` `canOnScreen` | shared race with **no** cached access → `false` (local races unchanged: `true`) |

### Step 9 — Docs
`CLAUDE.md` (Race Access Rules section), `docs/v2/1-phase1-report.md` (files, migration,
tests, risks). No commit unless you ask; no release, no deploy.

---

## Tests

**Shared / server unit (no DB)** — extend `src/shared/race/__tests__/access.test.ts`, `roles.test.ts`:
- `results` role: LapCountCorrection + StatusCorrection allowed; AddLap, Undo, WaveStarted,
  RiderEdited, Finalized, Amended forbidden; out-of-scope wave refused.
- `delegationError`: every case in Step 5; owner always allowed.
- `RaceAdmin` sent by a device → forbidden / invalid; engine no-op.
- `phaseAccess` with `memberWrites` true/false, env unset.

**DB (`commissaire_test`)** — new `server/test/db/team-phase1.test.ts`:
- Per race: member write refused while off; owner enables → applied; disabled → refused;
  open socket receives `race:access` each time; a second race of the same owner unaffected.
- Delegation: admin can't grant admin (PATCH + invite), can't edit/revoke an admin, can't add
  a `team` write override; owner can.
- Results judge: corrections applied; laps/start refused; `/finalize`, `/amend` → 403.
- Creator: new race has `createdByUserId`; after transfer the new owner's delete → hidden only;
  the creator (even after being revoked) → soft delete; finished race → hide; no API route
  changes `createdByUserId`; legacy NULL falls back to owner.
- Audit: each op in Step 2 writes exactly one `RaceAdmin` with the right actor and race; a
  refused op (403/404) writes none; no token/secret/joinCode in any payload.
- Invitations: decline → `declined`, cannot accept afterwards; expired; one-time reuse; revoked.
- Cross-race: rider uuid of race B in race A → `invalid`; Undo target in race B → `invalid`;
  actionId reused across races → `invalid`.
- Same user, same date: owner of A, start in B, counter in C, results in D, viewer in E —
  each action allowed only where the role allows.
- Backfill: a transferred race keeps its original creator (from seq 0).

**Client unit** — `src/app/services/live/__tests__/rejectedActions.test.ts` (fake IndexedDB):
rejected kept after reload, not re-sent, not shown to another account, removed only by Dismiss;
`canOnScreen` shared race without access → false; local race → true.

**Regression** — all existing suites must pass unchanged: `lifecycle`, `races`, `access-rules`,
`auth-isolation`, `schema` (update only its migration list), shared engine/finalPlan, client
`accountIsolation`, typecheck, build, `verify-dist`. Browser check of Team, Live, Info on
phone + desktop width; affected e2e specs only (per testing rules).

---

## Regression risks

| Risk | Mitigation |
|---|---|
| Members gaining write access unexpectedly | `memberWrites` defaults false per race; prod keeps env flag unset; test that existing races stay read-only for members |
| Transferred races: owner's "Delete" becomes "hide" | Expected per decision 3; wording in Info changes accordingly; test |
| Legacy races without a seq-0 snapshot | `createdByUserId` NULL → falls back to current owner (today's behaviour); migration lists them. **Please confirm this fallback.** |
| New role reaching an old app | role only displayed; screens computed by server. Ship app before enabling the role in prod |
| `race_events` CHECK replaced | done in one migration transaction; schema test + replay test; existing rows unaffected |
| Audit rows advance `lastSeq` | same mechanism as `MemberChanged` (already handled by devices via `announceSeq`) |
| `canOnScreen` stricter | write controls on a shared race appear only after access loads (already fetched on open); owner's local races unaffected |
| Rejected entries in `live_outbox` | sending path filters them; race delete cleanup removes them with the race (only case they leave without Dismiss) |
| Migration ordering | API refuses to start without 011; future release must run 011 before the new server |
| Existing escalation (admin → admin) closed | an existing admin member loses the ability to create admins; owner unaffected |

## Not in Phase 1
Accounts/organizations, plans/limits, super admin, audit UI screen (Phase 2), multi-race
client isolation audit (Phase 4).

## One question
Legacy races with no seq-0 snapshot (unknown creator): fall back to the current owner
(recommended — keeps today's behaviour), or nobody may delete them?
