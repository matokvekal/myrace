# Heat [heatId] Folder Guide

Purpose

- Live lap-recording screen for one wave/heat — the core race-day page.
  `handleRiderClick`-equivalent logic in `page.tsx` is the single most
  performance/correctness-critical path in the app.

Read Order

1. ../../../../../../AGENT.md
2. ../AGENT.md
3. page.tsx (largest file — tap-to-lap, board layout, joker strip, live timer)
4. useLapRecording.ts, useJokerQueue.ts
5. jokerCard/AGENT.md, RiderLiveModal.tsx, JokerResolveModal.tsx, VoiceSettingsModal.tsx

Immediate Children Summary

- Folders:
  - jokerCard (JokerCard.tsx — one unresolved-joker card in the "🃏 Unresolved" strip)
- Top-level files:
  - page.tsx (tap recording, `displayOrder` manual queue, reorder timers, live
    timer derivation, clear-board)
  - useLapRecording.ts (`recordLap`, persisted `riderActions` action log, undo)
  - useJokerQueue.ts (joker entries: timestamp + sequence, persisted per wave)
  - RiderLiveModal.tsx + riderLiveModal.module.css (double-tap modal: comment,
    status, history)
  - JokerResolveModal.tsx + jokerResolveModal.module.css (resolve a joker by
    typing a bib, backdates `recordLap` to the joker's `capturedAt`)
  - VoiceSettingsModal.tsx + voiceSettingsModal.module.css (voice-assist config
    for this heat)
  - heat.module.css (page-level layout, incl. >=600px/>=900px responsive rules)

Conventions — all from root CLAUDE.md "Live tap / undo" and "Joker button", read those first:

- Tapping a rider records a lap, then after a 1s flash drops them to the end of
  `displayOrder`; the pending move lives in `reorderTimersRef` per rider so an
  undo inside that window can cancel it.
- Every `riderActions` log entry carries `prevRider` (exact pre-tap snapshot) +
  `prevOrderIndex`. Undo restores from that snapshot — never rebuild from
  `lapsDetails`, which drops `elapsedTimeFromStart`/`position_category`.
- Status buttons are always ordered DNF -> DSQ -> DNS.
- `riderActions` persists to localStorage
  (`commissaire.actionLog.${raceUuid}:heat:${heatId}`) via `useLapRecording`'s
  `persistKey`; it hydrates synchronously and guards against writing the
  previous wave's log under a new key.
- Joker taps (bike icon, opt-in via `useJokerMode`) stamp a timestamp+sequence
  with NO rider lookup at tap time; resolving calls the same `recordLap`
  backdated to `capturedAt`, which is why undo works on resolved jokers for
  free. Blocked if the target rider already has a newer `timeArrive`.
  `recordLap`'s duplicate-tap debounce is keyed off real `Date.now()`, not the
  possibly-backdated `atTime`.
- The live clock derives from the earliest started rider's `timeStartRace` and
  FREEZES at the latest category `finishedAt` once the wave stops — never
  derive it from a "running" rider (resets to 0 on stop). `clearedWave` wipes
  the board to 00:00:00 without touching Results data.

When To Update

- Lap tap, undo, reorder, or action-log behavior changes
- Joker queue/resolve behavior changes
- Live timer or clear-board behavior changes
- Heat page responsive layout changes
