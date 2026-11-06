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
| T6 | Results judge correction panel (Results tab) | done | pending |

## Decisions taken by the manager (within the approved spec)
- `canOnScreen` NOT made stricter (planned in 1-phase1-plan Step 8): it would redirect an owner
  away from Live when the access cache is empty (offline after re-sign-in) — race-day regression
  risk; the server already refuses unauthorized writes.
- After an ownership transfer, the previous owner's pending admin-like invitations can no longer
  be accepted (preview shows canAccept=false). Follows decision 2 (only the CURRENT owner delegates admin).
- Existing test `races.test.ts` "transfer…" changed expectation (old owner = creator now deletes for
  everyone) — required by decision 3.
