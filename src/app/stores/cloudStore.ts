/**
 * Cloud store — Supabase session + per-race cloud links/roles.
 *
 * Local-first: everything here is optional. When Supabase is not configured
 * or the user is not logged in, the rest of the app behaves exactly as before.
 *
 * `links` maps a LOCAL race uuid -> its cloud row + my role. It is persisted
 * to localStorage so permissions keep working offline after a race was opened.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
   CloudRaceLink,
   CloudSyncState,
   CloudUser,
   RaceRole,
} from "@/types/cloud.types";
import { getSupabase, isCloudConfigured } from "@/services/cloud/supabaseClient";

export interface CloudRaceSummary {
   cloudId: string;
   localId: string | null;
   name: string;
   raceDate: string | null;
   myRole: RaceRole;
}

interface CloudState {
   user: CloudUser | null;
   syncState: CloudSyncState;
   /** local race uuid -> cloud link */
   links: Record<string, CloudRaceLink>;
   /** cloud races I have access to (for download / join) */
   myCloudRaces: CloudRaceSummary[];
   initialized: boolean;

   init: () => void;
   signInWithGoogle: () => Promise<{ error?: string }>;
   signOut: () => Promise<void>;

   setLink: (link: CloudRaceLink) => void;
   removeLink: (localId: string) => void;
   getLink: (raceId: string) => CloudRaceLink | null;
   setSyncState: (s: CloudSyncState) => void;
   refreshMyRoles: () => Promise<void>;
}

export const useCloudStore = create<CloudState>()(
   persist(
      (set, get) => ({
         user: null,
         syncState: "idle",
         links: {},
         myCloudRaces: [],
         initialized: false,

         init: () => {
            if (get().initialized || !isCloudConfigured()) return;
            set({ initialized: true });
            const supabase = getSupabase();
            if (!supabase) return;

            supabase.auth.onAuthStateChange(async (event, session) => {
               if (session?.user) {
                  set({
                     user: {
                        id: session.user.id,
                        email: session.user.email ?? "",
                        displayName:
                           (session.user.user_metadata?.full_name as string) ??
                           session.user.email,
                     },
                  });
                  // SIGNED_IN = fresh login; INITIAL_SESSION = restored on startup.
                  // Both need invite claiming + fresh roles (claim is idempotent).
                  if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
                     if (navigator.onLine) {
                        try {
                           await supabase.rpc("claim_race_invites");
                        } catch (e) {
                           console.warn("claim_race_invites failed:", e);
                        }
                        await get().refreshMyRoles();
                     }
                  }
               } else {
                  set({ user: null });
               }
            });
         },

         signInWithGoogle: async () => {
            const supabase = getSupabase();
            if (!supabase) return { error: "Cloud is not configured" };
            const { error } = await supabase.auth.signInWithOAuth({
               provider: "google",
               options: { redirectTo: window.location.origin },
            });
            return error ? { error: error.message } : {};
         },

         signOut: async () => {
            const supabase = getSupabase();
            if (supabase) await supabase.auth.signOut();
            set({ user: null, myCloudRaces: [] });
         },

         setLink: (link) =>
            set((s) => ({ links: { ...s.links, [link.localId]: link } })),

         removeLink: (localId) =>
            set((s) => {
               const links = { ...s.links };
               delete links[localId];
               return { links };
            }),

         getLink: (raceId) => {
            const { links } = get();
            if (links[raceId]) return links[raceId];
            // also allow lookup by cloud id
            return (
               Object.values(links).find((l) => l.cloudId === raceId) ?? null
            );
         },

         setSyncState: (syncState) => set({ syncState }),

         refreshMyRoles: async () => {
            const supabase = getSupabase();
            const { user } = get();
            if (!supabase || !user) return;

            const { data, error } = await supabase
               .from("race_users")
               .select("role, races(id, local_id, name, race_date)")
               .not("races", "is", null);

            if (error) {
               console.warn("refreshMyRoles failed:", error.message);
               return;
            }

            const summaries: CloudRaceSummary[] = [];
            const links = { ...get().links };

            for (const row of data ?? []) {
               const race = row.races as unknown as {
                  id: string;
                  local_id: string | null;
                  name: string;
                  race_date: string | null;
               } | null;
               if (!race) continue;
               const role = row.role as RaceRole;
               summaries.push({
                  cloudId: race.id,
                  localId: race.local_id,
                  name: race.name,
                  raceDate: race.race_date,
                  myRole: role,
               });
               // refresh role on any existing local link to this cloud race
               for (const link of Object.values(links)) {
                  if (link.cloudId === race.id && link.myRole !== role) {
                     links[link.localId] = { ...link, myRole: role };
                  }
               }
            }

            set({ myCloudRaces: summaries, links });
         },
      }),
      {
         name: "cloud-storage",
         partialize: (state) => ({ links: state.links }),
      }
   )
);

export default useCloudStore;
