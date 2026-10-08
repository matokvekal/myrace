# AllRaces Folder Guide

Purpose

- Placeholder component; NOT currently wired into `main/page.tsx`'s "See All"
  flow, which renders race cards directly instead of using this component.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. AllRaces.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - AllRaces.tsx (trivial — renders a static "AllRaces." string, no props, no logic)
  - allRaces.module.css

Conventions

- Before extending this component, check whether `main/page.tsx`'s inline
  "See All" rendering should be migrated here instead, or whether this file is
  dead code that should be removed — do not assume it's on the active render path.

When To Update

- If/when "See All" is refactored to actually use this component
