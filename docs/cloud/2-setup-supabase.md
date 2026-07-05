# Supabase Setup Guide — From Zero in ~15 Minutes

This guide builds the entire cloud backend for Commissaire. No prior Supabase knowledge needed.

**You need:** a Google account, a browser, this repo checked out.

---

## 1. Create the Supabase project (3 min)

1. Go to https://supabase.com → **Start your project** → sign in (GitHub or email).
2. **New project**:
   - Name: `commissaire` (anything works)
   - Database password: generate one, save it somewhere (you rarely need it)
   - Region: pick the closest to your races (e.g. `eu-central-1` for Israel/Europe)
3. Wait ~2 minutes while the project provisions.

## 2. Create Google OAuth credentials (5 min)

1. Go to https://console.cloud.google.com → create (or pick) a project.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create
   - App name: `Commissaire`, support email: your email → Save through the steps (no scopes needed beyond default).
   - Add your testers' Gmail addresses under **Test users** while the app is in "Testing" mode (or Publish the app).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `commissaire-supabase`
   - **Authorized redirect URIs** — add exactly one:
     ```
     https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback
     ```
     (find `<YOUR-PROJECT-REF>` in your Supabase project URL)
4. Copy the **Client ID** and **Client Secret**.

## 3. Enable the Google provider in Supabase (1 min)

1. Supabase dashboard → **Authentication → Sign In / Up → Auth Providers → Google**.
2. Toggle **Enable**, paste Client ID + Client Secret → **Save**.

## 4. Register the app URLs (1 min)

Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL**: your production URL (e.g. `https://commissaire.example.com`), or `http://localhost:3000` while developing.
- **Redirect URLs** — add every origin the app runs on:
  ```
  http://localhost:3000
  https://<your-github-pages-domain>
  ```

Without this, Google login will bounce to the wrong page after auth.

## 5. Run the SQL (2 min)

1. Supabase dashboard → **SQL Editor → New query**.
2. Open `supabase/migrations/0001_cloud_schema.sql` from this repo, copy **the whole file**, paste, **Run**.
3. Expected result: `Success. No rows returned`.

The script is idempotent — safe to run again after edits.

What it creates: 5 tables (`profiles`, `races`, `race_users`, `riders`, `race_events`), all RLS policies, the duplicate-lap unique index, helper functions (`my_race_role`, `claim_race_invites`), auto-profile trigger, `updated_at` triggers, and realtime on `race_events`.

## 6. Verify Realtime is on (30 sec)

**Database → Publications** → `supabase_realtime` should list `race_events`. (The SQL adds it; this is just a check.)

## 7. Verify RLS is on (30 sec)

**Table Editor** → each of the 5 tables should show an "RLS enabled" badge. If any table says RLS disabled, re-run the SQL.

## 8. Configure the app (1 min)

1. Supabase dashboard → **Settings → API** (or "Data API") → copy:
   - **Project URL**
   - **anon public** key
2. In the repo root, create `.env.local` (template: `.env.example`):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```
3. Restart the dev server: `npm run dev`.

`.env.local` is git-ignored — never commit the keys. The anon key is safe to ship in the client bundle (RLS is the protection); the `service_role` key must NEVER appear in this app.

## 9. Verify the connection (2 min)

1. Open the app → any race → **Cloud** tab.
   - Before setup it said "Cloud sync is not configured"; now it shows **Sign in with Google**.
2. Sign in → you should return to the app logged in (your email shows in the Cloud tab).
3. Click **Upload race to cloud** → status badge shows "Up to date"; in Supabase **Table Editor → races** you should see one row, and your email in `race_users` with role `CREATOR`.

If login redirects but you come back logged out: check step 4 (Redirect URLs) first — it's the most common miss.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Cloud sync is not configured" after adding `.env.local` | Restart `npm run dev` — Vite reads env only at startup. Var names must start with `VITE_`. |
| Google login → `redirect_uri_mismatch` | The redirect URI in Google Cloud must be exactly `https://<ref>.supabase.co/auth/v1/callback`. |
| Login works but returns to app logged out | Add the app's origin to Supabase **Redirect URLs** (step 4). |
| `403` / "new row violates row-level security" on upload | The SQL didn't run fully — re-run the whole file. |
| Invited user sees no race in "Shared with me" | They must sign in with the exact invited email; check `race_users` row exists and app called `claim_race_invites` (happens automatically on login). |
| Realtime not updating on second device | Check **Database → Publications** includes `race_events`; both devices must be on the same race and logged in. |
