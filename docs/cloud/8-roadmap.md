# Cloud Roadmap

## V1 — current implementation (2026-07-04)

- Per-race roles (7) + permission helper, guards on lap/undo/DNF/DNS/check-in/race-delete
- Supabase: Google auth, 5 tables, full RLS, invite-by-email, claim on first login
- Local-first event sync: IDB queue → push, pull, realtime, offline flush
- Conflict V1: DB-enforced first-accepted-wins per race+rider+lap
- UI: Cloud tab (login/upload/invite/status), "Shared with me" download
- Docs: setup, architecture, security, database, testing plan, production checklist

**Open before V1 is "done":** execute the two-device test plan (`docs/cloud/3-testing.md`); Supabase project provisioning.

## V1.1 — finish the seams

| Item | Notes |
|---|---|
| Rider management permissions | Wire ADD/EDIT/DELETE_RIDER guards + `RIDER_EDITED` events into Riders/EditRiders screens; auto-upsert new riders to cloud instead of manual "Update cloud copy" |
| Heat synchronization | StartManager doesn't broadcast heat start (`timeStartRace`); add `RACE_STARTED` event type (SQL CHECK + client) so device B sees the clock start live |
| Better conflict resolution | Surface `rejected` events in the action log; "pull latest" button; incremental pull (`created_at > lastSyncedAt`); auto-repair rejected device from winning event even when screen closed |
| Role edit in place | Change a member's role without remove+re-invite |
| Categories as first-class sync | Own table or payload-diffing, so category edits (laps count!) propagate mid-race |
| Sync health UI | Global badge (not only Cloud tab): pending count, last sync time, realtime connected indicator |

## V2 — SaaS platform

| Item | Notes |
|---|---|
| Payments + subscription plans | Entitlements table + RLS server-side; Stripe; free tier = local-only (already natural) |
| Team / organization management | `organizations` + `org_users`; races belong to orgs; role templates per org |
| Public live timing | Anonymous read-only endpoint per race (signed public slug, no auth) — spectators watch the leaderboard live |
| Spectator mode | Read-only app shell over live timing; shareable link/QR at the venue |
| GPS | Track riders via phone GPS (map exists already); geofence auto-lap as assist to manual clicking |
| Push notifications | Rider finished / race started / sync conflicts — Web Push via service worker (PWA plumbing exists) |
| Self-hosting | Schema is plain Postgres; document `supabase start` + env switch for on-prem federations |

## Architectural invariants (do not break, any version)

1. Local-first: the app must run a full race with zero connectivity and zero account.
2. IndexedDB is the UI's source of truth; Supabase is a sync bus.
3. Client permission checks are UX; RLS is enforcement; both change together.
4. Events are immutable and client-id'd; corrections are new events.
