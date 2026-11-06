# Commissaire 0.2 — Phase 2: Organizations (implementation plan)

**Branch:** `feature/v0.2-phase1` (continues; local only) · **Date:** 2026-11-06
**Source of truth:** `version2.md` (revised plan "Phase 3 — Accounts & organizations", renumbered
Phase 2 by the user) + Guidelines §4–§5 + approved decisions. Read `docs/v2/0-as-is.md` first.

## Approved rules this phase implements
1. One `accounts` table: `type personal|organization`. Every user has exactly one personal account.
2. Creating an organization does **not** make anyone an admin (Guidelines §5). It creates the
   organization `pending` and records who requested it. An admin (role owner/admin, status active)
   and the account status `active` are granted **in the database** (later: Super Admin app).
3. Organization membership (`account_members`, incl. the judge pool) grants **no race access**.
   Race access still comes only from `race_members` (+ the race owner).
4. Every race belongs to one account (`races."accountId"`). Existing races → their creator's
   personal account. The creator/owner/delete rules of Phase 1 are unchanged.
5. An active org admin/manager may: see the org's races list, create races for the org, invite
   members to the org judge pool, invite pool judges to an org race **through the race's existing
   invitation flow** (needs Team on that race — i.e. the race owner made them a race admin, or they
   own it). No implicit access to org races in this phase (no new authorization path).
6. Orgs are isolated: no endpoint reveals another org's members, invitations or races.
7. Audit: non-race events (org created, member added/removed/role changed, org invitation
   created/revoked/accepted/declined, org profile changed) go to ONE new table `audit_logs`, written
   in the same transaction. Race events stay in `race_events` (no duplication).
8. Policies kept: additive migrations, no FKs, no triggers, `REQUIRED_TABLES` updated, release
   markers per new route, nothing deployed.

## Manager defaults (routine; documented, not escalated)
- Personal account created lazily (`ensurePersonalAccount(userId)`) on first need + backfilled for
  every existing user by migration 012 — avoids touching the 3 sign-up paths in `auth.ts`.
- Org invitations: separate table `account_invitations` mirroring `invitations` (hashed one-time
  token, expiry default 14 days 1–90, revoked/declined/used), because `invitations."raceUuid"` is
  NOT NULL and every race query depends on it — lower regression risk than widening it.
- Org roles: `owner | admin | manager | judge | member`. Manage members/invitations: owner, admin.
  Manager: create org races, invite judges to the pool. Judge/member: see the org profile only.
- Org `slug`: lowercase `[a-z0-9-]{3,40}`, unique; name 2–80 chars.

## Increments (each: worker implements → focused tests → QA → manager accepts)
| # | Scope | Main files |
|---|---|---|
| P2-T1 | Migration 012 (accounts, account_members, account_invitations, audit_logs, races.accountId + backfill); `ensurePersonalAccount`; new races get `accountId` | `server/sql/012-*.sql`, `server/src/db/migrate.ts`, `server/src/races/repo.ts`, `server/src/accounts/*` (new), schema tests |
| P2-T2 | API: `GET /accounts` (mine + roles), `POST /organizations` (pending), `GET/PATCH /organizations/:id`, `GET /organizations/:id/members`, member role change/remove (owner/admin; owner protected); audit_logs | `server/src/accounts/routes.ts`, `server/src/app.ts` |
| P2-T3 | Org judge pool invitations: create (email/userId/link), list, revoke, accept/decline (`/account-invitations/:token`, `/me/account-invitations`); audit | same module |
| P2-T4 | Org races: create/publish with `accountId` (active org, role owner/admin/manager); `GET /organizations/:id/races` (org staff only; projection = name/date/status/owner, no race data); race list unchanged | `server/src/races/routes.ts` |
| P2-T5 | UI: main-menu "Management" → My accounts / Organizations (create → pending notice), org page (members, invite to pool, pending invitations), Create Race account picker, Team panel "Invite from org pool" | `src/app/manage/*` (new, lazy), `HeaderMain.tsx`, `TeamPanel.tsx`, `liveClient.ts` |
| P2-T6 | Full regression + Phase 2 report | — |

## Tests (DB, isolated container)
Cross-org isolation (A's admin can't read/modify B), pending org can't act, creator of a pending
org has no admin rights, judge pool gives no race access, invitation lifecycle (one-time, expiry,
decline, revoke, wrong account), owner protected, audit rows with the right actor and no secrets,
backfill (every user one personal account; every race an accountId), regressions of all Phase 1 tests.
