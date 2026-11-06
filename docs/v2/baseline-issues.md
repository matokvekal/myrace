# Known baseline issues (pre-existing in 0.1.17, NOT caused by 0.2)

Verified 2026-11-06 by running the same specs on `main` @ `4f00c68` (Release 0.1.17) and on
`feature/v0.2-phase1`. They fail identically on both. Do not count them as 0.2 regressions; do
not "fix" them by weakening tests. Each needs its own investigation.

| Spec | Test | Notes |
|---|---|---|
| tests/guest-share.spec.ts:57/65/93/101 (PC + phone = 8) | guest share pages | Likely needs a server-configured build (`VITE_SERVER_URL`) — local-only dev server in the default e2e run |
| tests/create-race.spec.ts:36 | new race opens on Create after another race left in Race mode | fails on 0.1.17 |
| tests/i18n.spec.ts:44 | switching language updates UI live | fails on 0.1.17 |
| tests/ui-smoke.spec.ts:14 | sidebar hides Results from Create | fails on 0.1.17 |

Flaky (not failing): tests/full-race-e2e.spec.ts:207 — once timed out under full-suite load; passes
alone and 3/3 repeated.

Pre-existing type errors (client test files only): `src/app/components/pwa/__tests__/serviceWorker.test.ts:84`,
`src/app/utils/__tests__/waveFinish.test.tsx:6`.
