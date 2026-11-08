import { useEffect } from "react";
import { isLiveRace } from "./liveBridge";
import useRiderStore from "@/stores/ridersStore";

const serverConfigured = !!import.meta.env.VITE_SERVER_URL;

/**
 * A screen showing a shared race (Board, Results) joins its live room, so it
 * gets `race:changes` pushes even when opened directly (reload, shared link).
 * It reuses the app's one Socket.IO connection; nothing to clean up here:
 * the room is left when another race (or none) is opened.
 */
export function useLiveRaceRoom(raceUuid: string) {
  const linked = isLiveRace(raceUuid);
  useEffect(() => {
    if (!serverConfigured || !linked) return;
    void import("./liveClient").then((m) => m.openLiveRace(raceUuid));
  }, [raceUuid, linked]);
}

/**
 * Manual Refresh. A shared race asks the server for what changed since the last
 * applied sequence (deduplicated with any catch-up already running); a race kept
 * on this device only re-reads its own copy, without any network request.
 */
export async function refreshRaceData(raceUuid: string): Promise<void> {
  if (serverConfigured && isLiveRace(raceUuid)) {
    const live = await import("./liveClient");
    if (await live.refreshRace(raceUuid)) return;
  }
  useRiderStore.setState({ lastFetchedRaceUuid: "" });
  await useRiderStore.getState().getRiders(raceUuid);
}
