/**
 * Keeps an open race screen in sync with the cloud.
 *
 * Safe no-op when Supabase is not configured, the user is not logged in,
 * or the race was never uploaded — the local flow is untouched.
 */

import { useEffect } from "react";
import { useCloudStore } from "@/stores/cloudStore";
import { isCloudConfigured } from "@/services/cloud/supabaseClient";
import {
   attachOnlineListener,
   pullRemoteEvents,
   pushPendingEvents,
   subscribeToRaceEvents,
} from "@/services/cloud/cloudSync";

export function useCloudRaceSync(raceUuid: string): void {
   const user = useCloudStore((s) => s.user);
   const link = useCloudStore((s) => s.links[raceUuid] ?? null);

   useEffect(() => {
      if (!isCloudConfigured()) return;
      useCloudStore.getState().init();
      attachOnlineListener();
   }, []);

   useEffect(() => {
      if (!isCloudConfigured() || !user || !link || !raceUuid) return;

      // catch up, flush anything recorded offline, then listen live
      void pullRemoteEvents(raceUuid);
      void pushPendingEvents(raceUuid);
      const unsubscribe = subscribeToRaceEvents(raceUuid);
      return unsubscribe;
   }, [raceUuid, user, link]);
}

export default useCloudRaceSync;
