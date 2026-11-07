# Rapid Lap Entry — PROTOTYPE in 0.2.1 (feedback pending)

**Status:** specification draft from the user (2026-11-07). Not implemented. Items marked **OPEN** are
not approved requirements — they need the user's decision before implementation.

## Goal
Record laps fast when a bunch crosses the line: type bib numbers on a keypad (paper-like entry)
instead of finding cards, without losing anything the Live screen already guarantees.

## Requirements (from the user)
1. Live screen gets two modes with swipe navigation:
   - **Swipe right → keypad / paper-like entry mode.**
   - **Swipe left → the existing rider cards** (unchanged).
2. Numeric keypad with a **large Enter key**.
3. **Automatic acceptance** when the typed bib is unambiguous.
4. Handle **overlapping bib numbers** (e.g. 1, 18, 182): typing "1" must not record bib 1 while the
   user may still be typing 18 or 182.
5. **Clear the input immediately** after an entry is accepted.
6. A **visible history** of entries with **delete / correction** options.
7. **Invalid bib numbers are shown without interrupting entry** (no blocking dialog).
8. **Hide the Voice icon** when Voice is not enabled in Settings.
9. Preserve existing lap recording, offline support and multi-judge synchronization.

## Must reuse (do not duplicate)
- Recording: `recordLap(rider, "click", atTime)` in `src/app/race/[id]/heat/[heatId]/useLapRecording.ts`
  (same path as a card tap and a Joker resolution) → board hold, action log, undo, offline outbox,
  first-write-wins on the server (`duplicate` = already recorded by another judge).
- Time of a keypad entry = the moment it is **accepted**, unless an OPEN decision below says otherwise.
- Undo/delete of an entry = the existing action-log undo (`cancelAction` / Revert), never a local delete.
- Permissions: same as tapping a card (`canOnScreen(race, "live", …)`, server-enforced).
- Joker strip (unidentified riders) and its backdated resolution stay as they are.

## OPEN questions (decide before building)
- **OPEN — ambiguity rule:** when "1" is typed and 18/182 exist: accept only on Enter? accept after a
  pause (how many ms)? accept immediately when no longer bib starts with the input? Proposed: auto-accept
  only when no other started bib in the wave has the typed number as a prefix; otherwise wait for Enter.
- **OPEN — which time a typed entry gets:** time of the first digit, of acceptance, or "paper" mode
  where a timestamp is captured on a key press and bibs are attached later (like Jokers)?
- **OPEN — bib scope:** only riders of the current wave/started categories, or all race bibs (with
  a warning for other waves)? Judge wave scope must still apply.
- **OPEN — invalid entries:** keep them in the history as "not recorded" (re-assignable), or discard?
- **OPEN — duplicates within the minimum lap time** on the same device: warn inline, or silently
  rely on the server rule?
- **OPEN — layout:** keypad size/position on phones, landscape, left-handed use, haptic/sound feedback.
- **OPEN — swipe vs button:** is a visible mode toggle also needed (accessibility, desktop)?
- **OPEN — history length** and whether it is per device or the shared action log.
- **OPEN — Voice:** where "Voice enabled" lives in Settings today and whether hiding the icon also
  disables voice announcements.

## Acceptance (draft)
Unit tests for bib matching (1/18/182 cases), the history/undo flow and invalid entries; component
tests for the keypad; one multi-browser E2E: two judges, one on keypad and one on cards, same riders
→ identical results, duplicates resolved by the server, offline keypad entries arrive once.
