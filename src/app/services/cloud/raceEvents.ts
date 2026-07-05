/**
 * Race event log — local-first (Part 3).
 *
 * Every important race action calls recordRaceEvent(). The event is written
 * to IndexedDB first (so nothing is ever lost offline), then a background
 * push to Supabase is triggered if the race is cloud-linked.
 *
 * This is an overlay on the existing flow: the current rider/store updates
 * keep working exactly as before; we only log what happened.
 */

import type { RaceEvent, RaceEventType } from "@/types/cloud.types";
import { putRaceEventInDb } from "@/stores/indexDb/indexedDbHelper";
import { getDeviceId } from "./supabaseClient";
import { useCloudStore } from "@/stores/cloudStore";

interface RecordEventInput {
   raceUuid: string;
   riderId: number;
   bibNumber: number;
   eventType: RaceEventType;
   lapNumber?: number | null;
   payload?: Record<string, unknown>;
}

/** Lazy import breaks the circular dependency with cloudSync. */
async function nudgeSync(raceUuid: string) {
   try {
      const { pushPendingEvents } = await import("./cloudSync");
      void pushPendingEvents(raceUuid);
   } catch (e) {
      console.warn("Sync nudge failed:", e);
   }
}

export async function recordRaceEvent(input: RecordEventInput): Promise<RaceEvent> {
   const { user, getLink } = useCloudStore.getState();
   const link = getLink(input.raceUuid);

   const event: RaceEvent = {
      id: crypto.randomUUID(),
      raceId: input.raceUuid,
      riderId: input.riderId,
      bibNumber: input.bibNumber,
      eventType: input.eventType,
      lapNumber: input.lapNumber ?? null,
      eventTime: new Date().toISOString(),
      userId: user?.id ?? null,
      deviceId: getDeviceId(),
      // races that never went to the cloud stay "local" and are skipped by sync
      syncStatus: link ? "pending" : "local",
      payload: input.payload,
      createdAt: new Date().toISOString(),
   };

   await putRaceEventInDb(event);

   if (link) void nudgeSync(input.raceUuid);

   return event;
}
