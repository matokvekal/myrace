/**
 * The race rules engine (Architecture AD-5, Stories 2.3/2.4/2.6): applies one
 * Action to a race state. Ported from the app's live screen and StartManager —
 * the rules are the same, only the inputs are Actions:
 *
 *  - Laps are DERIVED per rider from that rider's recorded marks (AddLap,
 *    RiderFinished, LapCountCorrection), sorted by race-clock time, so a lap
 *    that arrives late from an offline Device still lands in the right place.
 *    Minimum lap time 60 s; a rider finishes at total laps, on the next crossing
 *    after their category finished, or (first finish – all finish) on the next
 *    crossing after their group's leader finished. Laps after finish are kept
 *    in the log but not counted.
 *  - Status (DNF/DSQ/DNS) is a human classification: it never changes laps,
 *    laps never change it (AD-5). The latest StatusCorrection wins.
 *  - Positions: more laps first, then earlier arrival; out riders unranked.
 *  - One wave runs at a time; starting a wave closes out riders of finished
 *    categories still on track, as finishers on their completed laps (never DNF).
 *
 * `applyAction` changes the given state in place and reports what changed. When
 * it lists riders in `rederive`, the caller loads those riders' marks and calls
 * `deriveRider` for each, then `rankRiders`. Pure TypeScript.
 */
import type { RaceAction } from "./actions";
import { RACE_INFO_FIELDS, RIDER_IDENTITY_FIELDS } from "./state";
import type { CategoryUuid, LapDetail, RaceState, RiderUuid, SharedCategory, SharedRider } from "./state";

/** The legacy minimum (60 s); a race's own is raceMinLapMs(state). */
export const MIN_LAP_MS = 60_000;
/** Minimum time between two counted passages of a rider, for this race. */
export const raceMinLapMs = (state: RaceState): number => (state.race.minLapSeconds ?? MIN_LAP_MS / 1000) * 1000;
/** A category whose wave the organizer ignored. */
const isIgnored = (c: SharedCategory | undefined | null): boolean => !!c?.ignored;
const OUT = new Set(["DNF", "DSQ", "DNS"]);

/** Race-clock time of an Action: device clock corrected by its measured offset. */
export const actionTime = (a: Pick<RaceAction, "deviceTime" | "clockOffsetMs">): number =>
  Date.parse(a.deviceTime) + (a.clockOffsetMs || 0);

/** "MM:SS", or "HH:MM:SS" past the hour — the app's formatTime. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** The Device's local wall clock "HH:MM:SS" from an ISO time with offset (display only). */
export const localClock = (iso: string): string => {
  const m = /T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : "00:00:00";
};

// ---------------------------------------------------------------------------
// Lookups

export const categoryKey = (name: string, sub: string | null | undefined) => `${name}::${sub ?? ""}`;

export const categoryOfRider = (state: RaceState, r: Pick<SharedRider, "category" | "subCategory">): SharedCategory | undefined =>
  Object.values(state.categories).find((c) => categoryKey(c.name, c.subCategory) === categoryKey(r.category, r.subCategory));

const ridersOfCategory = (state: RaceState, c: SharedCategory): SharedRider[] =>
  Object.values(state.riders).filter((r) => categoryKey(r.category, r.subCategory) === categoryKey(c.name, c.subCategory));

/** Bell/finish group: explicit linkGroup, else the category itself. */
export const groupKey = (c: Pick<SharedCategory, "name" | "subCategory" | "linkGroup">): string => {
  const explicit = c.linkGroup?.trim().toLowerCase();
  return explicit ? `g:${explicit}` : `c:${categoryKey(c.name, c.subCategory)}`;
};

/** A category's laps, else the rider's own (0/null = not set yet). */
export const effectiveTotalLaps = (c: SharedCategory | undefined, r: SharedRider): number => c?.laps || r.totalLaps || 0;

const leaderFinishAll = (state: RaceState) => state.race.leaderFinishAll !== false;

/** When the first rider of the group completed every lap, or null. */
export function groupFinishAt(state: RaceState, c: SharedCategory, except?: RiderUuid): number | null {
  if (!leaderFinishAll(state)) return null;
  const key = groupKey(c);
  let first: number | null = null;
  for (const cat of Object.values(state.categories)) {
    if (groupKey(cat) !== key || isIgnored(cat)) continue;
    for (const r of ridersOfCategory(state, cat)) {
      if (r.uuid === except || OUT.has(r.status)) continue;
      const laps = effectiveTotalLaps(cat, r);
      if (laps <= 0 || r.lapsCounter < laps || r.raceStatus !== "finished") continue;
      const end = r.lapsDetails[laps - 1]?.endTime;
      const t = end ? Date.parse(end) : NaN;
      if (Number.isFinite(t) && (first === null || t < first)) first = t;
    }
  }
  return first;
}

// ---------------------------------------------------------------------------
// Per-rider derivation

/** One recorded mark for a rider, from the action log. */
export interface RiderMark {
  actionId: string;
  seq: number;
  type: "AddLap" | "RiderFinished" | "LapCountCorrection";
  /** Race-clock time. */
  at: number;
  /** LapCountCorrection only. */
  laps?: number;
  /** Undone by a later Undo. */
  undone?: boolean;
}

/**
 * Recomputes a rider's laps, times, finish and progress from their marks.
 * Returns true when anything changed. Identity, status and check-in are untouched.
 */
export function deriveRider(state: RaceState, riderUuid: RiderUuid, marks: readonly RiderMark[]): boolean {
  const r = state.riders[riderUuid];
  if (!r) return false;
  const cat = categoryOfRider(state, r);
  const totalLaps = effectiveTotalLaps(cat, r);
  const startMs = cat?.startedAt ?? null;
  const catFinishedAt = cat?.finishedAt ?? null;
  const groupDoneAt = cat ? groupFinishAt(state, cat, r.uuid) : null;

  const minLap = raceMinLapMs(state);
  const sorted = marks.filter((m) => !m.undone).slice().sort((a, b) => a.at - b.at || a.seq - b.seq);
  const laps: LapDetail[] = [];
  let count = 0;
  let lastArrive: number | null = null;
  let finished = false;

  for (const m of sorted) {
    if (m.type === "LapCountCorrection") {
      // Sets the count as of this moment: earlier laps are absorbed, later ones count on.
      count = Math.max(0, Math.floor(m.laps ?? 0));
      laps.length = Math.min(laps.length, count);
      finished = totalLaps > 0 && count >= totalLaps;
      continue;
    }
    if (finished) continue; // after finish: kept in the log, not counted
    if (m.type === "RiderFinished") {
      finished = true;
      continue;
    }
    if (startMs === null || m.at < startMs) continue; // before the start
    if (lastArrive !== null && m.at - lastArrive < minLap) continue; // faster than any real lap
    const from = lastArrive ?? startMs;
    count += 1;
    laps.push({
      lap: count,
      startTime: new Date(from).toISOString(),
      endTime: new Date(m.at).toISOString(),
      lapTime: formatTime((m.at - from) / 1000),
      actionId: m.actionId,
    });
    lastArrive = m.at;
    if ((totalLaps > 0 && count >= totalLaps) || (catFinishedAt !== null && m.at >= catFinishedAt) || (groupDoneAt !== null && m.at > groupDoneAt)) {
      finished = true;
    }
  }

  const closedOut = r.status === "finished"; // wave closed while on track (StartManager close-out)
  const isOut = OUT.has(r.status);
  const started = startMs !== null;
  const raceStatus: SharedRider["raceStatus"] = isOut
    ? started || count > 0 ? "finished" : "upcoming"
    : finished || closedOut
      ? "finished"
      : started
        ? "running"
        : "upcoming";

  const last = laps[laps.length - 1];
  const next: Partial<SharedRider> = {
    lapsCounter: count,
    lapsDetails: laps,
    totalLaps,
    timeArrive: last ? last.endTime : null,
    elapsedLastLap: last ? last.lapTime : null,
    elapsedTimeFromStart: last && startMs !== null ? formatTime((Date.parse(last.endTime) - startMs) / 1000) : null,
    raceStatus,
  };
  let changed = false;
  for (const [k, v] of Object.entries(next)) {
    if (JSON.stringify((r as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)) {
      (r as unknown as Record<string, unknown>)[k] = v;
      changed = true;
    }
  }
  return changed;
}

/** Positions for the whole race (calculatePositions). Returns riders whose positions changed. */
export function rankRiders(state: RaceState): RiderUuid[] {
  const timeMs = (t: string | null) => (t ? Date.parse(t) || 0 : 0);
  const byPlace = (a: SharedRider, b: SharedRider) => {
    if (b.lapsCounter !== a.lapsCounter) return b.lapsCounter - a.lapsCounter;
    const at = timeMs(a.timeArrive);
    const bt = timeMs(b.timeArrive);
    if (!at || !bt) return (at ? 0 : 1) - (bt ? 0 : 1);
    return at - bt;
  };
  // Riders of an ignored wave keep their data but take no position.
  const active = Object.values(state.riders).filter((r) => !OUT.has(r.status) && !isIgnored(categoryOfRider(state, r)));
  const pos = new Map<RiderUuid, [number, number]>();
  const groups = new Map<string, SharedRider[]>();
  for (const r of active) {
    const k = categoryKey(r.category, r.subCategory);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) g.sort(byPlace).forEach((r, i) => pos.set(r.uuid, [i + 1, 0]));
  [...active].sort(byPlace).forEach((r, i) => pos.get(r.uuid)![1] = i + 1);
  const changed: RiderUuid[] = [];
  for (const r of Object.values(state.riders)) {
    const [pc, pr] = pos.get(r.uuid) ?? [0, 0];
    if (r.position_category !== pc || r.position_race !== pr) {
      r.position_category = pc;
      r.position_race = pr;
      changed.push(r.uuid);
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Applying one Action

export interface Changes {
  race: boolean;
  categories: Set<CategoryUuid>;
  riders: Set<RiderUuid>;
  removedRiders: RiderUuid[];
  removedCategories: CategoryUuid[];
  /** Riders whose laps must be re-derived from their marks. */
  rederive: Set<RiderUuid>;
}

export type ApplyResult =
  | { applied: true; changes: Changes }
  | { applied: false; reason: "locked" | "invalid" };

export const emptyChanges = (): Changes => ({
  race: false,
  categories: new Set(),
  riders: new Set(),
  removedRiders: [],
  removedCategories: [],
  rederive: new Set(),
});

const notApplied = (reason: "locked" | "invalid"): ApplyResult => ({ applied: false, reason });

/** Category locks (utils/categoryLocks.ts): finished categories keep their laps; never below laps ridden. */
const minLapsFor = (state: RaceState, c: SharedCategory) => Math.max(0, ...ridersOfCategory(state, c).map((r) => r.lapsCounter));

const bibTaken = (state: RaceState, bib: number | null | undefined, except?: RiderUuid) =>
  bib != null && Object.values(state.riders).some((r) => r.uuid !== except && r.bibNumber === bib);

const nowIso = (ms: number) => new Date(ms).toISOString();

/**
 * Applies one Action (already authorized) to `state`. `atMs` is the Action's
 * race-clock time. Lap-type Actions only ask for re-derivation; the caller adds
 * the new mark to the rider's marks before deriving.
 */
export function applyAction(state: RaceState, action: RaceAction, atMs: number): ApplyResult {
  const ch = emptyChanges();
  const p = action.payload as Record<string, unknown>;
  const rider = (uuid: unknown) => (typeof uuid === "string" ? state.riders[uuid] : undefined);
  const touch = (r: SharedRider) => {
    r.updatedAt = nowIso(atMs);
    ch.riders.add(r.uuid);
  };

  switch (action.type) {
    case "AddLap":
    case "RiderFinished":
    case "LapCountCorrection": {
      const r = rider(p.riderUuid);
      if (!r) return notApplied("invalid");
      if (isIgnored(categoryOfRider(state, r))) return notApplied("locked"); // ignored wave: no timing
      if (action.type === "LapCountCorrection" && (!Number.isInteger(action.payload.laps) || action.payload.laps < 0)) return notApplied("invalid");
      ch.rederive.add(r.uuid);
      return { applied: true, changes: ch };
    }

    case "Undo":
      // The caller resolves the target, marks it undone and re-derives its rider.
      return { applied: true, changes: ch };

    case "StatusCorrection": {
      const r = rider(p.riderUuid);
      if (!r) return notApplied("invalid");
      const s = action.payload.status;
      r.status = s === "running" ? "standing" : s;
      touch(r);
      ch.rederive.add(r.uuid);
      return { applied: true, changes: ch };
    }

    case "WaveStarted": {
      const heat = action.payload.heat;
      const running = Object.values(state.categories).find((c) => c.status === "running" && c.heat !== heat);
      if (running) return notApplied("locked"); // one wave at a time
      const wanted = action.payload.categoryUuids;
      const cats = Object.values(state.categories).filter(
        (c) => c.heat === heat && !c.ignored && c.status !== "running" && c.status !== "finished" && (!wanted || wanted.includes(c.uuid)),
      );
      if (cats.length === 0) return { applied: true, changes: ch }; // first start wins; nothing left to start
      // Close out riders of already-finished categories still on track (prior-wave sweep).
      for (const r of Object.values(state.riders)) {
        if (r.raceStatus !== "running") continue;
        if (categoryOfRider(state, r)?.status === "finished") {
          if (!OUT.has(r.status)) r.status = "finished";
          touch(r);
          ch.rederive.add(r.uuid);
        }
      }
      const clock = localClock(action.deviceTime);
      for (const c of cats) {
        c.status = "running";
        c.startedAt = atMs;
        ch.categories.add(c.uuid);
        ridersOfCategory(state, c).forEach((r, i) => {
          if (r.status === "DNS") return;
          r.timeStartRace = clock;
          r.viewOrder = r.position_start ?? i + 1;
          touch(r);
          ch.rederive.add(r.uuid);
        });
      }
      if (state.race.status !== "running") {
        state.race.status = "running";
        ch.race = true;
      }
      return { applied: true, changes: ch };
    }

    case "CategoryFinished": {
      const c = state.categories[action.payload.categoryUuid];
      if (!c) return notApplied("invalid");
      if (c.status !== "running") return { applied: true, changes: ch };
      c.status = "finished";
      c.finishedAt = atMs;
      ch.categories.add(c.uuid);
      for (const r of ridersOfCategory(state, c)) ch.rederive.add(r.uuid);
      return { applied: true, changes: ch };
    }

    case "WaveFinished": {
      const cats = Object.values(state.categories).filter((c) => c.heat === action.payload.heat && c.status !== "finished");
      for (const c of cats) {
        const wasStarted = c.status === "running";
        c.status = "finished";
        c.finishedAt = atMs;
        ch.categories.add(c.uuid);
        if (!wasStarted) continue;
        for (const r of ridersOfCategory(state, c)) {
          // The wave is over: riders still on the road finish on the laps they completed.
          if (r.raceStatus === "running" && !OUT.has(r.status)) {
            r.status = "finished";
            touch(r);
          }
          ch.rederive.add(r.uuid);
        }
      }
      return { applied: true, changes: ch };
    }

    case "CategoryAdded": {
      const n = action.payload.category;
      if (state.categories[n.uuid]) return notApplied("invalid");
      if (Object.values(state.categories).some((c) => categoryKey(c.name, c.subCategory) === categoryKey(n.name, n.subCategory ?? null))) return notApplied("invalid");
      state.categories[n.uuid] = {
        uuid: n.uuid, raceUuid: state.race.uuid, name: n.name, subCategory: n.subCategory ?? null, laps: n.laps ?? null,
        startTime: n.startTime ?? null, isConnected: false, color: n.color ?? null, heat: n.heat ?? null, status: "upcoming",
        linkedFinish: null, linkGroup: n.linkGroup ?? null, ignored: false, bibColor: n.bibColor ?? null, bibTextColor: n.bibTextColor ?? null,
        startedAt: null, finishedAt: null, importOrder: n.importOrder ?? null,
      };
      ch.categories.add(n.uuid);
      return { applied: true, changes: ch };
    }

    case "CategoryEdited": {
      const c = state.categories[action.payload.categoryUuid];
      if (!c) return notApplied("invalid");
      const changes = action.payload.changes as Partial<SharedCategory>;
      if ("laps" in changes && changes.laps !== c.laps) {
        if (c.status === "finished") return notApplied("locked");
        if ((changes.laps ?? 0) < minLapsFor(state, c)) return notApplied("locked");
      }
      if (c.status !== "upcoming" && ("startTime" in changes || "heat" in changes)) return notApplied("locked");
      const oldKey = categoryKey(c.name, c.subCategory);
      Object.assign(c, changes);
      ch.categories.add(c.uuid);
      if (categoryKey(c.name, c.subCategory) !== oldKey) {
        // Renamed: riders follow their category.
        for (const r of Object.values(state.riders)) {
          if (categoryKey(r.category, r.subCategory) === oldKey) {
            r.category = c.name;
            touch(r);
          }
        }
      }
      for (const r of ridersOfCategory(state, c)) {
        if ("heat" in changes && r.heat !== c.heat) {
          r.heat = c.heat;
          touch(r);
        }
        if ("laps" in changes || "linkGroup" in changes || "ignored" in changes) ch.rederive.add(r.uuid);
      }
      return { applied: true, changes: ch };
    }

    case "CategoryDeleted": {
      const c = state.categories[action.payload.categoryUuid];
      if (!c) return notApplied("invalid");
      if (ridersOfCategory(state, c).length > 0) return notApplied("locked");
      delete state.categories[c.uuid];
      ch.removedCategories.push(c.uuid);
      return { applied: true, changes: ch };
    }

    case "RiderAdded": {
      const n = action.payload.rider;
      if (state.riders[n.uuid] || bibTaken(state, n.bibNumber)) return notApplied("invalid");
      state.riders[n.uuid] = newRider(state, n, atMs);
      ch.riders.add(n.uuid);
      ch.rederive.add(n.uuid);
      return { applied: true, changes: ch };
    }

    case "RidersImported": {
      const { riders, categories } = action.payload;
      const bibs = riders.map((r) => r.bibNumber).filter((b) => b != null);
      if (new Set(bibs).size !== bibs.length || riders.some((r) => state.riders[r.uuid] || bibTaken(state, r.bibNumber))) return notApplied("invalid");
      for (const n of categories) {
        // Only categories that don't exist yet; existing ones are never rebuilt.
        if (Object.values(state.categories).some((c) => categoryKey(c.name, c.subCategory) === categoryKey(n.name, n.subCategory ?? null))) continue;
        state.categories[n.uuid] = {
          uuid: n.uuid, raceUuid: state.race.uuid, name: n.name, subCategory: n.subCategory ?? null, laps: n.laps ?? null,
          startTime: n.startTime ?? null, isConnected: false, color: n.color ?? null, heat: n.heat ?? null, status: "upcoming",
          linkedFinish: null, linkGroup: n.linkGroup ?? null, ignored: false, bibColor: n.bibColor ?? null, bibTextColor: n.bibTextColor ?? null,
          startedAt: null, finishedAt: null, importOrder: n.importOrder ?? null,
        };
        ch.categories.add(n.uuid);
      }
      for (const n of riders) {
        state.riders[n.uuid] = newRider(state, n, atMs);
        ch.riders.add(n.uuid);
        ch.rederive.add(n.uuid);
      }
      return { applied: true, changes: ch };
    }

    case "RiderEdited": {
      const r = rider(p.riderUuid);
      if (!r) return notApplied("invalid");
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(action.payload.changes)) {
        if (!(RIDER_IDENTITY_FIELDS as readonly string[]).includes(k)) return notApplied("invalid"); // derived fields are never edited
        changes[k] = v;
      }
      if ("bibNumber" in changes && bibTaken(state, changes.bibNumber as number | null, r.uuid)) return notApplied("invalid");
      const moving = "category" in changes || "subCategory" in changes;
      if (moving && r.lapsCounter > 0) return notApplied("locked");
      Object.assign(r, changes);
      if (moving) {
        const c = categoryOfRider(state, r);
        if (c) r.heat = c.heat;
      }
      touch(r);
      ch.rederive.add(r.uuid);
      return { applied: true, changes: ch };
    }

    case "RiderDeleted": {
      const r = rider(p.riderUuid);
      if (!r) return notApplied("invalid");
      if (r.lapsCounter > 0) return notApplied("locked"); // riders with laps get a status instead
      delete state.riders[r.uuid];
      ch.removedRiders.push(r.uuid);
      return { applied: true, changes: ch };
    }

    case "RiderCheckedIn": {
      const r = rider(p.riderUuid);
      if (!r) return notApplied("invalid");
      r.checked = action.payload.checked;
      touch(r);
      return { applied: true, changes: ch };
    }

    case "CommentSet": {
      const r = rider(p.riderUuid);
      if (!r) return notApplied("invalid");
      r.comment = action.payload.comment;
      touch(r);
      return { applied: true, changes: ch };
    }

    case "RaceEdited": {
      for (const k of Object.keys(action.payload.changes)) {
        if (!(RACE_INFO_FIELDS as readonly string[]).includes(k)) return notApplied("invalid");
      }
      Object.assign(state.race, action.payload.changes);
      state.race.lastUpdateAt = nowIso(atMs);
      ch.race = true;
      return { applied: true, changes: ch };
    }

    case "SettingChanged": {
      const c = action.payload.changes;
      for (const k of Object.keys(c)) if (k !== "leaderFinishAll" && k !== "autoColor" && k !== "minLapSeconds") return notApplied("invalid");
      if (c.minLapSeconds !== undefined && !(Number.isInteger(c.minLapSeconds) && c.minLapSeconds >= 0 && c.minLapSeconds <= 3600)) return notApplied("invalid");
      if (c.leaderFinishAll !== undefined) state.race.leaderFinishAll = c.leaderFinishAll;
      if (c.autoColor !== undefined) state.race.autoColor = c.autoColor;
      if (c.minLapSeconds !== undefined) state.race.minLapSeconds = c.minLapSeconds;
      ch.race = true;
      if (c.leaderFinishAll !== undefined || c.minLapSeconds !== undefined) {
        for (const r of Object.values(state.riders)) if (r.raceStatus !== "upcoming") ch.rederive.add(r.uuid);
      }
      return { applied: true, changes: ch };
    }

    case "MemberChanged":
    case "Finalized":
    case "Amended":
      // Handled by the Server's membership and official-results services.
      return { applied: true, changes: ch };
  }
}

function newRider(state: RaceState, n: import("./actions").NewRider, atMs: number): SharedRider {
  const iso = nowIso(atMs);
  const r: SharedRider = {
    uuid: n.uuid, raceUuid: state.race.uuid, bibNumber: n.bibNumber ?? null, category: n.category, subCategory: n.subCategory ?? null,
    checked: false, firstName: n.firstName ?? "", middleName: n.middleName ?? null, lastName: n.lastName ?? "", flag: n.flag ?? null,
    team: n.team ?? null, standing: n.standing ?? null, heat: n.heat ?? null, status: "standing", comment: n.comment ?? null,
    image: n.image ?? null, chipNumber: n.chipNumber ?? null, points: n.points ?? null, uciPoints: n.uciPoints ?? null,
    federation: n.federation ?? null, uciNumber: n.uciNumber ?? null, bibColor: n.bibColor ?? null, bibTextColor: n.bibTextColor ?? null, viewOrder: 0, raceStatus: "upcoming", timeStartRace: null,
    timeArrive: null, lapsCounter: 0, lapsDetails: [], totalLaps: 0, elapsedLastLap: null, elapsedTimeFromStart: null,
    distance: null, position_start: null, position_category: 0, position_race: 0, color: null, createdAt: iso, updatedAt: iso,
  };
  const c = categoryOfRider(state, r);
  if (c) {
    r.heat = c.heat;
    r.color = c.color;
    // A rider added to a wave that already started starts with it.
    if (c.status !== "upcoming" && c.startedAt !== null) r.timeStartRace = localClock(new Date(c.startedAt).toISOString());
  }
  return r;
}

/** Riders sharing a bell/finish group with this rider (for re-derivation after a finish change). */
export function groupRiders(state: RaceState, riderUuid: RiderUuid): RiderUuid[] {
  const r = state.riders[riderUuid];
  const c = r && categoryOfRider(state, r);
  if (!c) return [];
  const key = groupKey(c);
  return Object.values(state.categories)
    .filter((cat) => groupKey(cat) === key)
    .flatMap((cat) => ridersOfCategory(state, cat).map((x) => x.uuid))
    .filter((u) => u !== riderUuid);
}

/** The wave an Action concerns (stored as race_events.heat), or null for the whole race. */
export function actionHeat(state: RaceState, action: RaceAction): number | null {
  const p = action.payload as Record<string, unknown>;
  if (typeof p.riderUuid === "string") {
    const r = state.riders[p.riderUuid];
    return r ? (categoryOfRider(state, r)?.heat ?? r.heat ?? null) : null;
  }
  if (typeof p.categoryUuid === "string") return state.categories[p.categoryUuid]?.heat ?? null;
  if (typeof p.heat === "number") return p.heat;
  if (action.type === "CategoryAdded") return action.payload.category.heat ?? null;
  if (action.type === "RiderAdded") return action.payload.rider.heat ?? null;
  return null;
}
