# Commissaire 0.2 — Development Log

Branch: `feature/v0.2-phase1` (local only, never pushed/merged without approval).
Plan: `version2.md` · Phase 1 plan: `docs/v2/1-phase1-plan.md` · Audit: `docs/v2/0-as-is.md`.

## Decisions
| Date | Decision | Source |
|---|---|---|
| 2026-11-05 | Member writes opt-in per race (`races.memberWrites`) | user decision 1 |
| 2026-11-05 | Only current owner delegates admin | user decision 2 |
| 2026-11-05 | Keep transfer; immutable original creator; only creator deletes | user decision 3 |
| 2026-11-05 | Results judge: lap/status corrections; finalize/amend owner-only | user decision 4 |
| 2026-11-05 | Legacy race with unknown creator (no seq-0 snapshot) → current owner may delete (today's behaviour) | manager default, reported for review |
| 2026-11-05 | DB tests run on isolated Docker PostgreSQL (user instruction), loopback-only guard | user instruction |
| 2026-11-06 | Lap corrections support Undo: new audited Undo event, stale undo refused | user decision |
| 2026-11-06 | Ranking after an UPWARD lap correction: keep engine behaviour — corrected lap count + the last ACTUAL recorded crossing time; never invent timestamps | user decision |
| 2026-11-06 | Phase 1 accepted; Phase 2 = Organizations | user |

## Baseline (before any 0.2 code)
- Client unit: 78 files / 571 tests pass. Server unit + DB (isolated): 108 tests, 4 failed before fixes:
  3 stale tests (race_hidden from 010 not in race-table checks; email codes now only for registered
  emails) + 1 caused by the stricter test-DB guard. All fixed, tests not weakened.
- Client typecheck: 2 pre-existing errors in test files (`serviceWorker.test.ts:84`,
  `waveFinish.test.tsx:6`) — exist on the untouched tree.

## Tasks
| # | Task | State | QA |
|---|---|---|---|
| T0 | Isolated test DB (Docker), guards, runner, docs | done | PASS w/ notes (fixed: sendMail assert, migration list) |
| T1 | Migration 011; original creator + creator-only delete; RaceAdmin audit | done | PASS w/ notes → fixed transfer seq (medium), delete re-check, requireWriter, hide notice |
| T2 | Results judge role; owner-only admin delegation | done | PASS w/ notes → fixed invitation-accept demotion bypass (medium), Team-override protection, admin-invite revoke |
| T3 | Per-race member writes (owner switch, audited, socket refresh) | done | PASS w/ notes → owner skipped in refresh, cached access sync |
| T4 | Invitation declined status (audited) | done | PASS w/ notes → decline only valid invites, deleted-race invites gone, transfer preview |
| T5 | Rejected offline actions kept for review | done | PASS w/ notes → detach notice, bottom sheet, preview = accept check |
| T6 | Results judge correction panel (Results tab) | done | PASS w/ notes → fixed: no Clear on finishers (HIGH), confirm every change, hidden before start, busy/error, i18n/a11y |
| T7 | Undo of a lap correction (user decision 2026-11-06): new audited Undo event, stale undo refused (`stale`), history exposes actionId/undone | done | PASS w/ notes ×2 → fixed: event-time order for stale, shared check in amendments + rider re-derive, newest-in-effect on client, self-exclusion |

## Decisions taken by the manager (within the approved spec)
- `canOnScreen` NOT made stricter (planned in 1-phase1-plan Step 8): it would redirect an owner
  away from Live when the access cache is empty (offline after re-sign-in) — race-day regression
  risk; the server already refuses unauthorized writes.
- After an ownership transfer, the previous owner's pending admin-like invitations can no longer
  be accepted (preview shows canAccept=false). Follows decision 2 (only the CURRENT owner delegates admin).
- Existing test `races.test.ts` "transfer…" changed expectation (old owner = creator now deletes for
  everyone) — required by decision 3.

## Phase 1 regression (2026-11-06)
- Server unit + DB (isolated Docker PG): 135/135. Client unit: 80 files / 583+ tests pass. Shared: 121.
- Typecheck: only the 2 pre-existing test-file errors. Web build + verify-dist OK; server build OK;
  new release markers present. Eager main chunk 85.19 kB gz — identical to baseline 0.1.17 (the
  "~65 kB" in CLAUDE.md is out of date; not changed by 0.2).
- Playwright (all specs, no server configured): 60 passed, 12 skipped, 12 failed. Baseline main
  (0.1.17) run of the same 12: 11 fail there too (pre-existing): guest-share ×8, create-race:36,
  i18n:44, ui-smoke:14. full-race-e2e:207 failed once under full-suite load; passes alone and 3/3
  repeated on this branch → timing flake, not a regression.

## Ranking ambiguity (documented per user decision 2026-11-06)
A lap correction changes the COUNT, not the timing. Ranking is "more laps first, then earlier last
arrival" (`rankRiders`). After an upward correction the rider's arrival time is their last ACTUALLY
recorded crossing — no timestamp is invented. Where timing data is insufficient this is ambiguous:
- Two riders with equal (corrected) laps: the corrected one is ordered by an older crossing, so may
  rank AHEAD of a rider who really crossed that lap later. Commissaires must check such pairs.
- A corrected rider with no recorded crossing at all has no arrival time; they rank after riders
  with the same lap count that have one (null arrival sorts last).
- Results show the count and the real last crossing; the correction itself is visible in the
  rider's history (Team/audit) — the official record stays explainable.
Baseline e2e/type issues: see `docs/v2/baseline-issues.md`.
