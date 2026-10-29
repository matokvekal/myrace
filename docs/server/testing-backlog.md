# Multi-user testing backlog

Implementation runs first; this list is worked through in the final testing and
stabilization phase. Add to it whenever something is deferred.

## Testing phase results (2026-10-27)

| Suite | Result |
|---|---|
| Server integration (vitest + supertest + socket.io-client, PGlite PostgreSQL 17) | 44/44 |
| Shared model + engine unit tests | 91/91 |
| App unit tests (incl. live laps + store bridge) | 354/354 |
| Playwright, local-only app (CI mode) | 60/60 |
| Playwright multi-user, two signed-in browsers (`MULTIUSER_E2E=1`) | 1/1 |

Bugs found and fixed in this phase: refresh-token reuse revocation rolled back
with its own error; clock offsets above 1 day refused instead of flagged;
`server/src/config/env.ts` was never committed (root `.gitignore` ignores
`env.ts`); the sync badge was missing on the Live screen; the measured clock
offset was lost on reload.

## Stabilization results (2026-10-27, after the restart)

| Suite | Result |
|---|---|
| Server integration (+ races.test.ts: publish, My Races, join code, transfer, delete, signature verify) | 51/51 |
| App unit tests (+ 2 bridge regression tests) | 356/356 |
| Playwright, local-only app, against a server-enabled build | 60/60 |
| Playwright multi-user (2 tests: live laps; setup edits, per-race offline outbox, crash after an offline edit) | 10 of 10 runs green |

Bugs found and fixed:
- Client: a user's store write made while server changes were being applied was
  silently NOT sent (the "applying remote" flag was held across awaits). Now each
  remote write is flagged only during its synchronous start (`applyingRemote`).
- Client: store writes on a shared race made before the live client's dynamic
  import resolved were applied locally only. The bridge seam now defers them and
  replays them when the bridge is installed (new records get their uuid at once).
- Server: the API applied migrations by itself on any database. Now only the local
  PGlite dev database (`DEV_PGLITE=true` + loopback) is migrated; any other database
  is checked and the API refuses to start, naming the missing files.
- Test-only: CheckIn "saves a new bib" flake (read "✓ Saved" one render early);
  the bridge test leaked a restricted access between tests.

Harness note: `page.evaluate(import("/src/..."))` in the multi-user spec reads the
app's stores only on a dev server with no HMR history; restart Vite after editing
files before running it against a long-running server.

## Known issues / decisions to confirm

- Role defaults: start, counter and check-in see every screen except Team, so
  they also receive private rider details (comment, chip, points, licence). If
  commissaires should not see those, remove `riders`/`checkin` view from their
  defaults in `src/shared/race/access.ts`.
- Pre-existing, local app: `timeStartRace` is an "HH:MM:SS" clock string pinned
  to today's date, so a wave started just before midnight shows "—" as a total
  time after midnight (tests/waves-leaderboard.spec.ts failed once at 00:15).
  Shared races also store the wave start as an instant (`categories.startedAt`).
- PGlite's socket adapter serves one connection at a time, so local dev uses
  `DB_POOL_MAX=1`; concurrency is only exercised against real PostgreSQL.
- `timeStartRace` on the server is the starting Device's local clock
  ("HH:MM:SS" from its ISO offset); lap times use the race clock (UTC ms).
- Laps are re-derived per rider from that rider's marks; first-finish-all-finish
  across riders is re-derived for the group, up to three rounds per Action.

- Client: a store write on a shared race shows locally a few ms before its
  Action is in the IndexedDB outbox; a crash test (tab closed right after an
  offline edit) showed no loss.
- Client: hidden screens are enforced (tabs, race-mode sub-tabs, Live, and
  store writes refused by the bridge); individual edit buttons are not yet
  hidden one by one — a refused write shows a toast.
- Client: `liveClient` applies server rows only for the race that is open;
  other shared races catch up when opened.

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

## Future work

### Socket.IO lifecycle when a race is closed (not started)

Recorded 2026-10-27 for later development; nothing is implemented yet. "Closed"
means finalized (Finish Race / official result) or deleted. Server:
`server/src/realtime/socket.ts`; client: `src/app/services/live/`.

When a race is closed:
- Notify connected clients with a `race:closed` event (race uuid and reason:
  finalized or deleted).
- Remove every socket from that race's room.
- Refuse new subscriptions to a closed race.
- On reconnect, revalidate the race's status and the member's permissions
  before rejoining its room; never rejoin from cached client state.
- Remove the React socket listeners when the user leaves a race screen.
- Disconnect a socket that has no active race subscriptions left (idle).
- Keep historical results readable over REST (snapshot, results, official
  versions); only live updates stop.
