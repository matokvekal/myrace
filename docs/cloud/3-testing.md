# Cloud Sync — Two-Device Test Plan

**Status: NOT YET EXECUTED.** ⚠️ Requires a provisioned Supabase project (`docs/cloud/2-setup-supabase.md`) and two devices/browsers with different Google accounts. Fill the Result column as tests run; a test is only ✅ with the observation written down.

Automated coverage: none yet for cloud paths (see recommendations in `docs/cloud/9-stage2-summary.md`). Verified so far: `tsc` clean (one pre-existing casing error), `vite build` passes, local flow with cloud unconfigured unchanged (code-level no-op guards).

**Setup:** Device A = Google account #1 (creator). Device B = Google account #2 (invited). Both open the deployed app or `npm run dev` URL. B's email added as **Test user** in Google OAuth consent screen if the app is unpublished.

---

## Part 1 — Local-first regression (no login, run FIRST)

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 1.1 | Local app untouched | Fresh browser profile, NO `.env.local`. Create race, import riders, run heat, mark laps | Everything works exactly as before; Cloud tab says "not configured" | |
| 1.2 | Configured but logged out | With `.env.local`, do 1.1 again without logging in | Identical behavior; Cloud tab offers Google login | |
| 1.3 | IDB migration | Open app that previously had v8 data | Data intact; `commissireDb` version = 9 with `race_events` store (DevTools → Application → IndexedDB) | |

## Part 2 — Auth

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 2.1 | Google login | Cloud tab → Sign in with Google | Redirect → back logged in, email shown | |
| 2.2 | Session restore | Reload the app | Still logged in, no redirect | |
| 2.3 | Logout | Sign out | Cloud features show login button; local race still opens | |
| 2.4 | Offline startup | DevTools → Network → Offline → reload | App loads, previously-cached role still enforced, no crash | |

## Part 3 — Share flow

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 3.1 | Upload (A) | Race → Cloud → Upload race to cloud | "Up to date"; rows in `races`, `riders`, `race_users` (CREATOR) | |
| 3.2 | Invite (A) | Cloud tab → invite B's email as FINISH_JUDGE | B listed with role badge | |
| 3.3 | Accept (B) | B: main page → Shared with me → Sign in → race appears → Download | Local copy opens with riders; role badge FINISH_JUDGE in Cloud tab | |
| 3.4 | Isolation | B opens Supabase dashboard-free check: create own race on B, verify A cannot see it in "Shared with me" | Races are invisible without membership | |

## Part 4 — Live sync (A and B on the same heat screen)

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 4.1 | Lap A→B | A taps rider 101 | B sees rider 101 lap count +1 within ~2s, rider drops to queue end | |
| 4.2 | Lap B→A | B taps rider 102 | Same, reversed | |
| 4.3 | Undo | A records lap on 103, then double-tap → revert | B's 103 returns to previous lap count | |
| 4.4 | DNF / DNS | B marks 104 DNF; A marks 105 DNS | Both devices show statuses; check DSQ arrives as status DSQ (event type DNF) | |
| 4.5 | Check-in | B (or CHECKIN role) toggles check-in on Grid screen | A sees checkmark | |

## Part 5 — Offline & conflicts

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 5.1 | Offline queue | A: Network→Offline, mark 3 laps | Laps register instantly; Cloud tab "Offline — 3 saved locally" | |
| 5.2 | Reconnect | A: back Online | Auto-push within seconds (or Sync now); B receives all 3; badge "Up to date" | |
| 5.3 | Duplicate lap | A offline marks lap 4 for rider 101; B (online) also marks lap 4 for 101; A reconnects | B's event accepted; A's marked `rejected` (IDB), **results don't double-count**; A converges to B's data | |
| 5.4 | Both offline | A and B offline, each marks different riders, reconnect both | All events merge, no loss, no duplicates | |
| 5.5 | Rapid taps | Hammer one rider card 10× fast | Existing 500ms debounce + 1-min lap gap still hold; no event spam in `race_events` | |

## Part 6 — Permission enforcement (B = VIEWER)

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 6.1 | UI gating | A changes B's role to VIEWER (re-invite); B reloads | B: lap tap shows "No permission" toast; no invite section in Cloud tab | |
| 6.2 | RLS gating | B (as VIEWER) crafts an insert via console: `supabase.from('race_events').insert(...)` | Postgres RLS error 42501 — server refuses regardless of UI | |
| 6.3 | Delete race guard | B opens Info tab → delete | Blocked with message | |

---

## Definition of pass (mirrors the Stage 1 "Done when" list)

- [ ] Local race works without login (1.1–1.2)
- [ ] Admin uploads race (3.1), invites by email (3.2)
- [ ] Invited user logs in with Google and sees only allowed races (3.3–3.4)
- [ ] UI follows role (6.1), server enforces role (6.2)
- [ ] Two commissaires see lap updates live (4.1–4.5)
- [ ] Offline clicks saved locally (5.1) and sync on reconnect (5.2)
- [ ] Duplicate laps don't break results (5.3)

## Known observations during test authoring

- 5.3 convergence on the *rejected* device relies on the winning event arriving via realtime/pull; if A never receives B's lap-4 event (e.g. A stays on another screen), A's local count stays ahead until the next `pullRemoteEvents` on opening the heat. Acceptable V1; note for V1.1 conflict UI.
- Realtime requires the `race_events` table in the `supabase_realtime` publication — verify once per project (setup guide step 6).
