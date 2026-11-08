import { create } from "zustand";
import type { RaceProps, RiderProps } from "@/types/types";
import { AuditLogService } from "@/services/auditLog/auditLogService";
import useRaceStore from "./racesStore";
import useRiderStore from "./ridersStore";
import { isLiveRace } from "@/services/live/liveBridge";
import type { SharedCheckInEvent } from "@/services/live/liveClient";

export type CheckInChangeKind = "status" | "bib" | "added" | "name";

const ACTION: Record<CheckInChangeKind, string> = {
  status: "CHECKIN_STATUS",
  bib: "CHECKIN_BIB",
  added: "CHECKIN_RIDER_ADDED",
  name: "CHECKIN_NAME",
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
    // Shared race (0.3.3): the server's history: every judge's changes, on every device.
    // This device's own log only for a local race, or when the server can't be reached.
    if (isLiveRace(race.uuid)) {
      try {
        const live = await import("@/services/live/liveClient");
        const { events } = await live.team.checkInHistory(race.uuid);
        set({ raceUuid: race.uuid, changes: sharedCheckInChanges(events, race) });
        return;
      } catch {
        /* offline / older server: fall back to this device's log */
      }
    }
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

/** "2026-11-08" or "08/11/2026" -> "2026-11-08"; anything else -> null (no day filter). */
const isoDay = (d: string | undefined): string | null => {
  if (!d) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};
const localDay = (iso: string) => {
  const t = new Date(iso);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

/**
 * The server's start-list events -> Check-In changes, newest first. Only race-day changes made
 * before the rider's wave went (the server filters on GO) (status at Check-In, bib, name, late entry), so setup edits days
 * before and DNF/DSQ during the race don't show as Check-In changes. Previous values are
 * followed through the events (a status starts as "standing").
 */
export function sharedCheckInChanges(events: SharedCheckInEvent[], race: Pick<RaceProps, "uuid" | "date">): CheckInChange[] {
  const riders = useRiderStore.getState().riders.filter((r) => r.raceUuid === race.uuid);
  const byUuid = new Map(riders.filter((r) => r.uuid).map((r) => [r.uuid!, r]));
  const day = isoDay(race.date);
  const status = new Map<string, string>();
  const bib = new Map<string, number>();
  const name = new Map<string, string>();
  const out: CheckInChange[] = [];
  for (const e of events) {
    const r = byUuid.get(e.riderUuid);
    const wave = e.heat ?? r?.heat ?? 0;
    const prevStatus = status.get(e.riderUuid) ?? "standing";
    const prevBib = bib.get(e.riderUuid);
    const prevName = name.get(e.riderUuid);
    const hasName = e.lastName != null || e.firstName != null;
    const fullName = hasName ? `${e.lastName ?? r?.lastName ?? ""} ${e.firstName ?? r?.firstName ?? ""}`.trim() : null;
    if (e.type === "StatusCorrection" && e.status) status.set(e.riderUuid, e.status === "running" ? "standing" : e.status);
    if (typeof e.bibNumber === "number") bib.set(e.riderUuid, e.bibNumber);
    if (fullName) name.set(e.riderUuid, fullName);
    // Race day only (the server already left out what happened after the wave's GO).
    if (day && localDay(e.eventAt) < day) continue;
    const base = {
      timestamp: e.eventAt,
      wave: Number(wave),
      bib: typeof e.bibNumber === "number" ? e.bibNumber : r?.bibNumber ?? 0,
      riderName: fullName ?? (r ? `${r.lastName} ${r.firstName}` : ""),
      by: e.userName ?? "UNKNOWN",
    };
    if (e.type === "RiderAdded") {
      out.push({ ...base, kind: "added", text: `Added to ${r?.category ?? "the race"}` });
    } else if (e.type === "StatusCorrection") {
      const next = e.status === "running" ? "standing" : e.status ?? "";
      if (next !== prevStatus) out.push({ ...base, kind: "status", text: `${prevStatus} → ${next}` });
    } else {
      if (typeof e.bibNumber === "number" && e.bibNumber !== prevBib)
        out.push({ ...base, kind: "bib", text: prevBib != null ? `Bib ${prevBib} → ${e.bibNumber}` : `Bib → ${e.bibNumber}` });
      if (fullName && fullName !== prevName)
        out.push({ ...base, kind: "name", text: prevName ? `${prevName} → ${fullName}` : `Name → ${fullName}` });
    }
  }
  return out.reverse();
}

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
