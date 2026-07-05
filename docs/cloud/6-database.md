# Database Schema

Cloud Postgres schema (Supabase). DDL source of truth: `supabase/migrations/0001_cloud_schema.sql`.
Local IndexedDB (`commissireDb` v9) mirrors are noted per table.

---

## ER Diagram

```
                 ┌──────────────┐
                 │  auth.users  │  (managed by Supabase Auth)
                 └──────┬───────┘
                        │ 1:1 (trigger on signup)
                 ┌──────▼───────┐
                 │   profiles   │
                 └──────────────┘

 auth.users ──< created_by                    auth.users ──< created_by
        │                                             │
┌───────▼──────┐ 1:N ┌──────────────┐         ┌───────▼──────┐
│    races     │────<│  race_users  │>─────── │  auth.users  │ (user_id, nullable
└───────┬──────┘     └──────────────┘         └──────────────┘  until invite claimed)
        │ 1:N
┌───────▼──────┐ 1:N ┌──────────────┐
│    riders    │────<│ race_events  │>── auth.users (created_by)
└──────────────┘     └──────────────┘
```

All child tables cascade-delete from `races`. Deleting a race removes its users, riders, and events in one statement.

---

## Tables

### `profiles`
Mirror of `auth.users` that the app can read. Created automatically by the `on_auth_user_created` trigger at first login.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | = `auth.users.id`, cascade delete |
| email | text not null | from Google |
| display_name | text | Google full name |
| created_at | timestamptz | default now() |

### `races`
One row per shared race.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` — the **cloud id** |
| local_id | text | `RaceProps.uuid` on the uploading device; lets other devices adopt the same local uuid |
| name | text not null | |
| race_date | date | |
| status | text | `draft` default; mirrors app race status |
| payload | jsonb | **full `RaceProps` snapshot** — the app rebuilds a local race from this |
| created_by | uuid FK auth.users | uploader |
| created_at / updated_at | timestamptz | `updated_at` maintained by trigger `races_set_updated_at` |

Relationship: 1 race → N race_users, N riders, N race_events (all `on delete cascade`).

### `race_users`
Membership + role. **This table IS the permission system.**

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| race_id | uuid FK races | cascade |
| user_id | uuid FK auth.users | **nullable** — invite exists before the person ever logs in; `claim_race_invites()` fills it at their first login |
| email | text not null | invite key, matched case-insensitively |
| role | text CHECK | one of the 7 roles |
| created_by | uuid | who invited |
| created_at | timestamptz | |

Constraints: `unique (race_id, email)` — one role per person per race.
Indexes: `race_users_user_idx (user_id)`, `race_users_email_idx (lower(email))` — both serve `my_race_role()`, which runs inside every RLS check.

### `riders`
Rider snapshot per race. Bootstrap data for devices that download the race.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | cloud rider id (used by `race_events.rider_id`) |
| race_id | uuid FK races | cascade |
| local_id | text | `RiderProps.id` (numeric) on uploading device — push maps local→cloud with it |
| bib | text not null | |
| first_name / last_name / category / team | text | queryable columns |
| status | text | racing/DNF/… |
| payload | jsonb | **full `RiderProps` snapshot** |
| created_at / updated_at | timestamptz | trigger-maintained |

Constraints: `unique (race_id, bib)` — doubles as the upsert conflict target and as an index for race-scoped lookups.

### `race_events`
Append-only action log. No update/delete policies → immutable from clients.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | **client-generated** — global dedupe key across devices |
| race_id | uuid FK races | cascade |
| rider_id | uuid FK riders | cascade |
| bib | text | denormalized for resilient matching on receivers |
| event_type | text CHECK | LAP_MARKED, RIDER_CHECKIN, DNF, DNS, UNDO, RIDER_EDITED |
| lap_number | int | for LAP_MARKED / UNDO |
| event_time | timestamptz not null | when the action happened on the device |
| payload | jsonb | `{ riderLocalId, riderPatch: {…} }` — receivers merge riderPatch |
| created_by | uuid FK auth.users | RLS forces = auth.uid() |
| device_id | text | stable per-device uuid |
| status | text CHECK | `accepted` / `rejected` |
| created_at | timestamptz | server arrival time — pull ordering key |

Indexes:
- `unique_lap_event` — **partial unique** `(race_id, rider_id, lap_number) WHERE event_type='LAP_MARKED' AND status='accepted'` → duplicate-lap conflict rule, first accepted wins.
- `race_events_race_idx (race_id, created_at)` → pull + realtime filter path.

---

## Local IndexedDB mapping

| IDB store (commissireDb v9) | Cloud equivalent |
|---|---|
| `races` | `races.payload` |
| `riders` | `riders.payload` |
| `race_events` (indexes: `byRace`, `bySyncStatus`) | `race_events` (+ local-only `syncStatus` field) |
| `categories` | inside `races.payload` (no own table in V1) |
| `roles`, `users` | legacy token experiment — unused by the cloud system |

Local⇄cloud id mapping lives in `cloudStore.links` (localStorage): `{ localRaceUuid → { cloudId, myRole } }`; riders map at push time via `riders.local_id` / `bib`.

## Schema-change log

| Date | Change | Why |
|---|---|---|
| 2026-07-04 | Initial schema (5 tables, RLS, partial unique lap index) | Stage 1 |
| 2026-07-04 | `payload jsonb` added to races/riders vs. plan | decouple cloud schema from fast-moving app model |
| 2026-07-04 | `bib` added to race_events vs. plan | resilient rider matching on receiving devices |
| 2026-07-04 | Stage 2 review: riders_update tightened (removed FINISH_JUDGE, CHECKIN) | those roles act via events only; matrix says rider CRUD is RIDER_MANAGER+ |
| 2026-07-04 | Stage 2 review: `set_updated_at` triggers on races/riders | client-set timestamps were unreliable |
| 2026-07-04 | Stage 2 review: all policies got `drop policy if exists` guards; realtime publication wrapped in exception-safe DO block | script re-runnable during testing |
