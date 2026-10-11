# RaceMode Folder Guide

Purpose

- Race-day operation mode: wave selector plus Start / Check-In / Board sub-tabs,
  entered from `race/[id]/page.tsx` when `isRaceMode` is true.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. RaceMode.tsx (tab container + wave selector)
4. StartManager.tsx (start flow), CheckIn.tsx, LiveBoard.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - RaceMode.tsx + raceMode.module.css (wave selector, switches Start/CheckIn/Board)
  - StartManager.tsx + startManager.module.css (largest file here — validates
    category groups, 60s countdown overlay, starts all categories in a start
    slot, stamps `timeStartRace` on every rider in the wave)
  - CheckIn.tsx + checkIn.module.css (pre-start roster check-in per wave)
  - LiveBoard.tsx + liveBoard.module.css, LiveCards.tsx + liveCards.module.css
    (live per-category board during a running wave, ranks via calculatePosition)
  - WaveStatus.tsx + waveStatus.module.css (running/finished status indicator per wave)
  - QuickAddRider.tsx + quickAddRider.module.css (add a rider mid-flow without
    leaving RaceMode)

Conventions

- `StartManager` is the only place that should set `timeStartRace` on riders —
  keep that stamping logic centralized here, not duplicated in CheckIn/LiveBoard.
- Category `laps` remains the source of truth for finishing a rider — never
  compare `rider.totalLaps` raw (see root CLAUDE.md "Laps: the category is the
  source of truth").
- Follow the DNF -> DSQ -> DNS status-button ordering used across the app.

When To Update

- Start-flow validation or countdown behavior changes
- Check-in roster rules change
- LiveBoard ranking/ordering behavior changes
