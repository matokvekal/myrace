/**
 * Storage of the Live action log (Task 3, 2026-11-15).
 *
 * The log used to be written to localStorage as-is after EVERY tap: each entry carries two
 * whole rider objects (after + exact pre-tap snapshot) with their cumulative `lapsDetails`,
 * so a wave's log grew with laps² and the whole of it was re-serialized synchronously on
 * each lap (megabytes late in a long race). Logs of finished races were never removed.
 *
 * What is kept, exactly:
 * - Every entry (the complete arrival record of the wave): id, time, source, colour, status,
 *   Shared-race action id, and the rider as recorded (name, bib, laps, times, last lap).
 * - The FULL entry (pre-tap snapshot + every lap) for the newest entry of each rider, the
 *   newest LAP entry of each rider, and anything younger than `FULL_ENTRY_MS`. Those are the
 *   only entries an undo can use: the Log panel cancels within 30 s, the keypad and the rider
 *   menu undo only a rider's latest lap. Older entries drop the snapshot and keep only the
 *   rider fields the Log shows and their own (last) lap; the Log's per-rider (Bib) view reads the newest entry, which keeps all.
 */
import type { RiderProps } from "@/types/types";
import type { RiderAction } from "./useLapRecording";

export const LOG_STORAGE_PREFIX = "commissaire.actionLog.";
export const REDO_STORAGE_PREFIX = "commissaire.finishRedo.";
const KEYPAD_STORAGE_PREFIX = "commissaire.rapidEntry.";
/** Per-wave keys of the Live screen that only serve that wave while it can still change. */
const WAVE_PREFIXES = [LOG_STORAGE_PREFIX, REDO_STORAGE_PREFIX, KEYPAD_STORAGE_PREFIX];

/** An entry this young keeps its snapshot whatever it is (well past the 30 s undo window). */
export const FULL_ENTRY_MS = 2 * 60 * 1000;
/** At most one log write per this many ms; the log is also written when the page hides / unmounts. */
export const LOG_SAVE_DELAY_MS = 1000;

/** The rider fields the Log shows / an old entry is matched by (its own lap only). */
const LOG_RIDER_FIELDS = [
  "id", "uuid", "raceUuid", "bibNumber", "firstName", "lastName", "team", "category", "subCategory", "heat",
  "raceStatus", "status", "totalLaps", "lapsCounter", "elapsedLastLap", "elapsedTimeFromStart", "timeArrive",
  "timeStartRace", "position_category",
] as const satisfies readonly (keyof RiderProps)[];

function logRider(r: RiderProps): RiderProps {
  const out: Partial<RiderProps> = {};
  for (const k of LOG_RIDER_FIELDS) if (r[k] !== undefined) (out as Record<string, unknown>)[k] = r[k];
  out.lapsDetails = (r.lapsDetails ?? []).slice(-1);
  // A trimmed copy on purpose: it is only displayed; nothing restores a rider from it.
  return out as RiderProps;
}

export function compactActions(actions: RiderAction[], now = Date.now()): RiderAction[] {
  const newestAny = new Set<number>();
  const newestLap = new Set<number>();
  return actions.map((a) => {
    // Newest first: the first entry seen for a rider is its newest.
    const id = a.rider?.id;
    let keep = now - a.timestamp < FULL_ENTRY_MS;
    if (!newestAny.has(id)) {
      newestAny.add(id);
      keep = true;
    }
    if (!a.statusChange && !newestLap.has(id)) {
      newestLap.add(id);
      keep = true;
    }
    if (keep) return a;
    const { prevRider: _dropped, ...rest } = a;
    void _dropped;
    return { ...rest, rider: logRider(a.rider) };
  });
}

export function loadStoredActions(key: string | null): RiderAction[] {
  if (!key || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOG_STORAGE_PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RiderAction[]) : [];
  } catch {
    return [];
  }
}

const raceOfKey = (storageKey: string): string | null => {
  const prefix = WAVE_PREFIXES.find((p) => storageKey.startsWith(p));
  if (!prefix) return null;
  const rest = storageKey.slice(prefix.length);
  const at = rest.indexOf(":heat:");
  return at > 0 ? rest.slice(0, at) : null;
};

/**
 * Remove the Live per-wave keys (log, finish redo, keypad history) of races whose results
 * can no longer change on this device: finalized, or no longer on the device. The race data
 * itself (IndexedDB / server) and the audit log are untouched.
 * `raceState(uuid)` must say "unknown" for a race it cannot judge — those are always kept.
 */
export function pruneWaveStorage(raceState: (raceUuid: string) => "active" | "finalized" | "gone" | "unknown"): number {
  if (typeof localStorage === "undefined") return 0;
  const drop: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const race = k ? raceOfKey(k) : null;
      if (k && race) {
        const st = raceState(race);
        if (st === "finalized" || st === "gone") drop.push(k);
      }
    }
    for (const k of drop) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
  return drop.length;
}

export type SaveResult = "saved" | "failed";

/** Write a (compacted) log. On a full storage, frees what `onFull` can and tries once more. */
export function saveStoredActions(key: string, actions: RiderAction[], onFull?: () => void): SaveResult {
  if (typeof localStorage === "undefined") return "failed";
  let json: string;
  try {
    json = JSON.stringify(compactActions(actions));
  } catch {
    return "failed";
  }
  try {
    localStorage.setItem(LOG_STORAGE_PREFIX + key, json);
    return "saved";
  } catch {
    onFull?.();
    try {
      localStorage.setItem(LOG_STORAGE_PREFIX + key, json);
      return "saved";
    } catch {
      return "failed";
    }
  }
}
