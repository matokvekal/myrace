# Commissaire 0.2 — Phase 0: As-Is Audit

**Date:** 2026-11-05 · **Baseline:** 0.1.17 (`4f00c68`, branch `main`) · **Type:** read-only audit, no code changed
**Plan:** `version2.md` · **Next:** Phase 1 starts only after approval

---

## 1. Summary

The server already has a **complete multi-user race model**: per-race members with several
roles each, permissions per screen with wave/category scope, invitations (hashed tokens,
expiry, email verification, accept/decline), a personal contacts directory, an append-only
audit log of every race write, live updates filtered per member over Socket.IO, revocation
that closes the socket, and an offline outbox with per-action rejection reasons. There is
also a Team screen in the app (`/race/:id/team`).

**What it lacks:** member writes are switched **off** in production (owner-only phase,
`WRITES_OWNER_ONLY()`); there are no accounts, organizations, plans or limits; there is no
`createdByUserId` (the owner can change via `/transfer`); and a few owner actions are not
audited.

**So 0.2 Phase 1 is mostly *turning on and hardening* what exists, not building.** The
`version2.md` plan holds; section 9 lists the corrections.

---

## 2. Database (PostgreSQL, `server/sql/001–010`)

| Table | Purpose | 0.2 relevance |
|---|---|---|
| `users` | id, email (unique, lowercase), name, `isActive` | Identity — reuse. `isActive` = account disable switch |
| `user_identities` | password / google / email_otp / sms, `emailVerified` | Invitation-by-email check uses it |
| `sessions` | refresh-token hash, revocation | Socket auth checks session is live |
| `otp_codes` | email codes | — |
| `races` | `ownerUserId`, `joinCode`, `lastSeq`, `deletedAt`, `deletedBy`, `publishedAt`, … | Add `createdByUserId`, `accountId` |
| `categories`, `riders` | race data, keyed by `uuid` + `raceUuid` | Limit checks (rider count) |
| `invitations` | `raceUuid`, email or userId, `tokenHash`, roles[], permissions, `maxUses`, `useCount`, `expiresAt`, `sentAt`, `revokedAt` | Reuse as is (+ `declinedAt`) |
| `race_members` | `raceUuid`, `userId`, roles[], permissions JSONB, `invitationId`, `addedBy`, `revokedAt`; UNIQUE(race,user) | **This is "race_assignments"** — reuse |
| `contacts`, `contact_groups`, `contact_group_members` | an organizer's personal directory | **Personal judge pool** — reuse |
| `race_events` | append-only log: `actionId` (idempotency), `seq` gap-free, type, payload, heat, device/event times, `deviceId`, `userId`, `applied`, `reason` | **Race audit trail** — reuse |
| `race_snapshots` | seq-0 published state (+ later) | seq 0 holds the **original** `ownerUserId` → reliable creator backfill |
| `sync_cursors` | per device: lastSeq, pendingCount, appVersion | Team "devices" view |
| `official_versions` | signed final results | Finalize/amend (owner only) |
| `user_preferences` | per-user key/value | — |
| `race_hidden` | finished race hidden for one user | Keep |
| `schema_migrations` | applied versions | Migration 011+ append here |

**Rules found in the schema:**
- **No foreign keys** (migration 006, enforced by `no-foreign-keys.test.ts`). Integrity = unique
  constraints + CHECKs + API transactions under a `races` row lock. New tables must follow.
- Roles are hard-coded in **two CHECK constraints** (`invitations_roles_known`,
  `race_members_roles_known`: `admin,start,counter,checkin,viewer`). Adding a role = migration.
- API refuses to start if required tables are missing (`REQUIRED_TABLES`) — new tables must be
  added there when the code needs them.

---

## 3. Authorization

### 3.1 Model (shared code, used by server and app)
- `src/shared/race/roles.ts` — `MEMBER_ROLES` + `owner`; `PERMISSION_MATRIX` (12 business
  permissions: viewRace … deleteRace). **Documentation-grade**; enforcement uses 3.1 below.
- `src/shared/race/access.ts` — what is actually enforced:
  - 13 **screens** × view/create/update/delete; `ROLE_DEFAULTS` per role.
  - `effectiveAccess()`: union of the member's roles → per-member overrides → "no write without
    view" → wave/category **scope**. Owner = full, cannot be overridden.
  - `authorizeAction(access, action, state)` — per action type (AddLap, WaveStarted, RiderEdited,
    Finalized…): `forbidden` / `out_of_scope` / `invalid`.
  - `projectRace/Category/Rider/State` — what a member may *see*; `projectPublicState` for guests.

### 3.2 Server guards (`server/src/races/access.ts`)
- `loadMembership()` reads `races` + `race_members` **fresh on every request** (no JWT role
  caching). Unknown race and non-member both → 404; soft-deleted → 410.
- `phaseAccess()` strips every write from non-owners while `WRITES_OWNER_ONLY()` is true
  (env `COMMISSAIRE_MEMBER_WRITES` ≠ `1`). **Production runs with writes off.**
- `requireMember(…, [screen, op])`, `requireWriter`, `requireOwner`.

### 3.3 Where each rule is used
| Endpoint | Guard |
|---|---|
| `POST /races/:id/actions` (the ONLY race-data write path) | membership + `authorizeAction` per action, inside one tx with row lock |
| members list / invitations list | `team.view` |
| member PATCH/DELETE, invitation create/revoke | `team.update`; owner is protected (`owner_protected`) |
| join-code, share-link, publication, transfer | owner |
| `DELETE /races/:id` | owner + not finished → soft delete for all; otherwise → hide for this user |
| `GET /races/:id/history` | full audit needs `team.view`; a rider's history needs a view of that rider |
| finalize / amend | owner |

**Cross-race safety:** actions are applied to the state loaded *for the URL's race*; a rider or
category uuid from another race is not in that state → `invalid`. `Undo` checks its target's
`raceUuid`. An `actionId` reused from another race → `invalid`. Good — keep.

---

## 4. Invitations & members (`server/src/members/routes.ts`)

- Invite by **emails, user ids, directory contacts, contact groups, or an open link/QR** (`maxUses`).
- Secret: `randomToken(24)`, only `sha256` stored. Expiry **default 14 days, 1–90** configurable.
- Email invite → only an account that **verified that email** may accept (`canAccept`).
- Accept: one transaction, invitation row lock + race row lock, upsert `race_members`
  (re-activates a revoked member), `useCount+1`, `MemberChanged` written to `race_events`,
  member's sockets refreshed. Owner accepting own invite = no-op.
- `GET /me/invitations` (mine, still valid), accept / decline by id. **Decline sets
  `revokedAt`** — indistinguishable from an organizer's revoke.
- Status is derived: `valid / used / expired / revoked` (no `declined`, no `pending` column).
- Members: PATCH roles/permissions/scope, DELETE = soft revoke; both logged as `MemberChanged`.
- Owner gets an `admin` member row at create/publish; `/transfer` swaps owner, old owner → admin.

---

## 5. Audit

- `race_events` = full audit of every race write: author `userId`, `deviceId`, device time,
  server receive time, `applied`, `reason`. Rejected attempts are stored too.
- Membership changes are logged there (`MemberChanged`).
- **Not audited today** (gaps): `/transfer` (owner change!), publish/unpublish, soft delete /
  hide, join-code regeneration, invitation create/revoke/decline, sign-in/admin events.
- Device-side: `checkInChangesStore` (OPFS, per device) — separate, local only.

---

## 6. Realtime (Socket.IO, `server/src/realtime/socket.ts`)

- Namespace `/race`, server → client only. Handshake: access token **and** live session row.
- `join {raceUuid}` loads membership, stores it on the socket, joins room `race:<uuid>`;
  `leave` removes it.
- `publishChanges` sends each socket **its own projection** (hidden waves/riders removed);
  action results go to their author only.
- `refreshMemberSockets` on member change: updates access (`race:access`) or kicks
  (`race:revoked`). `closeRace` on delete.
- **Caveat:** membership is cached per socket at join time; anything that changes access
  *outside* the member routes (e.g. a future org-admin change, a DB edit, flipping the env flag)
  is not pushed until the device re-joins. 0.2 must call `refreshMemberSockets` from any new
  access-changing path.

---

## 7. Client: offline storage, sync, isolation

### 7.1 Storage inventory
| Store | Keyed by | Scoped to user? |
|---|---|---|
| IndexedDB `commissireDb` v10: `riders`, `categories`, `races`, `roles`, `users`, `race_events` | local id / race | **No** — device-wide; visibility filtered by `raceVisibleToAccount` |
| IDB `live_outbox` | `actionId`, index `byRace` | entry carries `userId`; `flush` sends only the signed-in user's entries |
| localStorage `commissaire.live.session`, `.lastUserId`, `.deviceId`, `.clock` | — | session = one account at a time |
| `commissaire.live.links` | local race → server race | No (device-wide) |
| `commissaire.live.access.<race>` | race | cleared on account change (`clearAccountState`) |
| `commissaire.live.accountRaces.<userId>` | user | **Yes** |
| `commissaire.live.pendingDeletes.<userId>`, `pendingPublish.v2` (per account) | user | Yes |
| `commissaire.actionLog.<race>:heat:<n>`, `commissaire.jokers.<…>` | race + wave | No |
| prefs (`language`, `boardHold`, `jokerEnabled`, `resultsVisibleFields`, `categoryTemplates`, `syncedRaces`…) | — | No (fine: UI prefs) |
| Service worker | never caches `/api/*` or `/socket.io/*` (0.1.15) | — |

### 7.2 Sync
- Every shared action → outbox first → `flush` batches ≤100 → server result per action.
- Rejected actions are **removed from the outbox** and kept in `sync.notApplied` (last 50) +
  a toast with a reason. Draft requirement "keep as Rejected, never silently drop" is
  **met in memory only** — the list is not persisted and has no review screen.
- 404 → race marked revoked; 410 → local copy removed; 426 → "update the app".
- One Socket.IO connection; opening another race `leave`s the previous room
  (`liveClient.ts:1145`). Catch-up is deduplicated per race.

### 7.3 Client permission gating
`canOnScreen(race, screen, op)` reads the cached access summary. **Returns `true` when no
access is cached** (local races) — correct for local races, but a shared race whose access
was not fetched yet briefly shows write controls; the server still refuses.

---

## 8. Tests

| Suite | Covers |
|---|---|
| `server/test/access-rules.test.ts` (unit) | share tokens, guest projection, guest polling |
| `server/test/db/lifecycle.test.ts` (runs **with `COMMISSAIRE_MEMBER_WRITES=1`**) | check-in / start / counter / owner rights, scope, filtered broadcasts, revoke closes socket, owner protected, idempotency, concurrent seq, finalize/amend |
| `server/test/db/races.test.ts` | publish, My Races incl. joined, join code, transfer, soft delete vs hide |
| `server/test/db/access-rules.test.ts` | owner-only writes, publish/unpublish |
| `auth-isolation`, `no-foreign-keys`, `schema`, … | account isolation, FK policy, schema |
| client: `accountIsolation.test.ts`, `serviceWorker.test.ts`, e2e `tests/*.spec.ts` | device-side isolation, SW |

HANDOFF notes several DB tests were "written, need test DB". **Before Phase 1: run the DB
suite on `commissaire_test` once to get a green baseline.**

Missing for 0.2: invitation decline/expiry/reuse tests, same user with different roles in
several races, cross-race uuid attack tests (behaviour exists, no explicit test), admin
privilege-escalation tests.

---

## 9. Gap analysis vs `version2.md`

| 0.2 requirement | Status | Work |
|---|---|---|
| Multiple roles per user per race | **Exists** | — |
| Permissions per action, server-enforced | **Exists** (screens + `authorizeAction`) | turn on member writes |
| Fresh permission checks (no JWT cache) | **Exists** | — |
| Invitations: hashed, one-time, expiry, accept/decline | **Exists** | add `declinedAt`; distinct declined status |
| Personal-race judges, no org needed | **Exists** (owner invites) | — |
| Personal judge pool | **Exists** (contacts/groups) | — |
| Assigned Races list | **Exists** server-side (`GET /races` = owned + joined + access); app shows role badge | UI polish only |
| Revoke → socket closed, future actions refused | **Exists** | — |
| Offline rejected actions not lost silently | Partial (toast + in-memory list) | persist + small review list |
| Race audit trail | **Exists** (`race_events`, `/history`) | audit screen; log transfer/publish/delete |
| Creator-only delete | **Missing** — owner deletes; owner is transferable | `createdByUserId` from seq-0 snapshot |
| Results judge role | Missing | new role + migration of 2 CHECKs |
| Accounts / organizations / org members / org judge pool | Missing | Phase 3 |
| Plans, limits, usage, super admin | Missing | Phase 5 |
| Non-race audit table | Missing | with Phase 2/3 |
| Multi-race client isolation | Mostly exists | Phase 4 audit + fixes |

---

## 10. Regression risks for 0.2

1. **Turning on member writes** changes production behaviour for every existing shared race
   that already has members (they were read-only). → Enable per race or keep the env flag off
   in prod until accepted; review existing `race_members` rows before enabling.
2. **Admin can grant admin** (anyone with `team.update` sets any roles, including `admin`, and
   creates invitations with `admin`). Fine for owner, risky for delegated admins. → Decide:
   only the owner may grant `admin`.
3. **Ownership transfer vs creator-only delete.** `/transfer` already exists and is not audited.
   Backfilling `createdByUserId` from `ownerUserId` would be **wrong** for transferred races;
   use `race_snapshots` seq 0 (`data.race.ownerUserId`) and report races without a seq-0 snapshot.
4. **Finished races cannot be soft-deleted today** (owner delete → hidden only). Creator-only
   delete must keep this, or the "finished results stay" guarantee breaks.
5. **Adding a role** needs the two CHECK constraints changed; old app versions receiving an
   unknown role must not crash (client `MEMBER_ROLES` lists it). Ship client first, then role.
6. **Socket membership cache**: new access paths (org admin, limits, flag flip) must call
   `refreshMemberSockets`, or devices keep stale rights until re-join.
7. **Local IDB is device-wide**; adding user-scoped keys would mean migrating offline data —
   do not rename existing keys. Prefer filtering (as `raceVisibleToAccount` does).
8. **`canOnScreen` defaults to allowed** with no cached access — harmless today (owner-only),
   visible once members write. Fetch access before showing Live controls on shared races.
9. **Limits on create/publish** would break today's "Create Race needs the server" flow if the
   error isn't handled — `saveRace` discards a refused new race. Must show the limit, not a
   generic failure.
10. **DB test baseline unknown** (HANDOFF). Without a green run first, new failures can't be
    attributed.

---

## 11. Corrections to `version2.md`

- Invitation expiry: already **14 days, configurable 1–90** — keep it (drop the "7 days" item).
- Invitation statuses: derive from existing columns + new `declinedAt`; no status column.
- "Assigned Races" needs no new API — `GET /races` already returns joined races with roles.
- Creator backfill source: **seq-0 snapshot**, not `ownerUserId`.
- Add to Phase 2: audit `transfer`, publish/unpublish, delete/hide, join-code (as
  server-written `race_events` rows like `MemberChanged`, or the new non-race audit table).

## 12. Recommended Phase 1 (smallest safe step)

1. Run the DB suite on `commissaire_test` → baseline.
2. Tests first for what exists: decline/expiry/reuse, cross-race uuid, same user with
   5 roles in 5 races, admin-grants-admin.
3. Migration 011 (additive): `invitations."declinedAt"`; `results` role in both CHECKs.
4. Decide and enforce: only the owner grants `admin`.
5. Enable member writes in **local dev** (`COMMISSAIRE_MEMBER_WRITES=1`); verify Live / Start /
   Check-In with a second account; fix gaps (`canOnScreen` default, roles indicator).
6. Persist `notApplied` and show it.
Production stays owner-only until you approve.

## 13. Decisions needed

1. Member writes in production: global switch, or opt-in per race? *(recommend per race)*
2. May a delegated admin grant `admin`? *(recommend: owner only)*
3. Keep `/transfer`? It conflicts in spirit with "creator is fixed". *(recommend keep; creator
   stays the original, delete stays with creator)*
4. Results judge: what exactly may it do — status/lap corrections only, or also amend after
   finalize? *(recommend corrections only; finalize/amend stay creator/owner)*
