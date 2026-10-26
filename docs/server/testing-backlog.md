# Multi-user testing backlog

Implementation runs first; this list is worked through in the final testing and
stabilization phase. Add to it whenever something is deferred.

## Known issues / decisions to confirm

- Role defaults: start, counter and check-in see every screen except Team, so
  they also receive private rider details (comment, chip, points, licence). If
  commissaires should not see those, remove `riders`/`checkin` view from their
  defaults in `src/shared/race/access.ts`.
- `src/app/race/[id]/raceMode/__tests__/CheckIn.test.tsx` "saves a new bib…"
  is flaky (about 1 run in 4, on main too): it reads "✓ Saved" synchronously.
- PGlite's socket adapter serves one connection at a time, so local dev uses
  `DB_POOL_MAX=1`; concurrency is only exercised against real PostgreSQL.
- `timeStartRace` on the server is the starting Device's local clock
  ("HH:MM:SS" from its ISO offset); lap times use the race clock (UTC ms).
- Laps are re-derived per rider from that rider's marks; first-finish-all-finish
  across riders is re-derived for the group, up to three rounds per Action.

- Client: a store write on a shared race shows locally a few ms before its
  Action is in the IndexedDB outbox (the bridge enqueues asynchronously); the
  lap screen writes its AddLap first. Tighten if a crash test shows a loss.
- Client: screen names in the permission grid fall back to English keys
  ("checkin") when the language is English; add English labels.
- Client: hidden screens are enforced (tabs, race-mode sub-tabs, Live, and
  store writes refused by the bridge); individual edit buttons are not yet
  hidden one by one — a refused write shows a toast.
- Client: `liveClient` applies server rows only for the race that is open;
  other shared races catch up when opened.
- A two-browser smoke (sign-up, share, invite link, accept, wave scope,
  check-in A→B, lap B→A, start-wave denial, offline lap after reconnect) passed
  against the local dev server; it is a scratch script, to become a Playwright spec.

## Deferred test cases

Server (vitest + supertest against PGlite):
- Migrations 001–005 apply and verify.sql checks pass (the scratchpad script → `server/test/`).
- Auth: register, login, wrong password, Google with a mocked verifier (new user,
  existing verified email links, unverified password account taken over), email
  code issue/verify/expiry/attempt limit, SMS endpoints 404 while disabled,
  refresh rotation and reuse detection, logout, logout-all.
- Races: publish strips unknown/ID fields, duplicate publish 409, My Races, join
  code only for members, delete owner-only, transfer.
- Actions: every Action type applied and not applied (locked, invalid,
  forbidden, out_of_scope, race_official, not_member for revoked members),
  idempotent re-send, gap-free seq under concurrent batches, 426 on old protocol.
- Engine parity with the app: min lap time, finish at total laps, finish after
  category end, first-finish-all-finish, wave close-out as finisher, prior-wave
  sweep, late offline lap inserted in time order, Undo of exactly its target,
  lap-count correction absorbs earlier laps, status never changes laps.
- Access: screen and wave restrictions on snapshot, changes, history, results,
  socket broadcasts; permission change and revoke reach open sockets.
- Invitations: email-bound acceptance needs that verified email, user-bound,
  open link maxUses, expired/revoked, decline, directory contacts and groups.
- Official: finalize closes waves, signature verifies with the public key,
  amendment includes only held-back Actions, chain prevToken.

Client and end-to-end (after client integration):
- Two browser contexts: rider/category/schedule edits, starts, manual and voice
  laps, finishes and results propagate both ways.
- Offline: queue actions, reconnect, all applied once; switching races keeps
  each race's outbox and data separate.
- Local-only races unchanged (local-race regression gate).
