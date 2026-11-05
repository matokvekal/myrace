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
| T0 | Isolated test DB (Docker), guards, runner, docs | done | pending |
