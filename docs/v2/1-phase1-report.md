# Commissaire 0.2 — Phase 1 Report

**Branch:** `feature/v0.2-phase1` (local only — not pushed, not merged, not deployed) · **Date:** 2026-11-06
**Log:** `docs/v2/DEVLOG.md` · **Plan:** `docs/v2/1-phase1-plan.md` · **Audit:** `docs/v2/0-as-is.md`

## Delivered
| # | Feature |
|---|---|
| T0 | Isolated Docker PostgreSQL for DB tests (`npm run test:db`), loopback-only `_test` guard, 3 stale tests fixed |
| T1 | Migration 011 (additive); original creator (`createdByUserId`, from snapshot seq 0); creator-only delete; `RaceAdmin` audit in `race_events` |
| T2 | Results judge role; owner-only admin delegation (incl. Team-write overrides) |
| T3 | Per-race member writes (owner switch, audited, live access refresh) |
| T4 | Invitation `declined` status; delegation enforced on accept/revoke |
| T5 | Rejected offline actions kept for review (never re-sent, per account, Dismiss only) |
| T6 | Results tab correction panel (laps / DNF·DSQ·DNS / Clear), confirms every change |
| T7 | Undo of a lap correction — new audited `Undo` event; stale undo refused (`stale`), also for late offline delivery and in amendments |

## Quality gates
- 7 independent QA reviews + 2 re-verifications; every finding fixed (3 security bypasses, 1 sync bug, 1 data-safety bug among them).
- Server unit + DB: **138/138**. Client unit: **all pass** (80+ files). Shared rules: 121.
- Typecheck: no new errors (2 pre-existing, in test files). Web + server production builds OK; release markers present; eager bundle unchanged vs 0.1.17.
- Playwright: 60 pass; 11 fail **identically on 0.1.17** (pre-existing); 1 load flake (passes alone and 3/3 repeated).

## Remaining issues / open items
1. **Business decision:** a lap correction *upward* ranks the rider by their last recorded crossing (existing engine rule). Confirm, or define a ranking rule.
2. Pre-existing e2e failures (not 0.2): guest-share ×8, create-race:36, i18n:44, ui-smoke:14.
3. Pre-existing type errors: `serviceWorker.test.ts:84`, `waveFinish.test.tsx:6`.
4. No invitation list in the app yet (declined visible via API only) — Phase 7 UX.
5. After "stop syncing", kept actions are no longer visible (the confirm says how many stay).
6. Minor: in one amendment, "stale" sees only corrections included earlier in that batch.
7. CI does not run `test:db` yet (pieces ready: `TEST_DB_NO_DOCKER=1`).

## Production
Nothing deployed. Migration 011 was applied ONLY to the throwaway test container. A future release
must run 011 before the new server (the API refuses to start otherwise). `memberWrites` defaults off,
so existing races keep 0.1.x behaviour until an owner switches it on.

## Readiness
Phase 1 is ready for local acceptance testing (two accounts on a shared race: switch judging on,
invite a counter + a results judge, record/correct/undo, revoke, delete as creator vs new owner).
