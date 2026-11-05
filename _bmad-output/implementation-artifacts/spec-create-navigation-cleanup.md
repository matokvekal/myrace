---
title: 'CREATE navigation cleanup'
type: 'feature'
created: '2026-10-28'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CREATE currently exposes a Results item in the shared Race Sidebar and a Team section in its tab navigation, although Results belongs in the other race modes and commissaire management is being relocated later.

**Approach:** Hide Results from the shared Race Sidebar and CREATE section navigation while CREATE is active, and remove the Team tab from CREATE. Preserve the Results page and existing Team component, data, and backend behavior.

**Boundaries & Constraints**

**Always:** Keep Results available from the other race modes and preserve existing sidebar behavior and layout.

**Never:** Delete Team/commissaire data, backend logic, database structures, or the Results page; do not build a replacement commissaire UI or make unrelated changes.

</frozen-after-approval>

## Implementation Notes

- Updated `RaceSidebar` and the Create section tabs so Results is absent in active Create mode but remains available in Race, Live, Results, and finalized-race navigation.
- Removed the Team tab and its page-level lazy mount from the race Create screen; retained `src/app/live/TeamPanel.tsx` and all team data/backend code.
- Switched tab-color selectors to stable tab identifiers so hiding entries does not change the remaining tabs' colors.
- Updated the existing sidebar smoke-test expectation. No test suite was run.
- A browser visual check could not be completed because permission to open the local page was denied.

## Review Triage Log

- Blind Hunter, finalized-race Results navigation: **patched** by preserving Results for finalized races.
- Blind Hunter, empty tabs for users with no remaining screen permissions: **low, not patched**; this only occurs when no other race screen is permitted, and adding a new fallback screen is outside the requested UI cleanup.
- Edge Case Hunter, empty tabs for users with no remaining screen permissions: **low, not patched** for the same scope reason; the All Races navigation remains available.
- Verification Gap, existing smoke test expected Results in Create: **patched** by updating the test to assert Create hides Results and Race retains it.
