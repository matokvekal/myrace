# Testing

Two layers, one command each. Nothing here touches real data: Vitest runs against
an in-memory IndexedDB (`fake-indexeddb`, reset before every test), Playwright
runs in a fresh browser profile.

| Layer | Tool | Where | Run | Speed |
|---|---|---|---|---|
| Unit + integration | Vitest, React Testing Library, MSW | `src/**/__tests__/*.test.ts(x)` | `npm run test:unit` | ~25 s |
| Browser E2E | Playwright | `tests/*.spec.ts` | `npm run test:e2e` (or `test:full`) | ~4 min |
| Static checks | tsc, ESLint | — | `npm run typecheck`, `npm run lint` | ~1 min |

`npm run test:coverage` prints coverage and writes `coverage/` (HTML + lcov).

## Conventions
- Shared helpers live in `src/app/test/`: `setup.ts` (jsdom, fake IndexedDB, network
  blocked, per-test cleanup) and `factories.ts` (`makeRider`, `makeCategory`).
- Component tests assert on behaviour (what the commissaire sees and what ends up in
  the store / IndexedDB), not on markup. CSS-module class names are un-hashed under
  Vitest so structure like `.waveBlock` / `.catBlock` can be queried.
- Network is disabled in unit tests. When a test needs a file the app normally fetches
  (e.g. the CSV header dictionaries), serve the real file through MSW — see
  `src/app/utils/__tests__/raceCreation.test.ts`.
- Mock only the outside world (`services/cloud/*`, analytics, toasts). Use the real
  Zustand stores + IndexedDB so persistence and reload are actually exercised.

## What is covered
Standings (`calculatePositions`), waves/categories (`buildSchedule`, `riderInCategory`),
race creation + start-list import, rider registration and bib assignment, per-category
add-rider, edit-bib, check-in / DNS / Check All, standing + bib + name sorting, lap
recording (debounce, min lap time, finish, undo, board hold, persisted log), store
persistence across reload, and the finalized-race write lock.

## Local-race regression gate
Every change must keep a Local (never published) race working exactly as before.
The CI job "Playwright E2E (local-race regression)" runs the whole Playwright suite
with `VITE_SERVER_URL` unset (no sync server), and
`tests/local-race-regression.spec.ts` records laps, undoes one, reloads (the data
must come back from IndexedDB), opens Results, and fails if the app makes any
request outside its own origin. Run it alone with
`npx playwright test local-race-regression`.

## CI
`.github/workflows/ci.yml` runs on every PR / non-main push and is **called by
`deploy.yml`**: `build` needs `quality`, and `deploy` needs `build`. A failing
typecheck, lint error, unit test, build or Playwright test therefore blocks production.
Lint warnings do not fail the build; lint errors do.
