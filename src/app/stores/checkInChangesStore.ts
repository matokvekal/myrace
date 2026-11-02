import { create } from "zustand";
import type { RaceProps, RiderProps } from "@/types/types";
import { AuditLogService } from "@/services/auditLog/auditLogService";
import useRaceStore from "./racesStore";

export type CheckInChangeKind = "status" | "bib" | "added";

const ACTION: Record<CheckInChangeKind, string> = {
  status: "CHECKIN_STATUS",
  bib: "CHECKIN_BIB",
  added: "CHECKIN_RIDER_ADDED",
};
const KIND_OF_ACTION = Object.fromEntries(Object.entries(ACTION).map(([k, a]) => [a, k])) as Record<string, CheckInChangeKind>;

export interface CheckInChange {
  timestamp: string;
  kind: CheckInChangeKind;
  wave: number;
  bib: number;
  riderName: string;
  text: string;
  by: string;
}

interface State {
  raceUuid: string | null;
  changes: CheckInChange[];
  load: (race: RaceProps) => Promise<void>;
}

/**
 * The changes the main commissaire reviews from the race timeline: status, bib
 * and added riders. They live in the race's audit log (so View Log shows them
 * too); this reads them back, newest first.
 */
export const useCheckInChanges = create<State>((set) => ({
  raceUuid: null,
  changes: [],
  load: async (race) => {
    const entries = await AuditLogService.readEntries(race).catch(() => []);
    const changes = entries
      .filter((e) => KIND_OF_ACTION[e.action])
      .map((e) => ({
        timestamp: e.timestamp,
        kind: KIND_OF_ACTION[e.action],
        wave: Number(e.details.wave),
        bib: Number(e.details.bib),
        riderName: String(e.details.riderName ?? ""),
        text: String(e.details.text ?? ""),
        by: e.performedBy.userName,
      }))
      .reverse();
    set({ raceUuid: race.uuid, changes });
  },
}));

export function logCheckInChange(
  raceUuid: string,
  change: {
    kind: CheckInChangeKind;
    wave: number;
    rider: Pick<RiderProps, "id" | "bibNumber" | "firstName" | "lastName">;
    text: string;
    before?: unknown;
    after?: unknown;
  }
): void {
  const race = useRaceStore.getState().races.find((r) => r.uuid === raceUuid);
  if (!race) return;
  const { kind, wave, rider, text, before, after } = change;
  void AuditLogService.log({
    race,
    action: ACTION[kind],
    screen: "Check-In",
    entityType: "rider",
    entityId: rider.id,
    before,
    after,
    details: { wave, bib: rider.bibNumber, riderName: `${rider.lastName} ${rider.firstName}`, text },
  }).then(() => useCheckInChanges.getState().load(race));
}
