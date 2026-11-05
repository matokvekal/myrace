# Heat Folder Guide

Purpose

- Live lap recording workspace for a specific wave/heat.

Read Order

1. ../../../../../AGENT.md
2. ../../AGENT.md
3. [heatId]/page.tsx
4. Related hooks and modal components used by the heat page

Core Responsibilities

- Record rider lap passes quickly and reliably.
- Maintain action log integrity for undo and audit trail.
- Keep board ordering and status transitions consistent during live operation.

Critical Invariants

- Every heat action must stay scoped to race UUID and heat ID.
- Undo must restore the full previous rider snapshot and previous order index.
- Persistence keys for action logs must be heat-specific to avoid cross-wave leakage.

When To Update

- Lap tap, undo, reorder, or action-log behavior changes.
- Heat status flow changes (running/finished/cleared board).
- Any persistence-key or hydration behavior changes for live recording.
