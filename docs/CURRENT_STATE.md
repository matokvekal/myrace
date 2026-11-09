# Commissaire — Current State (resume here)

**Updated:** 2026-11-09 · **Read with:** `AGENTS.md` (rules + procedures), `CLAUDE.md` (detailed feature notes)

## V1.0 — FINAL RELEASE (feature freeze, 2026-11-09)
| Item | Value |
|---|---|
| App version | **1.0.0** (`src/app/version.json`) |
| Branch / tag | `feature/trial-access` (based on 0.3.6 `ba62014`), tag **`v1.0`** — not merged into `main` |
| Scope | everything in 0.3.6 + **Keyboard Layouts** (10 layouts, Settings → KEYBOARD preview, per-device choice, Original A1 unchanged) + **Quick Trial Access** (migration **014**) + Cards / Keypad segmented control (CSS only) |
| Migrations | 013 `category-approvals` (0.3.5) and **014 `trial-access`** — additive, apply in order |
| Production env | `TRIAL_ACCESS_ENABLED=true`; `TRIAL_LINK_ISSUERS` defaults to `mictavim@gmail.com` (must be a VERIFIED email on that account) |
| Deployment | Linux production agent only (AGENTS.md §6). Never from Windows. |

**After V1.0:** Version 1 is frozen — bug fixes and user-feedback improvements only; enhancements go to the V1.1 backlog
(`docs/v2/DEVLOG.md`). Known V1.1 candidates from the release QA: owner can PATCH a trial judge to admin
(members route doesn't refuse it); client issuer check is a constant (`TrialLinks.tsx`) — keep it in step with
`TRIAL_LINK_ISSUERS`; KeyboardStudio texts not translated to Hebrew; a device already in a trial ignores a link to
another race; a person can get a new trial from the same link while uses remain (bounded by maxUses / link expiry).

---

## 1. Version, branch, commit, release
| Item | Value |
|---|---|
| App version | **0.2.0** (`src/app/version.json`) |
| Branch | `feature/v0.2-phase1` (pushed to `origin`; **not merged into `main`**) |
| Release commit | `047e47a5a5aa` ("Release 0.2.0 …"); later commits on the branch are docs only |
| GitHub release | `release-047e47a` — server + web archives + `SHA256SUMS` + install notes (incl. DB backup + migrations 011/012) |
| Production | **NOT deployed.** On 2026-11-07 `https://commissaire.us/api/v1/health` reported release `eeebf7e` (0.1.15 API; client 0.1.17). Deployment must be done by the Linux production agent from the release (this machine has no production access, and the project rule forbids deploying from it). |

## 2. Implemented in 0.2 (all on the branch)
- **Judges on one race (Phase 1):** per-race switch "Judges can record in this race" (`races.memberWrites`, owner only, default OFF); roles admin / start / counter / check-in / **results** / viewer with wave/category scope; invitations by link/QR (and email for verified emails); accept/decline/revoke; only the CURRENT owner can grant admin or Team-write overrides (incl. via invitation accept).
- **Original creator** (`races.createdByUserId`, immutable): only the creator soft-deletes a race, even after ownership transfer; others only hide it.
- **Audit:** all race changes in `race_events`; owner/admin operations as server-written `RaceAdmin` entries (publish, transfer, delete/hide, join code, invitations, member-writes) in the same transaction; org events in `audit_logs`.
- **Laps:** first write wins per rider + lap (a later report within the race's minimum lap time → not applied, reason `duplicate`, kept in the log); Results-judge corrections (lap count, DNF/DSQ/DNS, clear) with **Undo** as a new audited event (stale undo refused, reason `stale`); ranking after an upward correction = corrected count + last ACTUAL crossing (no invented times).
- **Sync/offline:** outbox in IndexedDB; refused actions KEPT for review ("N not applied" sheet, Dismiss only by the user); `duplicate` treated as resolved; LIVE **Sync** button (flush → authoritative snapshot, queue kept); one writer per race on the device (change sets and reloads never interleave); older snapshots never applied; concurrent-tap fix (positions from the live store).
- **Organizations backend** (no UI): accounts (personal + organization), members, judge-pool invitations, org races, `audit_logs`. Org creation = pending; admin rights granted in the DB only.
- **UI:** Team panel (judging switch, roles, link/QR with per-link roles, picker resets, email-verification hint), Results correction panel, Sync button, Info sharing behind an icon (modal).
- **Test infra:** isolated Docker PostgreSQL for DB tests (`cd server && npm run test:db`); full local stack for multi-browser E2E (`npm --prefix server run e2e:stack`, `--stop`).

## 3. Architecture and important files
| Area | Files |
|---|---|
| Shared rules (server + app) | `src/shared/race/{roles,access,actions,engine,state}.ts` |
| Server authorization | `server/src/races/access.ts` (`loadMembership`, `phaseAccess`, `isCreatorOf`) |
| Server actions (only write path) | `server/src/races/actions.ts` (`processActions`, `isDuplicateLap`, `checkUndoTarget`) |
| Server audit | `server/src/races/audit.ts` (`logServerEvent`), `server/src/accounts/accounts.ts` (`logAudit`) |
| Members / invitations | `server/src/members/routes.ts` |
| Organizations | `server/src/accounts/{routes,invitations,orgAccess,accounts}.ts` |
| Realtime | `server/src/realtime/socket.ts` (`refreshMemberSockets`, `refreshRaceSockets`) |
| App sync client | `src/app/services/live/liveClient.ts` (outbox, flush, applyChanges, loadSnapshot, syncRaceNow) |
| Live screen | `src/app/race/[id]/heat/[heatId]/{page.tsx,useLapRecording.ts}` |
| Team / sharing UI | `src/app/live/{TeamPanel,InvitePage,SyncNowButton,RejectedActions,RaceServerButton}.tsx` |
| Results corrections | `src/app/race/[id]/results/ResultCorrection.tsx` |

## 4. Database migrations and API changes
- **011-team-phase1.sql:** `races.createdByUserId` (backfill from snapshot seq 0), `races.memberWrites`, `invitations.declinedAt`, role `results` in both role CHECKs, `RaceAdmin` event type, reasons `stale` + `duplicate`.
- **012-organizations.sql:** `accounts`, `account_members`, `account_invitations`, `audit_logs`, `races.accountId` (+ backfill of personal accounts and race accounts).
- Both additive, no FKs/triggers (policy). Apply in order, each with `psql -1 -v ON_ERROR_STOP=1`, BEFORE the new API. 0.1.17 still runs on the migrated schema (rollback needs no DB restore).
- **New/changed API:** `PUT /races/:id/member-writes`; `GET /races/:id/history` rider projection adds `actionId`, `undone`, `laps`; `GET /races/:id/changes` reads one REPEATABLE READ snapshot; `POST /races`, `/races/publish` accept optional `accountId`; decline sets `declinedAt`; `/accounts`, `/organizations/*`, `/account-invitations/*`, `/me/account-invitations/*`. Release markers in `server/deploy/release-markers.txt`.

## 5. Tests and known issues
- Server unit + DB: **178/178**. Client unit: **617/617**. Typecheck: only 2 pre-existing errors (test files). Web + server builds OK.
- Multi-browser E2E (`tests/event-judges.spec.ts`, local stack): every step passes; the final Board comparison differs only in the elapsed time of riders still on course (two live clocks read a moment apart) — test artifact.
- Baseline (pre-0.2) failures: `docs/v2/baseline-issues.md` (guest-share ×8, create-race:36, i18n:44, ui-smoke:14; flaky full-race-e2e and CheckIn under load).
- Known limitations: email invitations need a verified email (password sign-ups → use link/QR; verifying via email-code would delete the password — needs a backend decision); Start/Finish controls not hidden by role (refused on use); Live doesn't leave on revocation (taps refused + listed); a lap shorter than the race minimum is refused permanently (use a correction); two judges entering the same RECAP lap both count; Team page doesn't refresh live.
- Deferred org QA findings (medium/low): accept/revoke lock order, concurrent accepts 500, `raceAccountFor` re-check after lock, invitation preview shows `forEmail`, invite volume limits — see `docs/v2/DEVLOG.md`.

## 6. Pending tasks and priorities
1. **Deploy 0.2.0** (Linux production agent, from `release-047e47a`), then confirm `/api/v1/health` reports `047e47a5a5aa`.
2. **Next feature: Rapid Lap Entry** — spec + OPEN questions: `docs/v2/rapid-lap-entry.md`. Not started.
3. Merge `feature/v0.2-phase1` into `main` — only with the user's approval.
4. Deferred 0.2 scope: Management UI (organizations), plans/limits/billing, Super Admin, org QA findings, multi-race client isolation audit, invitation list in the app.
5. Baseline e2e failures and the 2 type errors.

## 7. Resuming work — exact steps
1. `git checkout feature/v0.2-phase1 && git pull`; read `AGENTS.md`, this file, then `docs/v2/DEVLOG.md` (decisions) and the task doc.
2. Start Docker Desktop. Server tests: `cd server && npm run test:db`. Client: `npx vitest run`, `npm run typecheck`.
3. Multi-user E2E: `npm --prefix server run e2e:stack`, then `MULTIUSER_E2E=1 E2E_API_URL=http://localhost:4100 MULTIUSER_API=http://localhost:4100 E2E_BASE_URL=http://localhost:3100 npx playwright test tests/event-judges.spec.ts --workers=1`; stop with `npm --prefix server run e2e:stack -- --stop`.
4. Never touch production or `server/.env`; never deploy from this machine; never merge to `main` without approval.
