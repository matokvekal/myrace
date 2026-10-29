/**
 * Cloud configuration check — env only, no `@supabase/supabase-js` import.
 *
 * Split out from `supabaseClient.ts` (BUGS.md #1) so the eager startup path
 * (App.tsx) can ask "is cloud configured?" without dragging the whole Supabase
 * SDK into the initial bundle. The SDK now loads on demand, only when a cloud
 * feature actually runs.
 */
export function isCloudConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}
