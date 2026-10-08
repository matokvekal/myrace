# Race [id] Folder Guide

Purpose

- Race workspace per race UUID, containing all race tabs and wave operations.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. page.tsx
4. schedule/, raceMode/, heat/, results/, standing/

Core Responsibilities

- Route-level tab orchestration for one race instance.
- Shared race context passed to subfeatures.
- Consistent behavior between setup mode and live race mode.

Critical Invariants

- Every action must stay scoped to the active race UUID.
- Changes in categories/riders must remain synchronized with store contracts.
- Live timing and status updates must not break offline persistence.

When To Update

- Tab structure or route composition changes.
- Shared race-level state behavior changes.
- Any cross-tab behavior that affects live operations.
