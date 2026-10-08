# Standing [heatId] Folder Guide

Purpose

- Leaderboard/standing page for one wave: category-focused rider management,
  search/filter, category modal, add-rider modal, status modal (DNF/DNS/DSQ).

Read Order

1. ../../../../../../AGENT.md
2. ../AGENT.md
3. page.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - page.tsx (category filter/search, opens CategoryModal/AddRider/StatusModal
    from `race/components/modals` and `race/components/addRider`)
  - standing.module.css

Conventions

- Navigation/filtering here must respect the BUG-10 regression guard noted in
  the plan's Playwright coverage (`standing.spec.ts`) — leaderboard filter must
  not silently drop riders.
- Status changes applied here follow the DNF -> DSQ -> DNS button ordering used
  everywhere else in the app.

When To Update

- Standing page filter/search behavior changes
- Status-modal wiring or DNF/DSQ/DNS handling changes
