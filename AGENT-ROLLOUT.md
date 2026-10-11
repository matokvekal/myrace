# AGENT.md Rollout Tracker

Last updated: 2026-07-24
Mode: One-by-one

## Process Rules

1. Create only one new AGENT.md per step.
2. After each creation, mark it DONE in this file.
3. Keep remaining queue ordered; always work from top to bottom.
4. If session ends, continue from the first item marked TODO.
5. Quality gate for each AGENT.md:
   - Must include parent navigation reference (Read Order with ../AGENT.md chain).
   - Must summarize immediate child folders/files for that directory.
   - If no child folders exist, explicitly state "No child folders".

## Quality Audit Snapshot

- Source: AGENT-AUDIT.md
- Parent reference pass: 21/25
- Full child-summary pass: 18/25
- Status: Partial compliance, retrofit needed for existing files.

## Retrofit Progress (One-by-One)

1. DONE - src/app/components/AGENT.md (added immediate children summary)
2. DONE - src/app/AGENT.md (expanded immediate children summary)
3. DONE - src/app/main/AGENT.md (expand children summary coverage)

## Completed

0. src/app/race/[id]/raceMode/AGENT.md
0. src/app/race/[id]/schedule/AGENT.md
0. src/app/race/[id]/results/AGENT.md
0. src/app/race/[id]/standing/AGENT.md
0. src/app/race/[id]/standing/[heatId]/AGENT.md
0. src/app/race/[id]/riders/AGENT.md
0. src/app/race/[id]/categories/AGENT.md
0. src/app/race/[id]/categories/finishRider/AGENT.md
0. src/app/race/[id]/categories/racingRider/AGENT.md
0. src/app/race/[id]/info/AGENT.md
0. src/app/race/[id]/map/AGENT.md
0. src/app/race/[id]/editRiders/AGENT.md
0. src/app/race/[id]/heats/AGENT.md
0. src/app/race/[id]/heat/[heatId]/AGENT.md
0. src/app/race/[id]/heat/[heatId]/jokerCard/AGENT.md
1. AGENT.md
2. docs/AGENT.md
3. tests/AGENT.md
4. docs/public-assets.md (moved out of `public/` — never put docs there, they get
   published; see docs/github-pages.md)
5. src/AGENT.md
6. src/app/AGENT.md
7. src/app/stores/AGENT.md
8. src/app/race/AGENT.md
9. src/app/components/AGENT.md
10. src/app/types/AGENT.md
11. src/app/utils/AGENT.md
12. src/app/services/AGENT.md
13. src/app/hooks/AGENT.md
14. src/app/main/AGENT.md
15. src/app/login/AGENT.md
16. src/app/otp/AGENT.md
17. src/app/contact/AGENT.md
18. src/app/legal/AGENT.md
19. src/app/terms/AGENT.md
20. src/app/workers/AGENT.md
21. src/app/constants/AGENT.md
22. src/app/config/AGENT.md
23. src/app/styles/AGENT.md

## Queue (One-by-One)

Extended 2026-07-25 per plan `indexed-imagining-lollipop.md` Part 2 — full remaining
directory list under src/app + flagged non-src dirs (~65-76 items depending on how
grandchildren are counted). Supersedes the shorter version of this list below.

1. DONE - src/app/race/[id]/AGENT.md
2. DONE - src/app/race/[id]/heat/AGENT.md
3. DONE - src/app/race/[id]/raceMode/AGENT.md
4. DONE - src/app/race/[id]/schedule/AGENT.md
5. DONE - src/app/race/[id]/results/AGENT.md
6. DONE - src/app/race/[id]/standing/AGENT.md
7. DONE - src/app/race/[id]/standing/[heatId]/AGENT.md
8. DONE - src/app/race/[id]/riders/AGENT.md
9. DONE - src/app/race/[id]/categories/AGENT.md
10. DONE - src/app/race/[id]/categories/finishRider/AGENT.md
11. DONE - src/app/race/[id]/categories/racingRider/AGENT.md
12. DONE - src/app/race/[id]/info/AGENT.md
13. DONE - src/app/race/[id]/map/AGENT.md
14. DONE - src/app/race/[id]/editRiders/AGENT.md
15. DONE - src/app/race/[id]/heats/AGENT.md
16. DONE - src/app/race/[id]/heat/[heatId]/AGENT.md
17. DONE - src/app/race/[id]/heat/[heatId]/jokerCard/AGENT.md
18. DONE - src/app/race/components/AGENT.md
19. DONE - src/app/race/components/addRider/AGENT.md
20. DONE - src/app/race/components/buttons/AGENT.md
21. DONE - src/app/race/components/categoryCard/AGENT.md
22. DONE - src/app/race/components/categoryManager/AGENT.md
23. DONE - src/app/race/components/headerHeat/AGENT.md
24. DONE - src/app/race/components/headerRace/AGENT.md
25. DONE - src/app/race/components/heatCard/AGENT.md
26. DONE - src/app/race/components/modals/AGENT.md
27. DONE - src/app/race/components/raceInfo/AGENT.md
28. DONE - src/app/race/components/racePhaseSwitcher/AGENT.md
29. DONE - src/app/race/components/riderCard/AGENT.md
30. DONE - src/app/race/components/riderDetailModal/AGENT.md
31. DONE - src/app/race/components/riderFlag/AGENT.md
32. DONE - src/app/race/components/standingCard/AGENT.md
33. DONE - src/app/main/addRace/AGENT.md
34. DONE - src/app/main/allRaces/AGENT.md
35. DONE - src/app/main/myRaces/AGENT.md
36. DONE - src/app/main/components/AGENT.md
37. DONE - src/app/main/components/downloadRace/AGENT.md
38. DONE - src/app/main/components/emptyRaces/AGENT.md
39. DONE - src/app/main/components/headerMain/AGENT.md
40. DONE - src/app/main/components/raceCard/AGENT.md
41. DONE - src/app/main/components/raceTile/AGENT.md
42. DONE - src/app/components/arcade/AGENT.md
43. DONE - src/app/components/circleChart/AGENT.md
44. DONE - src/app/components/Footer/AGENT.md
45. DONE - src/app/components/headerLogo/AGENT.md
46. DONE - src/app/components/map/AGENT.md
47. DONE - src/app/components/otpbox/AGENT.md
48. DONE - src/app/components/Version/AGENT.md
49. DONE - src/app/components/voice/AGENT.md
50. DONE - src/app/components/csv/AGENT.md
51. DONE - src/app/components/importImage/AGENT.md
52. DONE - src/app/components/cloud/AGENT.md
53. DONE - src/app/components/auth/AGENT.md
54. DONE - src/app/components/header/AGENT.md
55. DONE - src/app/components/admin/AGENT.md
56. DONE - src/app/components/legal/AGENT.md
57. DONE - src/app/components/pwa/AGENT.md
58. DONE - src/app/components/ui/AGENT.md
59. DONE - src/app/loginerror/AGENT.md
60. DONE - src/app/services/cloud/AGENT.md
61. DONE - src/app/stores/indexDb/AGENT.md
62. DONE - src/app/landingV2/AGENT.md
63. DONE - scripts/AGENT.md
64. DONE - .github/AGENT.md
65. DONE - src/app/assets/AGENT.md
66. DONE - src/app/assets/appIcons/AGENT.md
67. DONE - src/app/assets/icons/AGENT.md
68. DONE - src/app/assets/images/AGENT.md
69. DONE - public/data/AGENT.md
70. DONE - public/data/locales/AGENT.md
71. DONE - public/images/AGENT.md
72. DONE - public/international/AGENT.md
73. DONE - public/ocr/AGENT.md
74. DONE - public/ocr/core/AGENT.md
75. DONE - public/ocr/lang/AGENT.md
76. DONE - public/tracks/AGENT.md
77. DONE - docs/cloud/AGENT.md

ALL ITEMS COMPLETE.

Note: src/app/hooks has no subfolders currently — item skipped (was conditional
"if added later" in the prior version of this queue).

## Current Pointer

- ROLLOUT COMPLETE (2026-07-25). All 75 queued files created (items 1-2 were
  already done from a prior session; retrofit item + items 3-77 done this
  session = 1 retrofit + 75 new files). Every directory under src/app, plus
  scripts/, .github/, and the flagged public/docs leaf dirs, now has an
  AGENT.md. src/app/components/AGENT.md and src/app/AGENT.md were verified
  compliant and intentionally left untouched per the plan.
- Nothing left in the queue. This tracker file's job is done — per the plan
  (`indexed-imagining-lollipop.md` Part 1), it should be deleted once the
  session confirms the doc-cleanup step for it (not done here — that's a
  separate Part 1 doc-cleanup task, out of scope for this Part 2 execution
  pass).
