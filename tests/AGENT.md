# Tests Folder Guide

Purpose

- End-to-end and workflow regression coverage for the race app.

Read Order

1. ../AGENT.md
2. TEST.md
3. Spec related to your feature

Conventions

- Keep test names scenario-based and user-visible.
- Prefer fixtures from fixtures/ over ad-hoc inline CSV rows.
- Add/update tests for bug fixes in lap logic, status transitions, import mapping, and timing.

Critical Coverage Areas

- CSV import mapping and ordering
- Live lap recording and undo
- DNS/DNF/DSQ behavior
- Time parsing and race flow transitions
