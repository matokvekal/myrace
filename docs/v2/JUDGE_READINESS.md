# Judge Readiness — factual status (2026-11-07)

Branch `feature/v0.2-phase1` (local, not deployed). Sources: the code, the committed server DB
tests (real API + PostgreSQL + Socket.IO clients, isolated Docker DB), client unit tests, and the
E2E engineer's work in progress. **No browser end-to-end run with several judges has completed yet.**

Legend: **WORKING** = verified end to end (API+DB+sockets, or browser) · **PARTIAL** = works with a
limit or only part verified · **NOT WORKING** · **NOT TESTED** = code exists, no end-to-end proof.

## 0. The most important fact
**Production runs 0.1.17: there, members are read-only — only the owner can change a race.** All
judge write capabilities below exist only on this local branch (migrations 011/012 + new server).
Using them at an event requires a reviewed release and your explicit deployment approval.

## 1. Invitations
| Capability | Status | Facts |
|---|---|---|
| Invite an existing user | **PARTIAL** | By email: the account must have that email **verified** (email-code or Google sign-in). A password sign-up is not verified → "wrong account". By link/QR: works for anyone. Server: DB-tested. |
| Invite a new user | **PARTIAL** | Use **link/QR**: they register, open the link, accept. Email invite blocked for password sign-ups (above). A UI hint saying so is in progress (uncommitted). |
| Link / QR code | **WORKING** (server) / **NOT TESTED** (browser) | Team → "Create link + QR": one-time or up to N uses, expiry 1–90 days (default 14), token stored hashed. |
| Accept and access at once | **WORKING** (server) / **NOT TESTED** (browser) | `/invite/<token>` → sign in → Accept → membership created, race downloaded and opened. Revoked/expired/used/declined links refused. |

## 2. Judge capabilities
| Capability | Status | Facts |
|---|---|---|
| Full operational access without transferring ownership | **WORKING** (server) | Role **admin** = every screen view/create/update/delete, **provided the owner switched "Judges can record in this race" ON** (Team; off by default per race). Off = members are read-only. |
| See all race data | **WORKING** (server) | Admin/start/counter/check-in/results see all screens except Team; viewer sees Live, Board, Status, Results, Map, Info. Wave/category scope can limit a judge. Private rider details (comment, check-in, chip, points…) only to roles that see Riders/Check-In. |
| Record laps | **PARTIAL** | Role counter/admin; server enforced and DB-tested (concurrent batches, idempotent). **Critical bug found by E2E:** two judges tapping at the same moment overwrote each other's just-arrived laps on the device. Fix written (`useLapRecording.ts`, `heat/page.tsx`), **uncommitted, not yet QA-reviewed or re-verified**. |
| Start waves/riders | **WORKING** (server) | Role start/admin; one running wave at a time. |
| Update statuses (DNF/DSQ/DNS) | **WORKING** (server) | Counter/results/admin (Live, Results panel); check-in for DNS before start. |
| Correct results | **WORKING** (server) | Results judge/counter/admin: lap-count + status corrections in Results → rider details, with Undo (stale undo refused). |
| Owner-only operations | — | Finalize / Amend official results; Publish/Unpublish + public link; join code; transfer ownership; the "Judges can record" switch; granting admin / editing admins. **Delete for everyone = original creator only.** |

## 3. Multiple simultaneous users
| Capability | Status | Facts |
|---|---|---|
| 3–5 judges on one race | **PARTIAL** | Server: concurrent batches from 3 members get a gap-free sequence (DB test). Browser with 3+ judges: **NOT TESTED** (spec in progress). |
| Real-time sync / each sees the others | **WORKING** (server) / **NOT TESTED** (browser) | Socket.IO pushes each commit to every joined member, filtered by scope (DB tests with real sockets). The concurrent-tap overwrite above affects what a device *shows*. |
| Offline then reconnect | **WORKING** (server+client unit) / **NOT TESTED** (browser) | Actions queue in IndexedDB, sent on reconnect, applied once (idempotent by actionId), timed by tap time. Refused ones are kept under "N not applied" for review. |
| Revocation during a race | **WORKING** (server) / **NOT TESTED** (browser) | Revoke → socket loses access at once; later/offline actions refused (`not_member`) and kept for review. |

## 4. UI/UX
- **Invite:** race → **Team** tab (signed in, server build) → "Invite": emails / contacts / groups → "Send invitations", or **"Create link + QR"**.
- **Roles / full access:** Team → Members → "Edit access": role chips (admin, start, counter, check-in, results, viewer), waves, per-screen overrides. Only the owner can grant **admin**. **Turn on "Judges can record in this race"** (top of Team) or nobody but you can change anything.
- **Judge after joining:** the race opens on their device; it appears in My Races with their role badge; screens follow the role; a read-only note when judging is off.
- **Mobile:** layouts are responsive; the whole flow on a phone is **NOT TESTED** in a browser.

## 5. Critical blockers / missing
1. **Production has no judge writes** (0.1.17). Needs release + approval.
2. **Concurrent-tap overwrite** (critical) — fix uncommitted; needs QA + browser proof.
3. **No completed browser test with several judges** (spec `tests/event-judges.spec.ts` and the local full stack `server/scripts/e2e-stack.mjs` are in progress, uncommitted).
4. Email invites unusable for password sign-ups → use link/QR (UI hint uncommitted).
5. No list of sent invitations / their status in the app (API only).

## 6. Event readiness
**Not yet safe for a real event.** Minimum, in order:
1. Finish + QA the concurrent-tap fix; commit.
2. Complete the browser run: owner + 3 judges (counter ×2, start, results) on one race — invite by link, accept, judging on, simultaneous laps, results identical on all devices, offline → reconnect without duplicates, revoke mid-race. Fix any critical findings.
3. Full regression (server DB, client unit, typecheck, build, Playwright baseline).
4. Release candidate: version bump, release markers, deployment notes (migrations 011 → 012 in one transaction each, before the new server).
5. With your approval only: deploy, then a short rehearsal on production with 2–3 phones before the event.

Uncommitted work in the tree at the time of this report (E2E engineer): `src/app/race/[id]/heat/[heatId]/page.tsx`, `useLapRecording.ts`, `src/app/live/TeamPanel.tsx` (email hint), `public/locales/he/common.json`, `server/src/lib/core.ts` (test log level), `server/package.json`, `server/scripts/e2e-stack.mjs`, `tests/multiuser.spec.ts`, `tests/event-judges.spec.ts`, `docs/server/testing.md`.
