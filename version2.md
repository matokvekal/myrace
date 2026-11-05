# Commissaire 0.2 — Revised Plan (Organizations, Judges, Roles, Audit, Limits)

**Status:** Planning — no code yet. **Date:** 2026-11-05. **Baseline:** 0.1.17 (`4f00c68`).
**Supersedes** `COMMISSAIRE_0_2_ORGANIZATIONS_JUDGES_SPEC.md` where the two conflict.

Structure: (1) review comments on the original draft, (2) the revised plan,
(Appendix A/B) the original draft and guidelines, verbatim.

## Review comments (my opinion)

**Overall:** The direction is right (server-enforced, additive, local-first, creator-only
delete, no prod until approved). But the draft is written as if the server had no roles —
it does. Building it as written would create a second, parallel permission + audit system.

### What already exists (the draft re-invents it)
| Draft proposes | Already in the code |
|---|---|
| `race_assignments`, `race_assignment_roles` | `race_members` (roles[], permissions JSONB, revokedAt) — `server/sql/003` |
| `invitations` w/ hashed token, one-time | `invitations` (tokenHash, maxUses, expiresAt, revokedAt, email/userId binding) — 003 |
| `roles`, `permissions`, `role_permissions` tables | `src/shared/race/roles.ts` (`PERMISSION_MATRIX`), `src/shared/race/access.ts` (`ROLE_DEFAULTS`, screen×CRUD, wave/category scope) |
| `authorize(user, resource, action, ctx)` | `loadMembership` / `requireMember` / `requireWriter` / `requireOwner` — `server/src/races/access.ts`, fresh from DB per request (no JWT caching — §5.6 already true) |
| Judge pool (personal) | `contacts`, `contact_groups` — 003 |
| `audit_logs` for race changes | `race_events`: append-only, `userId`, `applied` + `reason` (`forbidden`, `not_member`…) for every one of 52 write paths — 004 |
| Offline "Rejected" actions | Server already stores rejected actions with `applied=false, reason` |
| Soft delete, creator-only delete | `deletedAt/deletedBy` (010); owner-only delete; `race_hidden` for members |
| Feature flag for member writes | `COMMISSAIRE_MEMBER_WRITES=1` / `WRITES_OWNER_ONLY()` |
| Socket revoke on access loss | `race:revoked` event already exists |

### Contradictions to resolve
1. **Org admin on registration**: Plan §3.3 says the creator becomes org admin; Guidelines §5
   says *don't*. → Fixed: org is created `pending`; admin granted in DB (later Super Admin).
2. **Foreign keys**: Plan §12.4 asks for FKs; migration `006` removed every FK by policy
   ("integrity in the Node API, in transactions"). → Fixed: unique constraints + CHECKs + API
   transactions; no FKs.
3. **Two specs**: the older `COMMISSAIRE_0_2_…SPEC.md` says "a race belongs to an account,
   `created_by` is only metadata"; this draft says "only the creator deletes". → Fixed: race
   belongs to an account (business context), **delete = creator only** (both hold).
4. **Tech stack**: the draft lists REST + polling only; the app already uses Socket.IO
   (`race:changes`, `race:revoked`). Keep it; no new realtime tech.

### Problems in the draft
5. **Invitation link valid 5 minutes** — unusable: judges are invited days before a race and
   open the email later. → 7 days default, configurable; still one-time + hashed.
6. **Judge roles don't match how the app works.** "Finish Judge" — finishing is *derived*
   from laps (leader-finish-all, `computeGroupSignals`); there's no separate finish action.
   "Course Judge" has no action in the app at all. Check-In (exists today) is missing.
   → Map to existing roles: Start→`start`, Lap+Finish→`counter`, Check-In→`checkin`,
   Results→new `results` (amend/corrections), Manager→`admin`, Observer→`viewer`.
   Course Judge = deferred (needs a feature first: incident reports).
7. **Free plan "50 participants per race"** would break existing races with >50 riders on day
   one (violates Guidelines §1). → Limits checked only on *new* creation/addition, existing
   races grandfathered; limits off by default behind a flag until the user sets values.
8. **Limits vs offline/local races**: a local race isn't on the server; quotas can only be
   enforced at upload/publish and on server-side adds. State this explicitly.
9. **"Races per month"** undefined edge cases: deleted race still counts? draft race never
   started? → Count server-created races by `createdAt` in the account, deleted included
   (otherwise create/delete bypasses it).
10. **`accounts` + `organizations` as separate tables** — redundant. → One `accounts` table
    with `type personal|organization`; org fields on it (or a 1:1 `account_profiles`).
11. **Participant identity (Rider↔User link) and Following Races** have no feature using them
    in 0.2 → deferred to 0.3; keep a nullable `riders."userId"` slot only if cheap.
12. **Scope: 10 phases is too much for one version.** Value order should be: judges on
    *personal* races first (this is the real need — multi-commissaire lap recording), then
    orgs, then limits. Plans/limits have zero value until billing exists.
13. **Testing load** — "full regression after every step" conflicts with your memory rules
    (focused tests per change). → Per step: unit + affected specs + typecheck + DB suite on
    `commissaire_test`; full suite only at each phase gate.
14. **Creator leaves org → race can never be deleted.** Acceptable (soft-delete only, can be
    hidden/archived by org admin), but say so; no recovery flow in 0.2.
15. **Local isolation key `userId+accountId+raceId`** — races are already keyed by race uuid
    and 0.1.15 added account isolation. The real gap to audit: IndexedDB stores aren't keyed
    by user. Phase 0 must list each store/key and decide; don't rename existing keys
    (migration risk to offline data).

---

## Revised plan

### Principles (unchanged from draft)
Server enforces everything; client only hides. Additive migrations, no FKs (policy 006).
Everything new behind a flag until accepted. Local dev + `commissaire_test` DB only; no prod.

### Phase 0 — As-is audit (no code)
Deliverable `docs/v2/0-as-is.md`: tables (001–010), `access.ts` roles/permissions, member
routes (`server/src/members/routes.ts`), invitation flow, `race_events` types, client stores
& localStorage/IDB keys, socket rooms, existing tests (`server/test/access-rules.test.ts`, db/).
Gap list vs. this plan. User approves before Phase 1.

### Phase 1 — Judges on personal races (smallest valuable step)
- Turn on member writes per role (`COMMISSAIRE_MEMBER_WRITES` path) for `start`, `counter`,
  `checkin`; add `results` role to `MEMBER_ROLES`, `ROLE_DEFAULTS`, the two CHECK
  constraints (new migration 011, additive).
- Invite flow: reuse `invitations` + `race_members`; expiry 7 days; accept/decline UI;
  `PENDING/ACCEPTED/DECLINED/REVOKED/EXPIRED` derived from existing columns (+`declinedAt`).
- Judges & Roles screen in the race (owner): invite, roles, wave/category scope, revoke.
- Assigned Races list in My Races (membership-based — `race_members_user_idx` exists).
- Active race + my roles indicator on Live/Start/Check-In.
- Rejected offline actions surfaced on the device (server already marks `forbidden`).
- Tests: per-role allow/deny on every action type, revoke mid-race, cross-race rider uuid,
  same user different roles in 5 races same date.

### Phase 2 — Creator-only delete + race audit view
- Migration: `races."createdByUserId"` backfilled from `"ownerUserId"` (reliable for every
  existing race — no guessing); immutable (API never writes it; trigger-free check in repo).
- Delete rule: `user == createdByUserId`; owner/admin/judge/super-admin → 403.
- Audit UI: read `race_events` (who/when/what, applied + rejected), filter by rider/wave.
- New `audit_logs` table ONLY for non-race events (membership, invitations, org, limits,
  admin) — written in the same transaction as the change.

### Phase 3 — Accounts & organizations
- `accounts` (type, name, slug, logo, status `pending|active|suspended`, planId);
  personal account backfilled 1:1 for every user; `races."accountId"` backfilled to the
  owner's personal account.
- `account_members` (accountId, userId, role `owner|admin|manager|judge|member`, status).
- Create org → `pending`; admin granted in DB. Org judge pool = `account_members` with judge
  role; pool membership grants no race access; race access still only via `race_members`.
- Org admin may invite pool judges to org races; cannot delete races; cannot see other
  orgs' races. Management entry in the main menu, adapts to role.

### Phase 4 — Multi-race / multi-account client isolation (audit + fixes)
Verify switching races/accounts: socket room leave/join, catch-up cancellation, late
responses ignored, per-race action queues, IDB visibility per account. Fix only gaps found.

### Phase 5 — Plans & limits (flag off by default)
`plans` + `account_limits` (overrides, validFrom/Until, isActive; NULL = unlimited, 0 =
blocked). Enforced at server create/publish/add-rider/add-member, under
`SELECT … FOR UPDATE` on the account row. Grandfather existing races. Clear limit message
(usage / max). Super Admin = DB only (`platform_admins` table), no UI in 0.2.

### Phase 6 — Full regression, local acceptance, release prep
Seed: 3 orgs, 6 users, 8 races, overlapping roles. Full unit + DB + E2E suites.
Release markers added per new route (`server/deploy/release-markers.txt`). Prod only on
explicit approval.

### Deferred to 0.3
Participant↔User link, Following Races, Course Judge, custom roles, Super Admin UI,
billing, retention/archiving automation, org public pages/branding beyond logo.

### Open decisions (my recommendation in bold)
- Invite expiry: **7 days**. Finish Judge: **same as counter**. Org on registration:
  **pending, admin via DB**. Limits at launch: **off**.


---

# Appendix A — Original draft (verbatim, as submitted 2026-11-05)

# COMMISSAIRE 0.2
## Master Development Plan — Organizations, Roles, Permissions, Audit & Multi-Race Management

**Status:** Planning / Specification  
**Target:** Version 0.2  
**Development:** Local First  
**Production deployment:** Only after explicit approval  
**Priority:** Security, Data Isolation, Reliability, Backward Compatibility

---

# 1. מטרת הגרסה

גרסה 0.2 תהפוך את Commissaire למערכת רב־משתמשית ורב־ארגונית לניהול מרוצי אופניים.

המערכת תאפשר:

- ניהול מרוצים פרטיים וארגוניים.
- יצירת ארגונים וניהול חברי ארגון.
- הקמת מאגר שופטים לכל ארגון.
- הזמנת שופטים, מנהלים ומשקיפים.
- שיוך משתמשים למרוצים בתפקיד אחד או במספר תפקידים.
- הגדרת הרשאות ברמת פעולה.
- ניהול מספר מרוצים במקביל.
- מעבר בין מרוצים ללא זליגת מידע.
- ניהול תוכניות שימוש ומכסות.
- תיעוד פעולות משמעותיות באמצעות Audit Trail.
- שמירה על תמיכה ב־Offline ובסנכרון.
- ממשק Super Admin לניהול חשבונות ומגבלות.

## עיקרון מרכזי

משתמש הוא ישות אחת בעלת זהות קבועה.

המשתמש יכול לפעול בהקשרים שונים, וכל הקשר מעניק לו הרשאות אחרות.

לדוגמה:

| מרוץ | ארגון | תפקיד המשתמש |
|---|---|---|
| Race A | אישי | יוצר המרוץ |
| Race B | Organization X | שופט זינוק |
| Race C | Organization X | שופט סיום ומשקיף |
| Race D | Organization Y | מנהל מרוץ |
| Race E | Organization Y | משתתף |

כל התפקידים יכולים להתקיים במקביל, גם כאשר המרוצים נערכים באותו תאריך.

אין צורך להחליף משתמש או להתחבר מחדש כדי לעבור ביניהם.

---

# 2. עקרונות ארכיטקטורה

## 2.1 Separation of Concerns

נפריד בין חמש שכבות:

1. **Identity** — מי המשתמש?
2. **Account / Organization** — מטעם מי הוא פועל?
3. **Race Context** — באיזה מרוץ הוא עובד?
4. **Authorization** — אילו פעולות מותרות לו?
5. **Subscription / Limits** — אילו פעולות החשבון רשאי לצרוך לפי התוכנית?

חשוב: הרשאה לבצע פעולה ומכסה לביצוע פעולה הן שתי בדיקות נפרדות.

לדוגמה, משתמש רשאי ליצור מרוץ, אך אינו יכול לעשות זאת אם ניצל את המכסה החודשית.

## 2.2 Technology

נמשיך להשתמש בתשתית הקיימת:

- React + Vite
- Node.js
- PostgreSQL
- REST API
- PWA / Offline
- PM2 / Linux Production

אין צורך במעבר למיקרו־שירותים בשלב זה.

ה־Backend ייבנה בצורה מודולרית כדי לאפשר הרחבה עתידית.

## 2.3 Security First

כל הרשאה נאכפת בשרת.

ה־Client יכול להסתיר פעולות שאינן מורשות, אך לעולם אינו מקור האמת.

כל API שמבצע פעולה על מרוץ חייב לבדוק:

- משתמש מזוהה.
- מרוץ קיים ונגיש.
- בעלות או שיוך רלוונטי.
- תפקידים פעילים.
- הרשאות פעולה.
- סטטוס המרוץ.
- מגבלות החשבון, אם רלוונטיות.

---

# 3. משתמשים וחשבונות

## 3.1 User

כל אדם הוא משתמש אישי בעל זהות אחת.

המשתמש יכול:

- ליצור מרוצים אישיים.
- להשתתף במרוצים.
- להיות שופט.
- לנהל מרוצים.
- ליצור ארגון.
- להצטרף לארגונים.
- להיות חבר במספר ארגונים.

אין ליצור משתמש חדש לכל ארגון.

## 3.2 Account

כל משתמש יקבל חשבון אישי אוטומטית.

חשבון הוא יחידת בעלות, חיוב ומכסות.

סוגי חשבונות:

- PERSONAL
- ORGANIZATION

שניהם משתמשים באותו מנגנון הרשאות ומכסות.

## 3.3 Registration

בעת הרשמה:

- המשתמש מזין פרטים אישיים.
- בוחר אם להקים ארגון.
- אם בחר ארגון, נוצר גם חשבון ארגוני.
- המשתמש הופך למנהל הראשוני של הארגון.

אפשר ליצור ארגון גם בשלב מאוחר יותר.

משתמש יכול להיות בעל חשבון אישי ולנהל מספר ארגונים במקביל, בכפוף למגבלות התוכנית.

---

# 4. ארגונים

## 4.1 Organization

ארגון כולל:

- שם.
- מזהה ייחודי.
- Slug ציבורי.
- לוגו.
- תיאור.
- פרטי קשר.
- סטטוס.
- תוכנית שימוש.
- חברים.
- מאגר שופטים.
- מרוצים.
- הרשאות ומנהלים.

## 4.2 Organization Members

לכל ארגון חברים בעלי תפקיד ארגוני.

תפקידי ברירת מחדל:

| תפקיד | משמעות |
|---|---|
| Organization Owner | בעל החשבון הארגוני |
| Organization Admin | מנהל ארגון |
| Organization Manager | מנהל תפעולי |
| Judge | חבר במאגר השופטים |
| Member | חבר רגיל |

תפקיד ארגוני אינו מעניק אוטומטית הרשאות שיפוט במרוץ.

לדוגמה, מנהל ארגון יכול להזמין שופטים, אך אינו רשאי לסמן רוכב כמסיים בלי הרשאת שיפוט מתאימה.

## 4.3 Organization Race Ownership

מרוץ יכול להשתייך:

- לחשבון אישי.
- לחשבון ארגוני.

הארגון הוא ההקשר העסקי של המרוץ.

עם זאת, נשמור גם את המשתמש שיצר את המרוץ בפועל.

### כלל מחיקה מחייב

**רק המשתמש שיצר את המרוץ רשאי למחוק אותו.**

הכלל חל גם על מרוצים ארגוניים.

לא ניתן להעביר הרשאת מחיקה למנהל אחר באמצעות Role.

מחיקת מרוץ תהיה Soft Delete בלבד.

אם היוצר עוזב את הארגון, המרוץ נשאר בארגון, אך הרשאת המחיקה אינה עוברת אוטומטית לאחר. יש להגדיר בעתיד תהליך התאוששות מנהלי נפרד, בלי לעקוף את הכלל באמצעות הרשאות רגילות.

---

# 5. Roles & Permissions

## 5.1 Permission-Based Authorization

לא נקבע הרשאות ישירות בתוך רכיבי React או Controllers.

נשתמש במודל:

**User → Assignment → Role → Permissions**

לכל Role תהיה קבוצת Permissions.

למשתמש יכולים להיות מספר Roles באותו מרוץ.

ההרשאות יחושבו כאיחוד ההרשאות של התפקידים הפעילים, בכפוף להגבלות מפורשות ולכללים שאינם ניתנים להאצלה.

## 5.2 Permission Structure

פורמט הרשאה:

`resource.action`

דוגמאות:

- `race.create`
- `race.read`
- `race.update`
- `race.delete`
- `race.publish`
- `race.finish`
- `rider.create`
- `rider.read`
- `rider.update`
- `rider.delete`
- `rider.status.update`
- `start.execute`
- `finish.execute`
- `lap.record`
- `lap.correct`
- `results.read`
- `results.update`
- `judge.invite`
- `judge.assign`
- `judge.remove`
- `organization.members.manage`
- `organization.settings.update`
- `audit.read`

ההרשאות יהיו מוגדרות במאגר מרכזי.

## 5.3 Default Race Roles

נגדיר חמישה סוגי שופטים בסיסיים:

1. Start Judge
2. Finish Judge
3. Lap Judge
4. Results Judge
5. Course Judge

נוסיף שני תפקידים שאינם שופטים:

- Observer
- Race Manager

בנוסף, Creator הוא מאפיין קבוע של המרוץ ולא Role רגיל.

## 5.4 Default Permission Matrix

| פעולה | Observer | Start | Finish | Lap | Results | Manager | Creator |
|---|---|---|---|---|---|---|---|
| צפייה במרוץ | כן | כן | כן | כן | כן | כן | כן |
| הזנקת רוכבים | לא | כן | לא | לא | לא | לפי הרשאה | כן |
| סימון סיום | לא | לא | כן | לא | לא | לפי הרשאה | כן |
| רישום הקפות | לא | לא | לא | כן | לא | לפי הרשאה | כן |
| עריכת תוצאות | לא | לא | לא | לא | כן | לפי הרשאה | כן |
| הוספת רוכבים | לא | לא | לא | לא | לא | כן | כן |
| עריכת רוכבים | לא | לא | לא | לא | לא | כן | כן |
| ניהול שופטים | לא | לא | לא | לא | לא | לפי הרשאה | כן |
| מחיקת מרוץ | לא | לא | לא | לא | לא | לא | כן |

המטריצה היא ברירת מחדל.

ניתן להגדיר תפקידים מותאמים בעתיד, אך `race.delete` לא יהיה ניתן להאצלה.

## 5.5 Multiple Roles

משתמש יכול להיות גם Start Judge וגם Finish Judge.

המערכת תחשב את איחוד ההרשאות.

ה־UI יציג את הפעולות המותרות לו בהתאם.

## 5.6 Permission Changes

שינוי הרשאה חייב להשפיע על פעולות חדשות באופן מיידי.

אין להסתמך על הרשאות ישנות שנשמרו ב־JWT או ב־Client.

ה־Backend יבדוק הרשאות עדכניות בכל פעולה רגישה.

---

# 6. הזמנת שופטים ומנהלים

## 6.1 Organization Judge Pool

לכל ארגון יהיה מאגר שופטים.

המאגר כולל משתמשים שהסכימו להצטרף לארגון.

הצטרפות למאגר אינה מקנה הרשאות במרוצים.

## 6.2 Invitation Flow

שלב ראשון — הזמנה לארגון:

1. מנהל הארגון יוצר הזמנה.
2. המערכת מייצרת קישור חד־פעמי.
3. תוקף הקישור: 5 דקות.
4. המוזמן מתחבר או נרשם.
5. מוצגים פרטי הארגון.
6. המשתמש מאשר הצטרפות.
7. הוא מתווסף למאגר הארגוני.

ההזמנה חייבת להיות מוגבלת בזמן, חד־פעמית, ובלתי ניתנת לשימוש חוזר.

אין לשמור את Token ההזמנה בצורה גלויה במסד הנתונים; נשמור Hash.

## 6.3 Race Assignment

שלב שני — הזמנה למרוץ:

1. מנהל בוחר מרוץ.
2. בוחר שופט מהמאגר.
3. בוחר תפקיד אחד או יותר.
4. שולח הזמנה.
5. השופט מקבל הודעה.
6. השופט מאשר או דוחה.
7. רק לאחר אישור נוצר שיוך פעיל.

סטטוסים:

- PENDING
- ACCEPTED
- DECLINED
- REVOKED
- EXPIRED

שופט שלא אישר אינו יכול לבצע פעולות שיפוט.

## 6.4 Personal Race Invitations

גם משתמש פרטי יכול להזמין שופטים למרוץ שלו.

אין חובה ליצור ארגון כדי להשתמש בשופטים.

הזמנה ישירה למרוץ אישי תשתמש באותו מנגנון אישור.

## 6.5 Revocation

מנהל בעל הרשאה יכול לבטל שיוך שופט.

ביטול השיוך:

- מבטל הרשאות עתידיות.
- מנתק הרשאות Socket רלוונטיות.
- מבטל פעולות Offline שטרם אושרו אם ההרשאה כבר אינה תקפה בזמן הסנכרון.
- אינו מוחק אירועים שהשופט ביצע בעבר כדין.

---

# 7. ניהול מספר מרוצים במקביל

## 7.1 Race Context

כל מרוץ הוא הקשר עבודה עצמאי.

ה־Client יחזיק:

- Active User
- Active Account / Organization
- Active Race
- Active Permissions
- Race-Specific State

אין להסתמך על משתנה גלובלי יחיד עבור נתוני המרוץ ללא בידוד.

## 7.2 Switching Races

כאשר משתמש עובר מ־Race A ל־Race B:

1. מפסיקים Polling של Race A.
2. מסירים Socket subscriptions של Race A.
3. מבטלים בקשות ישנות שניתן לבטל.
4. מתעלמים מתשובות מאוחרות של Race A.
5. מנקים את ה־UI של Race A.
6. טוענים הרשאות Race B.
7. טוענים נתוני Race B.
8. מתחילים Polling / Socket עבור Race B.

לא מוחקים נתונים מקומיים שלא סונכרנו.

## 7.3 Local Data Isolation

נתונים מקומיים יופרדו לפחות לפי:

`userId + accountId + raceId`

דוגמאות למפתחות:

- `race:{userId}:{raceId}:data`
- `race:{userId}:{raceId}:pending`
- `race:{userId}:{raceId}:sync`

אם משתמש מחליף חשבון, לא ניתן להציג נתונים של החשבון הקודם.

יש לבדוק גם Zustand, IndexedDB, LocalStorage, Service Worker וכל Cache נוסף.

## 7.4 Server Isolation

השרת אינו שומר Active Race כהרשאה גלובלית.

כל בקשה חייבת לכלול Race ID מפורש או להיגזר ממשאב בעל Race ID.

השרת יאמת את ההרשאה לפי Race ID של הבקשה.

אסור לאפשר גישה למרוץ אחר רק משום שהמשתמש חבר באותו ארגון.

---

# 8. Participant Identity

## 8.1 Participant vs User

נפריד בין:

- משתמש רשום במערכת.
- רוכב / משתתף במרוץ.

לא כל רוכב חייב להיות משתמש רשום.

נאפשר קישור אופציונלי בין Rider לבין User.

## 8.2 Multiple Identities

משתמש יכול להיות:

- יוצר Race A.
- שופט Race B.
- משתתף Race C.

אין סתירה בין התפקידים.

אותו משתמש יכול גם להיות משתתף ושופט באותו מרוץ, אם הוגדר כך, אך הרשאות השיפוט אינן נובעות מעצם ההשתתפות.

## 8.3 Privacy

משתתף רשום אינו רשאי לערוך תוצאות, סטטוסים או פרטי משתתפים אחרים רק משום שהוא מחובר.

נתונים אישיים של רוכבים ייחשפו לפי צורך והרשאה.

קישור Rider ל־User לא יאפשר השתלטות על רשומת רוכב באמצעות כתובת אימייל בלבד.

---

# 9. Subscription Plans & Limits

## 9.1 Account Limits

לכל חשבון יהיו מכסות פעילות.

נפריד בין:

- תוכנית ברירת מחדל.
- חריגות ברמת חשבון.
- תקופת תוקף.
- מצב הפעלה.

## 9.2 Initial Plans

| Limit | Personal Free | Organization Paid |
|---|---|---|
| מרוצים בחודש | 3 | 10 |
| משתתפים למרוץ | 50 | 500 |
| שופטים למרוץ | 3 | 10 |
| יצירת ארגון | לפי הגדרה | לפי הגדרה |
| מיתוג ארגוני | בסיסי | מורחב |
| עמוד ארגון ציבורי | לפי תוכנית | כן |

המכסות הן ערכי ברירת מחדל ראשוניים וניתנות לשינוי.

## 9.3 Limit Fields

נגדיר:

- `max_races_per_day`
- `max_races_per_month`
- `max_participants_per_race`
- `max_judges_per_race`
- `max_judges_per_account`
- `max_viewers_per_race`
- `max_organizations`
- `valid_from`
- `valid_until`
- `is_active`

נוסיף שדות להפעלת יכולות מיתוג ותכונות מתקדמות.

`NULL` פירושו ללא מגבלה מספרית.

`0` פירושו חסום.

## 9.4 Limit Enforcement

כל מכסה תיבדק ב־Backend.

לדוגמה:

- יצירת מרוץ חדש.
- הוספת רוכב.
- שיוך שופט.
- יצירת ארגון.

בדיקות מכסה חייבות להיות בטוחות מפני Race Conditions.

שתי בקשות מקבילות לא יוכלו לעקוף מכסה.

## 9.5 Expired Plans

כאשר תוכנית מסתיימת:

- אין למחוק מרוצים.
- אין למחוק משתתפים.
- אין למחוק שופטים.
- אין למחוק תוצאות.

נחסום יצירה או הרחבה לפי מדיניות התוכנית.

גישה לקריאת נתונים קיימים תישמר בהתאם למדיניות שתוגדר.

---

# 10. Super Admin

נבנה ממשק ניהול מרכזי.

יכולות:

- רשימת משתמשים.
- רשימת ארגונים.
- חיפוש חשבונות.
- צפייה בתוכנית הפעילה.
- שינוי מכסות.
- שינוי תוקף.
- הפעלה / השבתה.
- צפייה בצריכת מכסות.
- צפייה ב־Audit.
- צפייה בנתוני מערכת מצטברים.

Super Admin לא יקבל באופן אוטומטי הרשאה למחוק מרוץ של משתמש אחר.

פעולות תמיכה חריגות יוגדרו בנפרד, עם Audit מתאים.

---

# 11. Audit Trail

## 11.1 Purpose

Audit יתעד מי ביצע שינוי משמעותי, מתי, באיזה מרוץ, ועל איזה משאב.

המערכת תאפשר חקירה של:

- שינויים בתוצאות.
- מחיקת מרוצים.
- שינויים במשתתפים.
- שינויי סטטוס.
- פעולות שיפוט.
- שינויי הרשאות.
- פעולות מנהל.

## 11.2 Events to Audit

| Event | Audit |
|---|---|
| יצירת מרוץ | כן |
| עדכון מרוץ | כן |
| מחיקת מרוץ | כן |
| פרסום / ביטול פרסום | כן |
| יצירת רוכב | כן |
| עדכון רוכב | כן |
| מחיקת רוכב | כן |
| הזנקה | כן |
| ביטול הזנקה | כן |
| סיום רוכב | כן |
| סיום מרוץ | כן |
| שינוי סטטוס | כן |
| תיקון זמן | כן |
| תיקון / ביטול הקפה | כן |
| הזמנת שופט | כן |
| אישור / ביטול שיוך | כן |
| שינוי הרשאות | כן |
| שינוי תוכנית / מכסה | כן |
| הקפה רגילה | לא ב־Audit הכללי |
| צפייה במסך | לא |
| ניווט | לא |
| Polling | לא |

## 11.3 Lap Events

הקפות רגילות נשמרות כאירועים עסקיים.

לכל אירוע הקפה נשמור:

- Race ID
- Rider ID
- Event ID
- User ID של השופט
- Timestamp
- Source
- Sync metadata

אין צורך ברשומת Audit כפולה לכל הקפה.

תיקון או ביטול הקפה כן יירשם ב־Audit.

## 11.4 Audit Schema

טבלת Audit תכלול:

- ID
- Actor User ID
- Account ID
- Organization ID
- Race ID
- Action
- Entity Type
- Entity ID
- Old Data
- New Data
- Request ID
- Created At

יש לשמור רק שדות רלוונטיים לשינוי.

אין לשמור סיסמאות, Tokens או סודות.

## 11.5 Transaction Consistency

Audit של שינוי עסקי חייב להיכתב באותה טרנזקציה עם השינוי.

אם הטרנזקציה נכשלת, גם השינוי וגם ה־Audit מתבטלים.

## 11.6 Retention

נגדיר מדיניות שמירה ניתנת להגדרה.

הצעה ראשונית:

- Audit ניהולי: 24 חודשים.
- אירועי מדידה ותוצאות: לפי מדיניות שמירת המרוצים.
- נתונים ישנים: אפשרות לארכוב.

לא תבוצע מחיקה אוטומטית ללא החלטה מפורשת.

---

# 12. Database Design

## 12.1 Main Tables

טבלאות חדשות או הרחבות מוצעות:

- `accounts`
- `organizations`
- `organization_members`
- `organization_judges`
- `roles`
- `permissions`
- `role_permissions`
- `invitations`
- `race_assignments`
- `race_assignment_roles`
- `plans`
- `account_limits`
- `audit_logs`

## 12.2 Existing Tables

נבדוק התאמות לטבלאות הקיימות:

- Users
- Races
- Riders
- Race Events
- Results

אין להחליף טבלאות קיימות בלי מיפוי Migration מסודר.

## 12.3 Races Extension

מרוץ יצטרך לכלול, במישרין או באמצעות קשרים:

- Owner Account ID
- Organization ID, אם רלוונטי
- Created By User ID
- Created At
- Deleted At
- Deleted By
- Publication Status

`created_by_user_id` יהיה בלתי ניתן לשינוי לאחר יצירת המרוץ.

## 12.4 Referential Integrity

נגדיר Foreign Keys, Unique Constraints ואינדקסים.

דוגמאות:

- מניעת שיוך כפול של אותו שופט לאותו מרוץ.
- מניעת אישור חוזר של הזמנה.
- מניעת שיוך Role שאינו קיים.
- מניעת גישה לרשומות מחוץ להקשר הארגוני.
- הגנה על בעלות מרוץ מפני שינוי לא מורשה.

## 12.5 Migration Strategy

נבצע מיגרציות Additive ככל האפשר.

שלבים:

1. יצירת טבלאות חדשות.
2. הוספת עמודות nullable.
3. Backfill של נתונים קיימים.
4. בדיקות תקינות.
5. הפעלת מנגנוני הרשאות חדשים.
6. הקשחת Constraints רק לאחר אימות.

מרוצים קיימים יישארו בבעלות המשתמשים שיצרו אותם, ככל שהמידע הקיים מאפשר לזהות אותם באופן אמין.

אם יש רשומות שלא ניתן לקבוע את יוצרן, נציג דוח חריגים ולא ננחש בעלות.

---

# 13. Backend Architecture

נבנה מודולים:

- Identity / Authentication
- Accounts
- Organizations
- Memberships
- Invitations
- Roles & Permissions
- Race Authorization
- Race Assignments
- Plans & Limits
- Audit
- Race Context / Sync

## 13.1 Authorization Service

נגדיר שירות מרכזי:

`authorize(userId, resource, action, context)`

השירות יחזיר החלטה בהתאם לנתונים העדכניים.

דוגמאות:

- האם המשתמש רשאי להזניק רוכב במרוץ?
- האם הוא רשאי לשנות תוצאה?
- האם הוא רשאי להזמין שופט?
- האם הוא היוצר המקורי של המרוץ?

## 13.2 Permission Middleware

Endpoints רגישים יעברו דרך Middleware או Service Guard.

לא נעתיק לוגיקת הרשאות בין Controllers.

## 13.3 Special Delete Rule

מחיקת מרוץ:

`authenticatedUser.id === race.createdByUserId`

זהו תנאי מחייב, בנוסף לבדיקות מצב המרוץ.

Role רגיל אינו יכול לעקוף אותו.

## 13.4 API Scope

כל Endpoint המתייחס למרוץ יבדוק Race ID מול הנתונים עצמם.

לא נאפשר שימוש ב־Rider ID של מרוץ אחר לצורך עדכון במרוץ הנוכחי.

נשתמש בבדיקות שיוך מפורשות ובשאילתות מוגבלות־הקשר.

---

# 14. Proposed API

## Accounts

- `GET /api/v1/accounts`
- `GET /api/v1/accounts/:id`
- `GET /api/v1/accounts/:id/limits`
- `GET /api/v1/accounts/:id/usage`

## Organizations

- `POST /api/v1/organizations`
- `GET /api/v1/organizations`
- `GET /api/v1/organizations/:id`
- `PATCH /api/v1/organizations/:id`
- `GET /api/v1/organizations/:id/members`

## Invitations

- `POST /api/v1/organizations/:id/invitations`
- `POST /api/v1/invitations/:token/accept`
- `POST /api/v1/invitations/:token/decline`

## Race Assignments

- `GET /api/v1/races/:raceId/assignments`
- `POST /api/v1/races/:raceId/assignments`
- `PATCH /api/v1/races/:raceId/assignments/:id`
- `DELETE /api/v1/races/:raceId/assignments/:id`

## Permissions

- `GET /api/v1/races/:raceId/my-permissions`
- `GET /api/v1/roles`
- `GET /api/v1/permissions`

## Audit

- `GET /api/v1/races/:raceId/audit`
- `GET /api/v1/organizations/:id/audit`

## Admin

- `GET /api/v1/admin/accounts`
- `PATCH /api/v1/admin/accounts/:id/limits`
- `GET /api/v1/admin/audit`

ה־API הסופי ייקבע אחרי בדיקת ה־Endpoints הקיימים כדי למנוע כפילויות ושבירת תאימות.

---

# 15. Frontend / UX

## 15.1 Main Navigation

נציע ניווט ברור:

- My Races
- Assigned Races
- Following Races
- My Organizations
- Invitations
- Profile

למשתמשים מורשים יופיעו גם:

- Organization Management
- Judges
- Administration

## 15.2 My Races

יציג מרוצים שהמשתמש יצר.

אפשר לסנן לפי:

- אישי.
- ארגון.
- פעיל.
- עתידי.
- הסתיים.

## 15.3 Assigned Races

יציג מרוצים שבהם המשתמש קיבל תפקיד פעיל.

לכל מרוץ יוצגו:

- שם המרוץ.
- תאריך.
- ארגון.
- תפקידים.
- סטטוס.
- כניסה למרוץ.

## 15.4 Following Races

יציג מרוצים ציבוריים שהמשתמש בחר לעקוב אחריהם.

צפייה אינה מעניקה הרשאות ניהול.

## 15.5 Organization Dashboard

יכלול:

- פרטי הארגון.
- מרוצים.
- שופטים.
- חברים.
- הזמנות ממתינות.
- שימוש במכסות.
- הגדרות.

## 15.6 Judge Pool

מסך שופטים ארגוני יאפשר:

- חיפוש שופט.
- הזמנת שופט.
- צפייה בסטטוס הזמנה.
- שיוך למרוץ.
- הגדרת מספר תפקידים.
- ביטול שיוך.

## 15.7 Race Management

במסך ניהול המרוץ נוסיף:

- Judges & Roles
- Permissions
- Invitations
- Audit History

פעולות שאינן מורשות לא יוצגו או יהיו חסומות עם הסבר מתאים.

## 15.8 Active Race Indicator

בכל מסך עבודה נציג בבירור:

- שם המרוץ הפעיל.
- הארגון.
- התפקידים הפעילים.

כך נקטין את הסיכון ששופט יבצע פעולה במרוץ הלא נכון.

---

# 16. Offline & Synchronization

## 16.1 Offline Requirements

יש לשמור על היכולות הקיימות.

שופט יוכל להמשיך לעבוד במצב Offline רק עבור פעולות שהוגדרו במפורש כנתמכות.

כל פעולה Offline תכלול:

- User ID
- Race ID
- Event ID
- Timestamp
- Action
- Payload
- Sync Status

## 16.2 Authorization During Sync

כאשר הפעולה נשלחת לשרת:

- מאמתים את המשתמש.
- מאמתים את המרוץ.
- מאמתים הרשאות עדכניות.
- מאמתים שהפעולה מותרת בסטטוס המרוץ.
- מונעים כפילות באמצעות Event ID.

פעולה שבוצעה Offline לאחר שהרשאת השופט בוטלה לא תאושר אוטומטית.

הפעולה תישמר מקומית כ־Rejected או Requires Review ולא תימחק בשקט.

## 16.3 No Cross-Race Sync

תור פעולות של Race A לא יכול להתמזג עם Race B.

גם אם אותו משתמש עובד בשני המרוצים במקביל.

## 16.4 Service Worker

נשמור על הכלל שהוגדר ב־0.1.15:

אין Cache של API פרטי באמצעות Service Worker.

נתונים מקומיים הדרושים ל־Offline יישמרו במנגנון ייעודי ומבודד לפי זהות והקשר.

---

# 17. Real-Time & Socket Security

כל Subscription יהיה מוגבל למרוץ מסוים.

השרת יבדוק הרשאה בעת הצטרפות לערוץ.

כאשר הרשאה מבוטלת:

- ה־Subscription מבוטל.
- המשתמש לא יקבל אירועים פרטיים נוספים.
- פעולות חדשות יידחו.

מעבר מרוץ יבטל Subscriptions ישנים.

יש לבדוק גם ניתוקים, חיבור מחדש והחלפת משתמש.

---

# 18. Security & Data Isolation Tests

זהו אחד החלקים החשובים ביותר בגרסה.

## 18.1 Cross-Account Tests

- User A אינו רואה נתונים פרטיים של User B.
- User A אינו משנה מרוצים של User B.
- מעבר חשבון מנקה State פעיל.
- נתונים שמורים אינם מוצגים בחשבון אחר.

## 18.2 Cross-Race Tests

- שופט Race A אינו יכול להזניק רוכב ב־Race B.
- Rider ID מ־Race A אינו ניתן לעדכון באמצעות Endpoint של Race B.
- תוצאות Race A אינן מופיעות ב־Race B.
- Socket של Race A אינו מקבל אירועים של Race B.

## 18.3 Multiple Roles Tests

- אותו משתמש יוצר Race A.
- שופט Start ב־Race B.
- שופט Finish ב־Race C.
- משתתף ב־Race D.
- משקיף ב־Race E.

נבדוק מעבר מהיר בין כל המרוצים, כולל בקשות API שמסתיימות באיחור.

## 18.4 Delete Tests

- Creator יכול לבצע Soft Delete.
- Organization Admin שאינו Creator מקבל 403.
- Race Manager שאינו Creator מקבל 403.
- Judge מקבל 403.
- Participant מקבל 403.
- ניסיון לשנות `created_by_user_id` נכשל.

## 18.5 Invitation Tests

- הזמנה תקינה.
- הזמנה שפג תוקפה.
- שימוש חוזר בקישור.
- הזמנה שבוטלה.
- משתמש שדחה.
- משתמש שאישר.
- ניסיון לשייך שופט ללא אישור.
- ניסיון לחרוג ממכסת שופטים.

## 18.6 Plan Tests

- חריגה ממכסת מרוצים.
- חריגה ממכסת רוכבים.
- חריגה ממכסת שופטים.
- תוכנית שפג תוקפה.
- חשבון מושבת.
- בקשות מקבילות שמנסות לעקוף מכסה.

## 18.7 Audit Tests

- פעולה משמעותית יוצרת Audit.
- פעולה שנכשלה אינה נרשמת כשינוי שהצליח.
- Audit מכיל Actor נכון.
- Audit מכיל Race ID נכון.
- שינוי תוצאה שומר ערך קודם וחדש.
- הקפה רגילה אינה יוצרת Audit כפול.

## 18.8 Offline Tests

- מעבר מרוץ בזמן Offline.
- שינוי חשבון בזמן שיש פעולות ממתינות.
- ביטול הרשאה לפני Sync.
- פעולות כפולות.
- ניתוק באמצע Sync.
- חיבור מחדש.
- שמירה על פעולות שלא סונכרנו.

---

# 19. Testing Strategy

נשתמש בכמה שכבות בדיקה.

## Unit Tests

- Permission calculation
- Role composition
- Plan limits
- Invitation expiration
- Audit generation
- Race context isolation

## Integration Tests

- API + PostgreSQL
- Authentication
- Authorization
- Transactions
- Constraints
- Sync
- Race ownership

## End-to-End Tests

- Registration
- Organization creation
- Judge invitation
- Judge acceptance
- Race assignment
- Race switching
- Race operations
- Audit verification

## Security Regression Tests

כל תיקון אבטחה חדש יהפוך לבדיקת רגרסיה קבועה.

נשתמש במשתמשי בדיקה וארגונים נפרדים, עם נתונים שאפשר לזהות בקלות כדי לגלות זליגה.

---

# 20. Backward Compatibility

גרסה 0.2 לא תשבור את 0.1.15.

חובה לשמר:

- מרוצים קיימים.
- רוכבים קיימים.
- תוצאות קיימות.
- אירועי מדידה.
- Public Share Links.
- Guest Read-Only Access.
- Offline Data.
- Sync.
- מחיקה רכה.
- כללי סיום מרוץ.

לא נבצע שינויי Schema הרסניים בלי Migration ותוכנית Rollback.

---

# 21. Development Phases

## Phase 0 — Architecture & Existing System Audit

מיפוי המערכת הקיימת:

- Database Schema.
- Authentication.
- Race Ownership.
- Race Events.
- Local Storage.
- Sync.
- Socket.
- API.
- Tests.

**Deliverable:** Architecture Report + Migration Plan.

אין לכתוב קוד לפני השלמת המיפוי.

## Phase 1 — Accounts & Organizations

- Account model.
- Organizations.
- Memberships.
- Registration extension.
- Existing users migration.
- Ownership mapping.

**Deliverable:** משתמש יכול ליצור ארגון ולעבור בין הקשרים.

## Phase 2 — RBAC

- Roles.
- Permissions.
- Permission matrix.
- Authorization service.
- Backend guards.
- Creator-only deletion.

**Deliverable:** הרשאות נאכפות בשרת עם בדיקות.

## Phase 3 — Judges & Invitations

- Organization judge pool.
- Invitation links.
- Acceptance.
- Race assignments.
- Multiple roles.
- Revocation.

**Deliverable:** מנהל מזמין שופט והשופט יכול לפעול רק לאחר אישור.

## Phase 4 — Multi-Race Context

- Race switching.
- Local state isolation.
- Socket isolation.
- Polling cleanup.
- Safe synchronization.

**Deliverable:** משתמש עובד במספר מרוצים בלי ערבוב נתונים.

## Phase 5 — Plans & Limits

- Plans.
- Account limits.
- Usage calculations.
- Backend enforcement.
- Concurrency protection.
- Super Admin.

**Deliverable:** מכסות נאכפות לפי חשבון.

## Phase 6 — Audit

- Audit schema.
- Audit service.
- Integration with business transactions.
- Audit UI.
- Retention configuration.

**Deliverable:** תיעוד מלא של פעולות משמעותיות.

## Phase 7 — UX Integration

- My Races.
- Assigned Races.
- Following Races.
- Organizations.
- Judges.
- Permissions.
- Audit History.
- Usage & Limits.

**Deliverable:** ממשק אחיד וברור.

## Phase 8 — Full Regression & Security Testing

- Unit.
- Integration.
- E2E.
- Offline.
- Security.
- Cross-account.
- Cross-race.
- Concurrent actions.

**Deliverable:** Test Report ללא כשלים קריטיים.

## Phase 9 — Local Acceptance

המערכת תיבדק מקומית עם נתוני בדיקה.

נכין לפחות:

- 3 ארגונים.
- 6 משתמשים.
- 8 מרוצים.
- מספר תפקידים לכל משתמש.
- משתתפים ושופטים משותפים בין מרוצים.
- תוכניות שימוש שונות.

המשתמש יאשר שהזרימות העסקיות תקינות.

## Phase 10 — Production Release

רק לאחר אישור מפורש:

1. גיבוי מלא.
2. בדיקת Migration.
3. בדיקות תאימות.
4. Build.
5. Release.
6. Deploy.
7. Health Checks.
8. Smoke Tests.
9. Rollback readiness.

אין לבצע Deployment ל־Production במסגרת שלבי הפיתוח המקומיים.

---

# 22. Definition of Done

גרסה 0.2 מוכנה רק כאשר:

- כל התפקידים עובדים.
- כל ההרשאות נאכפות בשרת.
- רק היוצר יכול למחוק מרוץ.
- ארגונים מבודדים זה מזה.
- שופטים יכולים להשתייך למספר ארגונים.
- משתמש יכול לעבוד במספר מרוצים במקביל.
- אין זליגת נתונים בין מרוצים.
- אין זליגת נתונים בין חשבונות.
- סנכרון Offline אינו מאבד מידע.
- כל המכסות נאכפות.
- Audit מתעד פעולות משמעותיות.
- כל בדיקות האבטחה עוברות.
- כל הבדיקות הקיימות ממשיכות לעבור.
- Production 0.1.15 אינו משתנה עד אישור.

---

# 23. Implementation Rules for Claude Code

1. Read and understand the existing architecture before changing code.
2. Do not assume database tables or endpoints exist.
3. Produce a detailed implementation plan before coding.
4. Implement one phase at a time.
5. Add tests with every phase.
6. Never weaken server-side authorization to simplify the UI.
7. Never use client-supplied user identity as an authority.
8. Preserve existing race data and offline functionality.
9. Keep migrations additive and reversible where feasible.
10. Do not deploy to Production without explicit approval.
11. Do not modify unrelated applications or services.
12. Report changed files, migrations, tests and remaining risks after every phase.

**Final objective:** A secure, multi-tenant race management platform supporting personal organizers, organizations, judges, participants and observers, with reliable offline operation and complete race-level data isolation.

---

# Appendix B — Critical Development Guidelines (verbatim)

# Commissaire 0.2 — Critical Development Guidelines

## 1. First Priority: Protect the Existing Application

**The most important requirement is that version 0.2 must not break anything that already works in Commissaire 0.1.15.**

This is a major functional expansion, not a rewrite.

The existing race management, riders, timing, results, live updates, synchronization, authentication, offline capabilities, and public sharing must continue working exactly as they do today.

Mandatory rules:

- Do not rewrite existing modules unless absolutely necessary.
- Avoid modifying shared components, services, and database structures whenever possible.
- Prefer new, isolated modules and components.
- Reuse existing functionality through well-defined interfaces rather than duplicating or rewriting it.
- Maintain full backward compatibility with existing users and races.
- Use additive database migrations.
- Never delete or overwrite existing production data.
- Keep new functionality disabled or isolated until it has been fully tested.
- Never deploy to Production without explicit approval.

**Work incrementally: implement, test, verify, and only then continue.**

Do not implement the entire version in one large development cycle.

## 2. Development Strategy — Small, Verified Steps

Each development phase must follow this process:

1. Analyze the existing implementation.
2. Identify the smallest possible change.
3. Explain which existing components may be affected.
4. Implement the change locally.
5. Write automated tests.
6. Run existing regression tests.
7. Verify that current functionality still works.
8. Report the results.
9. Continue to the next task only after the previous task is stable.

Avoid large refactoring and unnecessary architectural changes.

If an existing component must be modified, explain why and assess the regression risk before changing it.

**The objective is to extend a stable application, not introduce instability while adding features.**

## 3. UI/UX — Modern, Professional and Extremely Clear

Commissaire must provide a modern, intuitive, and professional user experience.

The application is used by race organizers and judges, sometimes during live races, when speed and clarity are essential.

UI/UX requirements:

- Modern, clean, consistent design.
- Mobile-first and fully responsive.
- Minimal clicks for common operations.
- Clear navigation and visual hierarchy.
- Consistent buttons, dialogs, icons, and terminology.
- Clear distinction between viewing and editing.
- Clear indication of the active race and current user permissions.
- Confirmation for destructive operations.
- Useful feedback for successful or failed actions.
- Accessible controls suitable for outdoor mobile use.

**Do not redesign or disrupt existing race screens.**

New management functionality should be integrated primarily through the existing main menu.

Preserve the current user experience wherever possible.

## 4. Main Menu — Management Entry Point

Add a clear **Management** entry in the existing main menu.

The management area should adapt to the user's permissions and account type.

A regular user and an organization administrator may see different management capabilities.

However, they should share the same underlying design language and reusable management components.

### Personal User Management

A regular user should be able to:

- Manage personal races.
- Invite judges to specific races.
- Assign judge roles.
- Review pending invitations.
- View personal account limits and usage.
- Access race audit history where authorized.

Personal users should not need to understand organizational concepts to manage a simple race.

Keep this experience lightweight and straightforward.

### Organization Management

An organization administrator may have additional options:

- Organization profile and branding.
- Organization races.
- Organization members.
- Judge pool.
- Judge invitations.
- Assignments across multiple races.
- Organization account limits.
- Organization usage and subscription information.
- Organization audit history.

Use shared management components wherever practical, but do not force unnecessary organizational complexity onto personal users.

## 5. Organization Administrator — Database-Controlled Access

For the initial version, organization administration should be granted explicitly through database-managed membership and permissions.

**Do not automatically make a user an organization administrator simply because they selected "Organization" during registration.**

The organization account and its administrator permissions must be separate concepts.

Initially, I may assign or approve organization administrators directly in the database.

Later, I plan to develop a dedicated Super Admin management application for managing:

- Organizations.
- Administrators.
- Account plans.
- Subscription status.
- Account limits.
- Feature access.
- Billing-related settings.

Design the database and authorization architecture to support this future administration system without requiring it to be built now.

All administrative privileges must be enforced by the backend.

## 6. Business Model — Free for Small Users, Paid as They Grow

The business objective is simple:

**Small race organizers should be able to use Commissaire for free. As their needs grow, they can upgrade to a paid plan.**

Do not make the free experience unnecessarily complicated or restrictive.

Initial plan examples:

| Capability | Personal / Free | Organization / Paid |
|---|---|---|
| Races per month | 3 | 10 |
| Participants per race | 50 | 500 |
| Judges per race | 3 | 10 |
| Race management | Yes | Yes |
| Judge invitations | Yes | Yes |
| Organization judge pool | No | Yes |
| Organization management | No | Yes |
| Advanced branding | No | Yes |

These are configurable defaults, not hardcoded business rules.

Implement plans and account limits in the database, with account-specific overrides and validity dates.

A user's effective capabilities should depend on the active account's plan, limits, and permissions — not simply on a hardcoded account-type check.

When a user reaches a limit:

- Explain clearly which limit was reached.
- Show the current usage and allowed maximum.
- Preserve existing races and data.
- Provide a future path to upgrading.
- Do not block access to historical results unnecessarily.

Payment processing and the future Super Admin application are outside the initial scope.

## 7. Roles, Permissions and Data Isolation

A user may simultaneously be:

- Creator of one race.
- Judge in another race.
- Participant in a third race.
- Observer in another race.
- Member of multiple organizations.

Every operation must be authorized against the specific race and organization context.

Switching between races must not leak state, cached data, permissions, events, or synchronization queues.

Client and server isolation must be tested independently.

**Only the original race creator may delete a race, including an organization race.**

Race deletion must remain a soft-delete operation.

No organization administrator, race manager, or judge may bypass this rule through ordinary role permissions.

## 8. Audit Trail

Record meaningful business and security actions, including:

- Race creation, modification, and deletion.
- Rider creation, modification, and deletion.
- Race starts and finishes.
- Rider status changes.
- Manual timing corrections.
- Judge invitations and assignments.
- Permission changes.
- Organization administration.
- Account limit changes.

Do not duplicate every ordinary lap recording in the general audit table.

Lap events should retain the recording judge's identity and timestamp in the existing event model.

Audit must identify the actual authenticated user who performed each action.

## 9. Testing and Quality Gates

Every phase must include automated testing.

Mandatory test categories:

- Existing functionality regression.
- Authentication and authorization.
- Cross-account isolation.
- Cross-organization isolation.
- Cross-race isolation.
- Multiple roles per user.
- Switching between active races.
- Offline synchronization.
- Judge invitation and acceptance.
- Race creator-only deletion.
- Subscription and account limits.
- Audit integrity.
- Mobile and desktop UI behavior.

Tests must include scenarios where the same user has different roles in multiple races on the same date.

No critical security or data-isolation failures are acceptable.

## 10. Local Development Only

All version 0.2 development must take place locally.

Do not modify Production, Production databases, or deployed applications.

Use local development data and isolated test accounts.

Do not publish a release or trigger Production deployment without my explicit approval.

The first task is to inspect the current codebase and database, identify integration points, and propose a phased implementation plan.

**Do not start coding until the existing architecture has been reviewed and the first implementation phase is agreed upon.**

## Final Guiding Principle

**Protect what works. Add only what is necessary. Keep modules isolated. Build one feature at a time. Test after every change. Deliver outstanding UI/UX without disturbing the existing application.**

Commissaire 0.2 should feel like a natural extension of the current product, while creating a scalable foundation for professional organizations and paid subscriptions.
