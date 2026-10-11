# Utils Folder Guide

Purpose

- Shared helper logic for timing, position/ranking, and utility transforms.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. timeUtils.ts
4. calculatePosition.ts

Risk Areas

- Position and timing calculations can silently regress race outcomes.
- Avoid mutating input collections unless explicitly intended and documented.

When To Update

- Any ranking formula or tie-break logic changes
- Time parse/format/start timer logic changes
