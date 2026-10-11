# Standing Folder Guide

Purpose

- Route-level container for the per-wave standing/leaderboard page; the actual
  page lives one level down at `[heatId]/`.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. [heatId]/AGENT.md and [heatId]/page.tsx

Immediate Children Summary

- Folders:
  - [heatId] (the standing/leaderboard page itself, keyed by heat/wave id)
- No top-level files of its own — this directory exists only to hold the
  `[heatId]` dynamic route segment.

When To Update

- New standing-related routes added at this level
- Anything that changes how a heat id is resolved into a standing view
