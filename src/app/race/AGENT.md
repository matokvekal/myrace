# Race Folder Guide

Purpose

- Race runtime flows: tabs, schedule, live heat recording, standings, and results.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. [id]/page.tsx (tab container)
4. [id]/raceMode/ and [id]/heat/[heatId]/
5. [id]/results/ and [id]/standing/[heatId]/

Critical Behavior

- Start flow must correctly stamp timeStartRace.
- Live tap/undo must restore exact rider snapshot and order.
- Ranking updates must avoid mutating source state directly.

When To Update

- Any race tab logic changes
- Heat action log behavior changes
- Status transition rules (running/finished/DNF/DSQ/DNS)
