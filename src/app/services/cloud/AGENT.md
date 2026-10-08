# Services Cloud Folder Guide

Purpose

- Cloud sync / per-race roles logic backing `components/cloud/`: Supabase
  client, sync engine, permission checks, and race event helpers. See
  `docs/cloud/0-START.md` (numbered doc set) for the full architecture before
  changing this folder — implemented through Stage 2 per project memory
  `project_cloud_sync.md`; two-device testing still pending.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. ../../../../../docs/cloud/0-START.md
4. cloudConfig.ts (env-only "is cloud configured?" check)
5. supabaseClient.ts, cloudSync.ts, permissions.ts, raceEvents.ts

Immediate Children Summary

- No child folders.
- Top-level files:
  - cloudConfig.ts (`isCloudConfigured()` — env var check ONLY, no
    `@supabase/supabase-js` import; this is what lets `App.tsx` ask "is cloud
    on?" without pulling the SDK into the initial bundle)
  - supabaseClient.ts (creates the actual Supabase client — dynamic-imported)
  - cloudSync.ts (largest file — the sync engine)
  - permissions.ts (per-race role/permission checks)
  - raceEvents.ts (race-related realtime/event helpers)

Conventions

- `cloudConfig.ts` must stay SDK-free — this split exists specifically so the
  eager App.tsx startup path never drags in Supabase (root CLAUDE.md
  "Bundle / code-splitting", BUGS.md #1). Never add a supabase-js import to
  this file.
- Anything that touches the actual SDK belongs in `supabaseClient.ts`/
  `cloudSync.ts`, both reached only through `App.tsx`'s dynamic
  `isCloudConfigured()`-gated import.
- The Cloud tab/UI this powers is currently commented out of the app (per the
  session's test-plan scope notes) — treat this as in-progress infrastructure,
  verify current reachability before assuming it's live end to end.

When To Update

- Sync protocol or conflict-resolution behavior changes
- Role/permission model changes (coordinate with `components/admin/AdminPanel.tsx`)
- Supabase schema changes (coordinate with `docs/cloud/6-database.md`)
