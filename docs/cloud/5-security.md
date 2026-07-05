# Security Model

Authentication, authorization, RLS, and the reasoning behind them.

---

## 1. Authentication

- **Provider:** Google OAuth only, via Supabase Auth. No passwords stored anywhere in this project.
- **Flow:** full-page redirect → Google → `https://<ref>.supabase.co/auth/v1/callback` → back to the app origin. supabase-js exchanges the code (`detectSessionInUrl: true`).
- **Session:** JWT access token + refresh token in localStorage, auto-refreshed by supabase-js. The JWT carries `sub` (user id) and `email` — RLS policies read both via `auth.uid()` / `auth.jwt() ->> 'email'`.
- **Anonymous use is a feature:** the whole app works with no account. Auth is required only to touch the cloud.

## 2. Authorization — the two-layer rule

```
Layer 1 (UX):     can(user, raceId, permission)  — client, instant, hides/blocks buttons
Layer 2 (TRUTH):  Postgres RLS                   — server, cannot be bypassed by any client
```

Never trust layer 1. Anything a modified client could attempt must be rejected by layer 2. When changing permissions, change **both** layers and keep them in agreement (client: `src/app/services/cloud/permissions.ts`; server: policies in `supabase/migrations/0001_cloud_schema.sql`).

## 3. Role → permission matrix

| Permission | CREATOR | ADMIN | MANAGER | RIDER_MANAGER | CHECKIN | FINISH_JUDGE | VIEWER |
|---|---|---|---|---|---|---|---|
| VIEW_RACE | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| EDIT_RACE | ✔ | ✔ | ✔ | – | – | – | – |
| DELETE_RACE | ✔ | ✔ | – | – | – | – | – |
| MANAGE_USERS | ✔ | ✔ | – | – | – | – | – |
| ADD/EDIT/DELETE_RIDER | ✔ | ✔ | ✔ | ✔ | – | – | – |
| CHECKIN_RIDER | ✔ | ✔ | ✔ | – | ✔ | – | – |
| MARK_LAP / MARK_DNF / MARK_DNS / UNDO_EVENT | ✔ | ✔ | ✔ | – | – | ✔ | – |
| EXPORT_RESULTS | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ |

Client source of truth: `ROLE_PERMISSIONS` in `permissions.ts`. Server equivalent: the RLS policies below.

## 4. RLS policies (what enforces what)

All 5 tables have RLS **enabled**; there are no service-role paths in the client.

| Table | select | insert | update | delete |
|---|---|---|---|---|
| `profiles` | own row | own row | own row | – |
| `races` | member or creator | `created_by = auth.uid()` | CREATOR/ADMIN/MANAGER or creator | CREATOR/ADMIN or creator |
| `race_users` | members of the race | CREATOR/ADMIN | CREATOR/ADMIN | CREATOR/ADMIN |
| `riders` | members | CREATOR/ADMIN/MANAGER/RIDER_MANAGER | same | same |
| `race_events` | members | per event type (below) + `created_by = auth.uid()` | – (no update policy → immutable) | – |

`race_events` insert is gated **per event type**, mirroring the matrix:

- `LAP_MARKED / DNF / DNS / UNDO` → CREATOR, ADMIN, MANAGER, FINISH_JUDGE
- `RIDER_CHECKIN` → CREATOR, ADMIN, MANAGER, CHECKIN
- `RIDER_EDITED` → CREATOR, ADMIN, MANAGER, RIDER_MANAGER

**Race isolation:** every policy resolves membership through `my_race_role(race_id)`, which looks up *my* row in `race_users` (by user id, or by invited email pre-claim). A user with no row in `race_users` for race X cannot select or write anything in race X — there is no "list all races" path.

**Immutable events:** no update/delete policy on `race_events` means history cannot be rewritten from the client — corrections are new events (`UNDO`).

## 5. Security-definer functions — the only privileged code

RLS policies on `race_users` cannot query `race_users` (infinite recursion), so two small `SECURITY DEFINER` functions exist:

- `my_race_role(race_id)` — read-only, returns my role in one race. Scoped to `auth.uid()` / JWT email; cannot leak other memberships.
- `claim_race_invites()` — sets `user_id = auth.uid()` on invite rows matching *my* JWT email. Idempotent; can only claim invites addressed to the caller's verified Google email.

Both pin `search_path = public`. Keep these functions minimal — they run with owner privileges.

## 6. Key decisions & threat notes

| Decision | Rationale |
|---|---|
| anon key ships in the client bundle | By design in Supabase — the anon key grants nothing by itself; every row access passes RLS. The `service_role` key must never appear in this repo. |
| Invites by email, pre-registration | `race_users.email` + nullable `user_id`. Risk: whoever controls that Google account gets the role — same trust model as sharing a Google Doc. |
| Local races have zero auth | Device owner owns local data; cloud rules attach only when data leaves the device. |
| First-accepted-wins via unique index | Conflict resolution in the DB removes any client-side trust decision. |
| Event `created_by` must equal `auth.uid()` (policy-enforced) | Prevents attributing actions to another commissaire. |
| Roles cached client-side for offline | A revoked user keeps *local UI* access until next online role refresh — but their pushes are rejected by RLS immediately. Acceptable for V1; document for users. |
| No rate limiting in app | Supabase applies platform limits; revisit before public SaaS (see production checklist). |

## 7. What is NOT protected (known, accepted for V1)

- A malicious *member* with FINISH_JUDGE can spam junk lap events for any rider in that race — same power a physical finish judge has; audit trail (`created_by`, `device_id`) makes it attributable.
- The race `payload` snapshot is readable by all members regardless of role granularity (VIEWER sees phone numbers stored on the race object).
- No email verification beyond Google's own.
