# APPROVE RESULTS — official results published only after a judge's approval

**Status:** a SIMPLIFIED version is implemented (2026-11-16, see "Approve Results (1.2.1)" in
`CLAUDE.md`): one race-wide approval, owner/admin only, after Finish Race; RESULTS are public as
PROVISIONAL from Finish Race and OFFICIAL once approved; a later change withdraws it. Not built
from this spec: the RACE-screen button, hiding RESULTS until approval, the approved snapshot,
approval without Finish Race, a separate table. The text below is kept as the original proposal.

## 1. Business requirement

Official race results reach public spectators **only after an authorized judge explicitly
approves them**. Finishing waves, or even the whole race, no longer publishes anything by
itself. Public LIVE (provisional standings) stays available throughout.

```text
Race in progress
  → Wave 1 WAVE FINISH … Wave N WAVE FINISH
  → ALL WAVES FINISHED
  → APPROVE RESULTS shown in Judge Race Management
  → judge reviews results → APPROVE RESULTS → confirmation dialog
  → official RESULTS published to all spectators
```

## 2. What exists today (reuse, don't duplicate)

| Piece | Where | Role in this feature |
|---|---|---|
| WAVE FINISH | engine action `WaveFinished` (`src/shared/race/engine.ts`), Live/RACE "Finish Wave" (`FinishWaveModal`, `waveFinish.planWaveFinish`) | The ONLY signal that a wave is done. A wave = `category.heat`; done = every category of it `status === "finished"`. |
| Finish Race (finalize) | `utils/finalizeRace.ts`, server finalize transaction, `shared/race/finalPlan.ts` | Signed, irreversible close-out (owner-only). Keeps working as today. |
| Per-category podium approval | `category_approvals` (migration 013), `shared/race/approval.ts` `categoryResultFingerprint`, `invalidateChangedApprovals` | Pattern to copy: approve a fingerprint, auto-invalidate on any result change, audit in `race_events`. |
| Result signing | `RACE_FINALIZATION` / `RESULTS_SIGNING_KEY` | Unchanged; approval does not replace the signature. |
| Public projection | `server/src/public/routes.ts` `projectPublicState` | Where the server gate must be enforced. |
| Audit | `race_events` RaceAdmin entries (`server/src/races/audit.ts`) | Record approve / invalidate / re-approve. |

Ranking (`rankRiders`, `position_category`), podium eligibility and the RESULTS UI are reused
as they are.

## 3. Judge UI

- A large, prominent **APPROVE RESULTS** button on the **Judge Race Management** screen (the
  RACE screen of `race/[id]` in Race mode, where the wave cards and Finish Wave live).
- **Completely hidden** (not disabled) while any wave of the race has not been marked WAVE
  FINISH. It appears only when **all** waves are finished. Elapsed time, scheduled duration or
  "everyone crossed" never make it appear — only WAVE FINISH does.
- Shown only to judges allowed to approve (§5). Others see nothing.
- Click → confirmation dialog: summary (waves, categories, classified / DNF / DSQ / DNS counts,
  any category still Provisional), plus a typed confirmation `APPROVE` (same pattern as
  FINISH / APPROVED elsewhere). Confirm → server call → success state "Results published at
  HH:MM by <name>".
- After publication the button becomes a status chip **Published · <time> · <judge>**; when a
  later correction invalidates the publication (§6) it turns back into **APPROVE RESULTS (re-approve)**.

## 4. Server rules (the gate is the server, not React)

New Action-free admin endpoint, same style as category approval:

`POST /races/:uuid/results-approval {confirm: "APPROVE"}`

The server refuses unless ALL hold, re-checked inside the transaction:
1. the exact confirm word;
2. the caller may approve (§5);
3. **every wave is finished**: every category that has at least one rider is `finished`
   (a category with no riders is ignored; a wave closed without starting counts as finished,
   its riders are DNS — current `WaveFinished` rule);
4. the race is not deleted.

On success, store ONE current row per race, e.g. table `race_results_approvals`
(`raceUuid` PK, `approvedBy`, `approvedAt`, `fingerprint` = sha256 over every category's
`categoryResultFingerprint`, `snapshot` jsonb = the public results projection at approval),
plus a `race_events` RaceAdmin `resultsApproved` entry. New migration (015) — additive only,
no foreign keys (policy), add to `REQUIRED_TABLES` and the schema test.

Public API: `projectPublicState` exposes official results ONLY from a valid approval:
- no approval → the public payload carries `resultsStatus: "pending"` and no official
  classification (LIVE data — laps, crossings, status — stays, it is provisional);
- approved → `resultsStatus: "approved"`, `resultsApprovedAt` (time only, no judge identity
  in public, like category approvals) and the approved classification.
Finishing the race (`race.status = "finished"`) no longer publishes RESULTS on its own.
The spectator page switches its RESULTS gate from `race.status === "finished"` to
`resultsStatus === "approved"` (LIVE unchanged; "Race in progress" text becomes "Results are
being reviewed" once all waves are finished).

## 5. Who may approve

Proposal (to confirm): the race **owner**, an **admin** member, or a member with
`results.update` for the WHOLE race (all categories in scope) — the same family of rights as
`canApproveCategory` (`shared/race/access.ts`), extended to race scope. Members' writes off →
owner only. Trial users: never (proposal). One shared rule in `shared/race/access.ts`, used by
the button and the server.

Open: since 0.3.6 the invited judge (counter) has `results.update`. Decide whether invited
judges may publish, or only owner/admin (safer default: owner/admin only).

## 6. Corrections after publication

- Any result-changing path after approval (lap/status correction, name correction, Amend,
  late Action) runs in the same transaction as an invalidation check (copy
  `invalidateChangedApprovals`): fingerprint differs → approval marked invalid, audited
  `resultsApprovalInvalidated` (who/what caused it).
- Public side while invalid: keep showing the **last approved snapshot**, marked
  "Correction under review" (spectators never lose published results, never see unreviewed
  ones). Alternative to decide: hide RESULTS until re-approval.
- Re-approval = the same button and dialog; it replaces the current row; full history stays
  in `race_events`.
- Signed finalization: if the race was already finalized, corrections go through the existing
  Amend flow (new signed version) — unchanged.

## 7. Relation to Finish Race and podium approvals

- Finish Race (signed) stays owner-only and separate. Recommendation: APPROVE RESULTS does
  not require Finish Race (judges can publish on the day; the owner signs later); Finish Race
  does not publish. Open: whether to require Finish Race first.
- Per-category podium approvals stay as they are (they gate the podium display). Proposal: the
  approval dialog lists categories still Provisional; publishing does not auto-approve podiums.

## 8. Acceptance tests (when implemented)

- Server: approval refused with any wave unfinished / wrong word / unauthorized role / deleted
  race; accepted when all waves finished; public payload has no official results before, has
  them after; a correction invalidates (audited) and the public keeps the last approved
  snapshot; re-approval publishes the new one; concurrent approvals → one row.
- UI: button absent until the last WAVE FINISH (not after a timer); absent for non-approvers;
  confirmation required; chip after publishing; re-approve after a correction.
- Spectator page: RESULTS "being reviewed" until approved; LIVE unaffected throughout.
- Regression: Finish Wave, Finish Race, podium approval, result signing and Live timing unchanged.

## 9. Open questions

1. Who may approve (§5): owner/admin only, or also invited judges?
2. After a correction: keep last approved snapshot public, or hide RESULTS until re-approval?
3. Must Finish Race precede APPROVE RESULTS?
4. Exact screen placement and copy for "Judge Race Management" (RACE screen top vs. a footer).
