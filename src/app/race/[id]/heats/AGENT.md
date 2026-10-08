# Heats Folder Guide

Purpose

- Small tab listing categories grouped by heat number, each rendered as a
  `HeatCard` with a start action; a thin wrapper, not the live recording page
  (that's `heat/[heatId]/`).

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. Heats.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - Heats.tsx (dedupes categories by `heat`, sorts, renders
    `race/components/heatCard/HeatCard` per category with prev/next heat context)
  - heat.module.css

Conventions

- Delegates the actual card UI to `../../components/heatCard/HeatCard` — keep
  heat-numbering/sorting logic here, card rendering there.

When To Update

- Heat grouping/sort order changes
- Start-category wiring (`startCategory` callback) changes
