/**
 * Supabase client — single instance, null-safe.
 *
 * The app is local-first: when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are
 * not configured, every cloud feature quietly disables itself and the app
 * keeps working from IndexedDB exactly as before.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function isCloudConfigured(): boolean {
   return Boolean(url && anonKey);
}

export function getSupabase(): SupabaseClient | null {
   if (!isCloudConfigured()) return null;
   if (!client) {
      client = createClient(url!, anonKey!, {
         auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true, // completes the Google OAuth redirect
         },
      });
   }
   return client;
}

/** Stable per-device id used to tag race events. */
export function getDeviceId(): string {
   const KEY = "commissaire-device-id";
   let id = localStorage.getItem(KEY);
   if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
   }
   return id;
}
