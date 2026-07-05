/**
 * Cloud sync service (Part 3).
 *
 * Local-first: IndexedDB stays the source of truth for the UI.
 * Supabase is the sync target/source between commissaires.
 *
 *  - uploadRaceToCloud   race + riders snapshot -> cloud, creator gets CREATOR role
 *  - downloadRaceFromCloud   cloud race -> local IDB copy
 *  - pushPendingEvents   pending local events -> race_events (first accepted wins)
 *  - pullRemoteEvents    remote events -> local IDB + rider state
 *  - subscribeToRaceEvents   realtime INSERTs while a race screen is open
 *  - invite/list/remove race users
 */

import type { RaceProps, RiderProps } from "@/types/types";
import type {
   RaceEvent,
   RaceRole,
   RaceUserEntry,
} from "@/types/cloud.types";
import {
   getAllRidersFromDb,
   getPendingEventsFromDb,
   putRaceEventInDb,
   raceEventExistsInDb,
   setRaceEventStatusInDb,
} from "@/stores/indexDb/indexedDbHelper";
import { getSupabase } from "./supabaseClient";
import { useCloudStore } from "@/stores/cloudStore";
import { canForRace } from "./permissions";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";

// Postgres error codes
const UNIQUE_VIOLATION = "23505";
const RLS_VIOLATION = "42501";

// ============================================================================
// Race upload / download
// ============================================================================

export async function uploadRaceToCloud(
   race: RaceProps
): Promise<{ ok: boolean; error?: string }> {
   const supabase = getSupabase();
   const { user, getLink, setLink, setSyncState } = useCloudStore.getState();
   if (!supabase || !user) return { ok: false, error: "Login required" };

   setSyncState("syncing");
   try {
      const link = getLink(race.uuid);
      let cloudId = link?.cloudId;

      if (!cloudId) {
         const { data, error } = await supabase
            .from("races")
            .insert({
               local_id: race.uuid,
               name: race.name,
               race_date: race.date || null,
               status: race.status ?? "draft",
               payload: race as unknown as Record<string, unknown>,
               created_by: user.id,
            })
            .select("id")
            .single();
         if (error) throw error;
         cloudId = data.id as string;

         // creator membership row (RLS on race_users allows CREATOR/ADMIN only,
         // but races_insert already proved ownership — insert as creator)
         const { error: memberError } = await supabase.from("race_users").insert({
            race_id: cloudId,
            user_id: user.id,
            email: user.email,
            role: "CREATOR",
            created_by: user.id,
         });
         if (memberError && memberError.code !== UNIQUE_VIOLATION) throw memberError;
      } else {
         const { error } = await supabase
            .from("races")
            .update({
               name: race.name,
               race_date: race.date || null,
               status: race.status ?? "draft",
               payload: race as unknown as Record<string, unknown>,
               updated_at: new Date().toISOString(),
            })
            .eq("id", cloudId);
         if (error) throw error;
      }

      // riders snapshot
      const allRiders = await getAllRidersFromDb();
      const riders = allRiders.filter((r) => r.raceUuid === race.uuid);
      if (riders.length > 0) {
         const rows = riders.map((r) => ({
            race_id: cloudId,
            local_id: String(r.id),
            bib: String(r.bibNumber),
            first_name: r.firstName,
            last_name: r.lastName,
            category: r.category,
            team: r.team,
            status: r.status,
            payload: r as unknown as Record<string, unknown>,
            updated_at: new Date().toISOString(),
         }));
         const { error } = await supabase
            .from("riders")
            .upsert(rows, { onConflict: "race_id,bib" });
         if (error) throw error;
      }

      setLink({
         localId: race.uuid,
         cloudId,
         myRole: link?.myRole ?? "CREATOR",
         lastSyncedAt: new Date().toISOString(),
      });
      setSyncState("idle");

      // anything recorded before upload becomes syncable now
      void pushPendingEvents(race.uuid);
      return { ok: true };
   } catch (e: any) {
      console.error("uploadRaceToCloud failed:", e);
      useCloudStore.getState().setSyncState("error");
      return { ok: false, error: e?.message ?? String(e) };
   }
}

export async function downloadRaceFromCloud(
   cloudId: string,
   myRole: RaceRole
): Promise<{ ok: boolean; localId?: string; error?: string }> {
   const supabase = getSupabase();
   if (!supabase) return { ok: false, error: "Cloud is not configured" };

   try {
      const { data: raceRow, error } = await supabase
         .from("races")
         .select("*")
         .eq("id", cloudId)
         .single();
      if (error) throw error;

      const snapshot = raceRow.payload as RaceProps | null;
      const localId = (raceRow.local_id as string) || crypto.randomUUID();

      const raceStore = useRaceStore.getState();
      const races = await raceStore.getRaces();
      if (!races.some((r) => r.uuid === localId)) {
         const localRace: RaceProps = snapshot
            ? { ...snapshot, uuid: localId }
            : ({
                 id: Date.now(),
                 uuid: localId,
                 name: raceRow.name,
                 date: raceRow.race_date ?? "",
                 status: "upcoming",
              } as unknown as RaceProps);
         await raceStore.insertRace(localRace);
      }

      const { data: riderRows, error: ridersError } = await supabase
         .from("riders")
         .select("payload")
         .eq("race_id", cloudId);
      if (ridersError) throw ridersError;

      const riders = (riderRows ?? [])
         .map((row) => row.payload as RiderProps | null)
         .filter((r): r is RiderProps => Boolean(r))
         .map((r) => ({ ...r, raceUuid: localId }));
      if (riders.length > 0) {
         await useRiderStore.getState().insertRiders(riders);
      }

      useCloudStore.getState().setLink({
         localId,
         cloudId,
         myRole,
         lastSyncedAt: new Date().toISOString(),
      });

      await pullRemoteEvents(localId);
      return { ok: true, localId };
   } catch (e: any) {
      console.error("downloadRaceFromCloud failed:", e);
      return { ok: false, error: e?.message ?? String(e) };
   }
}

// ============================================================================
// Event push / pull / realtime
// ============================================================================

/** local rider id / bib -> cloud rider uuid */
async function getCloudRiderMap(cloudRaceId: string): Promise<Map<string, string>> {
   const supabase = getSupabase();
   const map = new Map<string, string>();
   if (!supabase) return map;
   const { data } = await supabase
      .from("riders")
      .select("id, local_id, bib")
      .eq("race_id", cloudRaceId);
   for (const row of data ?? []) {
      if (row.local_id) map.set(`local:${row.local_id}`, row.id);
      map.set(`bib:${row.bib}`, row.id);
   }
   return map;
}

let pushing = false;

export async function pushPendingEvents(raceUuid?: string): Promise<void> {
   const supabase = getSupabase();
   const { user, getLink, setSyncState } = useCloudStore.getState();
   if (!supabase || !user) return;
   if (!navigator.onLine) {
      setSyncState("offline");
      return;
   }
   if (pushing) return; // one push at a time
   pushing = true;

   try {
      const pending = await getPendingEventsFromDb(raceUuid);
      if (pending.length === 0) return;
      setSyncState("syncing");

      // group by race
      const byRace = new Map<string, RaceEvent[]>();
      for (const event of pending) {
         const list = byRace.get(event.raceId) ?? [];
         list.push(event);
         byRace.set(event.raceId, list);
      }

      for (const [localRaceId, events] of byRace) {
         const link = getLink(localRaceId);
         if (!link) continue;
         const riderMap = await getCloudRiderMap(link.cloudId);

         for (const event of events) {
            const cloudRiderId =
               riderMap.get(`local:${event.riderId}`) ??
               riderMap.get(`bib:${event.bibNumber}`);
            if (!cloudRiderId) {
               // rider not uploaded yet — retry after next race upload
               continue;
            }

            const { error } = await supabase.from("race_events").insert({
               id: event.id,
               race_id: link.cloudId,
               rider_id: cloudRiderId,
               bib: String(event.bibNumber),
               event_type: event.eventType,
               lap_number: event.lapNumber,
               event_time: event.eventTime,
               payload: event.payload ?? null,
               created_by: user.id,
               device_id: event.deviceId,
               status: "accepted",
            });

            if (!error) {
               await setRaceEventStatusInDb(event.id, "synced");
            } else if (error.code === UNIQUE_VIOLATION) {
               // someone else marked this lap first — first accepted wins
               await setRaceEventStatusInDb(event.id, "rejected");
            } else if (error.code === RLS_VIOLATION) {
               await setRaceEventStatusInDb(event.id, "rejected");
               console.warn("Event rejected by permissions:", event.eventType);
            } else {
               console.warn("Event push failed, will retry:", error.message);
            }
         }
      }
      setSyncState("idle");
   } catch (e) {
      console.error("pushPendingEvents failed:", e);
      useCloudStore.getState().setSyncState("error");
   } finally {
      pushing = false;
   }
}

/** Convert a cloud race_events row to the local RaceEvent shape. */
function rowToLocalEvent(row: any, localRaceId: string): RaceEvent {
   const payload = (row.payload ?? undefined) as
      | Record<string, unknown>
      | undefined;
   const localRiderId = Number(
      (payload?.riderLocalId as string | number | undefined) ?? NaN
   );
   return {
      id: row.id,
      raceId: localRaceId,
      riderId: Number.isNaN(localRiderId) ? -1 : localRiderId,
      bibNumber: Number(row.bib ?? 0),
      eventType: row.event_type,
      lapNumber: row.lap_number,
      eventTime: row.event_time,
      userId: row.created_by,
      deviceId: row.device_id ?? "",
      syncStatus: "synced",
      payload,
      createdAt: row.created_at,
   };
}

/**
 * Apply a remote event to the local rider state so a second commissaire's
 * clicks show up here. Events we created ourselves never reach this point
 * (they already exist in IndexedDB).
 */
async function applyRemoteEvent(event: RaceEvent): Promise<void> {
   const riderStore = useRiderStore.getState();
   const rider = riderStore.riders.find(
      (r) =>
         r.raceUuid === event.raceId &&
         (r.id === event.riderId || r.bibNumber === event.bibNumber)
   );
   if (!rider) return;

   // The recorder embeds the resulting rider fields, so applying is a merge —
   // no need to re-run lap math on this device.
   const patch = (event.payload?.riderPatch ?? null) as Partial<RiderProps> | null;
   let updated: RiderProps;

   if (patch) {
      updated = { ...rider, ...patch, id: rider.id, raceUuid: rider.raceUuid };
   } else {
      // fallback semantics when no snapshot came along
      switch (event.eventType) {
         case "LAP_MARKED":
            updated = {
               ...rider,
               lapsCounter: Math.max(rider.lapsCounter, event.lapNumber ?? 0),
            };
            break;
         case "RIDER_CHECKIN":
            updated = { ...rider, checked: true };
            break;
         case "DNF":
         case "DNS":
            updated = {
               ...rider,
               status: event.eventType,
               raceStatus: "finished",
            };
            break;
         default:
            return;
      }
   }

   await riderStore.updateRider(updated);
}

export async function pullRemoteEvents(raceUuid: string): Promise<void> {
   const supabase = getSupabase();
   const link = useCloudStore.getState().getLink(raceUuid);
   if (!supabase || !link) return;

   try {
      const { data, error } = await supabase
         .from("race_events")
         .select("*")
         .eq("race_id", link.cloudId)
         .eq("status", "accepted")
         .order("created_at", { ascending: true });
      if (error) throw error;

      for (const row of data ?? []) {
         if (await raceEventExistsInDb(row.id)) continue;
         const event = rowToLocalEvent(row, raceUuid);
         await putRaceEventInDb(event);
         await applyRemoteEvent(event);
      }
   } catch (e) {
      console.error("pullRemoteEvents failed:", e);
   }
}

/** Live updates while a race screen is open. Returns an unsubscribe fn. */
export function subscribeToRaceEvents(raceUuid: string): () => void {
   const supabase = getSupabase();
   const link = useCloudStore.getState().getLink(raceUuid);
   if (!supabase || !link) return () => {};

   const channel = supabase
      .channel(`race-events-${link.cloudId}`)
      .on(
         "postgres_changes",
         {
            event: "INSERT",
            schema: "public",
            table: "race_events",
            filter: `race_id=eq.${link.cloudId}`,
         },
         async (message) => {
            const row = message.new as any;
            if (row.status !== "accepted") return;
            if (await raceEventExistsInDb(row.id)) return; // our own event
            const event = rowToLocalEvent(row, raceUuid);
            await putRaceEventInDb(event);
            await applyRemoteEvent(event);
         }
      )
      .subscribe();

   return () => {
      void supabase.removeChannel(channel);
   };
}

// ============================================================================
// Race users (admin sharing flow)
// ============================================================================

export async function listRaceUsers(raceUuid: string): Promise<RaceUserEntry[]> {
   const supabase = getSupabase();
   const link = useCloudStore.getState().getLink(raceUuid);
   if (!supabase || !link) return [];
   const { data, error } = await supabase
      .from("race_users")
      .select("*")
      .eq("race_id", link.cloudId)
      .order("created_at", { ascending: true });
   if (error) {
      console.warn("listRaceUsers failed:", error.message);
      return [];
   }
   return (data ?? []).map((row) => ({
      id: row.id,
      raceId: row.race_id,
      userId: row.user_id,
      email: row.email,
      role: row.role as RaceRole,
      createdBy: row.created_by,
      createdAt: row.created_at,
   }));
}

export async function inviteUserToRace(
   raceUuid: string,
   email: string,
   role: RaceRole
): Promise<{ ok: boolean; error?: string }> {
   const supabase = getSupabase();
   const { user, getLink } = useCloudStore.getState();
   const link = getLink(raceUuid);
   if (!supabase || !user || !link) return { ok: false, error: "Login required" };
   if (!canForRace(raceUuid, "MANAGE_USERS")) {
      return { ok: false, error: "No permission: MANAGE_USERS" };
   }

   const { error } = await supabase.from("race_users").insert({
      race_id: link.cloudId,
      email: email.trim().toLowerCase(),
      role,
      created_by: user.id,
   });
   if (error) {
      const msg =
         error.code === UNIQUE_VIOLATION
            ? "This email is already invited to the race"
            : error.message;
      return { ok: false, error: msg };
   }
   return { ok: true };
}

export async function removeRaceUser(
   raceUuid: string,
   raceUserId: string
): Promise<{ ok: boolean; error?: string }> {
   const supabase = getSupabase();
   const link = useCloudStore.getState().getLink(raceUuid);
   if (!supabase || !link) return { ok: false, error: "Login required" };
   if (!canForRace(raceUuid, "MANAGE_USERS")) {
      return { ok: false, error: "No permission: MANAGE_USERS" };
   }
   const { error } = await supabase
      .from("race_users")
      .delete()
      .eq("id", raceUserId);
   return error ? { ok: false, error: error.message } : { ok: true };
}

// ============================================================================
// Offline -> online recovery
// ============================================================================

let onlineListenerAttached = false;

export function attachOnlineListener(): void {
   if (onlineListenerAttached || typeof window === "undefined") return;
   onlineListenerAttached = true;
   window.addEventListener("online", () => {
      useCloudStore.getState().setSyncState("idle");
      void pushPendingEvents();
   });
   window.addEventListener("offline", () => {
      useCloudStore.getState().setSyncState("offline");
   });
}
