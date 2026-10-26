/**
 * Per-race access: who may see and change what (PRD FR-10/FR-11, AD-10, AD-20).
 *
 * Three independent dimensions, all per race:
 *  - Roles (`race_members.roles`): owner (the race's `ownerUserId`), admin,
 *    start, counter, checkin, viewer. Several per member; they give defaults.
 *  - Screen permissions: view / create / update / delete per screen. The owner
 *    or an admin may override the role defaults per member.
 *  - Data scope: which waves (and, for counters, which categories) the member
 *    may see and act on.
 * Overrides and scope are stored in `race_members.permissions` (JSONB) as
 * `MemberPermissions`. The owner always has full access; it cannot be overridden.
 *
 * The Server enforces all of this on every request, Action and broadcast; the
 * app uses the same functions only to hide controls. Pure TypeScript.
 */
import type { RaceAction } from "./actions";
import { MEMBER_ROLES, type MemberRole } from "./roles";
import {
  RACE_OPERATION_SETTINGS,
  type CategoryUuid,
  type RaceState,
  type SharedCategory,
  type SharedRace,
  type SharedRider,
} from "./state";

/** The race's screens, named after the app's tabs and screens. */
export const SCREENS = [
  "info", // race info, Finish Race
  "map", // course maps
  "schedule", // start times, waves
  "categories", // categories, laps, colours
  "riders", // rider list and details
  "results", // results and corrections
  "start", // Race → Grid: start / finish waves
  "checkin", // Race → Check-In
  "board", // Race → Board, standings
  "status", // Race → Status
  "live", // live lap screen: laps, undo, finish, DNF/DSQ, Jokers
  "team", // members, invitations, audit history
  "settings", // race settings
] as const;
export type Screen = (typeof SCREENS)[number];

export const OPERATIONS = ["view", "create", "update", "delete"] as const;
export type Operation = (typeof OPERATIONS)[number];
export type WriteOperation = Exclude<Operation, "view">;

export type ScreenAccess = Record<Operation, boolean>;
export type ScreenAccessOverride = Partial<ScreenAccess>;

/** Stored in `race_members.permissions` and `invitations.permissions`. */
export interface MemberPermissions {
  /** Per-screen overrides of the role defaults; unset operations keep the default. */
  screens?: Partial<Record<Screen, ScreenAccessOverride>>;
  /** Waves (heat numbers) the member may see and act on; unset = all waves. */
  waves?: number[];
  /** Categories a member may act on and see (FR-11); unset = all categories. */
  categories?: CategoryUuid[];
}

export interface EffectiveAccess {
  isOwner: boolean;
  screens: Record<Screen, ScreenAccess>;
  /** null = every wave. */
  waves: number[] | null;
  /** null = every category. */
  categories: CategoryUuid[] | null;
}

const NONE: ScreenAccess = { view: false, create: false, update: false, delete: false };
const VIEW: ScreenAccess = { view: true, create: false, update: false, delete: false };
const FULL: ScreenAccess = { view: true, create: true, update: true, delete: true };
const ALL_SCREENS_EXCEPT_TEAM = SCREENS.filter((s) => s !== "team");

const screensWith = (base: ScreenAccess, list: readonly Screen[]): Partial<Record<Screen, ScreenAccess>> =>
  Object.fromEntries(list.map((s) => [s, base]));

/**
 * Role defaults (FR-10). Everyone sees the live race, boards and results; each
 * commissaire role adds write access to its own screens.
 */
export const ROLE_DEFAULTS: Readonly<Record<MemberRole, Partial<Record<Screen, ScreenAccess>>>> = {
  admin: screensWith(FULL, SCREENS),
  start: {
    ...screensWith(VIEW, ALL_SCREENS_EXCEPT_TEAM),
    start: { view: true, create: false, update: true, delete: false },
    schedule: { view: true, create: false, update: true, delete: false },
  },
  counter: {
    ...screensWith(VIEW, ALL_SCREENS_EXCEPT_TEAM),
    live: FULL,
  },
  checkin: {
    ...screensWith(VIEW, ALL_SCREENS_EXCEPT_TEAM),
    checkin: { view: true, create: false, update: true, delete: false },
    riders: { view: true, create: true, update: true, delete: false },
  },
  viewer: screensWith(VIEW, ["live", "board", "status", "results", "map", "info"]),
};

export interface MemberAccessInput {
  isOwner: boolean;
  roles: readonly MemberRole[];
  permissions?: MemberPermissions | null;
}

/** A member's effective access: role defaults, then overrides, then scope. */
export function effectiveAccess({ isOwner, roles, permissions }: MemberAccessInput): EffectiveAccess {
  if (isOwner) {
    return { isOwner: true, screens: Object.fromEntries(SCREENS.map((s) => [s, { ...FULL }])) as Record<Screen, ScreenAccess>, waves: null, categories: null };
  }
  const screens = Object.fromEntries(SCREENS.map((s) => [s, { ...NONE }])) as Record<Screen, ScreenAccess>;
  for (const role of roles) {
    for (const [screen, access] of Object.entries(ROLE_DEFAULTS[role] ?? {}) as [Screen, ScreenAccess][]) {
      for (const op of OPERATIONS) screens[screen][op] ||= access[op];
    }
  }
  for (const [screen, override] of Object.entries(permissions?.screens ?? {}) as [Screen, ScreenAccessOverride][]) {
    if (!screens[screen]) continue;
    for (const op of OPERATIONS) if (typeof override[op] === "boolean") screens[screen][op] = override[op]!;
  }
  // No write without view: a screen you cannot see cannot be changed.
  for (const screen of SCREENS) if (!screens[screen].view) screens[screen] = { ...NONE };
  return {
    isOwner: false,
    screens,
    waves: permissions?.waves ? [...permissions.waves] : null,
    categories: permissions?.categories ? [...permissions.categories] : null,
  };
}

/** Full read-only access to every screen (no writes), scoped to `waves` when given. */
export const readOnlyPermissions = (waves?: number[]): MemberPermissions => ({
  screens: Object.fromEntries(SCREENS.map((s) => [s, { view: true, create: false, update: false, delete: false }])),
  ...(waves ? { waves } : {}),
});

/** Checks a stored permissions object. Returns an error message, or null when valid. */
export function validatePermissions(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "permissions must be an object";
  const p = value as Record<string, unknown>;
  for (const key of Object.keys(p)) if (!["screens", "waves", "categories"].includes(key)) return `unknown key "${key}"`;
  if (p.screens !== undefined) {
    if (p.screens === null || typeof p.screens !== "object" || Array.isArray(p.screens)) return "screens must be an object";
    for (const [screen, ops] of Object.entries(p.screens as Record<string, unknown>)) {
      if (!(SCREENS as readonly string[]).includes(screen)) return `unknown screen "${screen}"`;
      if (ops === null || typeof ops !== "object" || Array.isArray(ops)) return `screen "${screen}" must be an object`;
      for (const [op, v] of Object.entries(ops as Record<string, unknown>)) {
        if (!(OPERATIONS as readonly string[]).includes(op)) return `unknown operation "${op}" on "${screen}"`;
        if (typeof v !== "boolean") return `"${screen}.${op}" must be true or false`;
      }
    }
  }
  if (p.waves !== undefined) {
    if (!Array.isArray(p.waves) || p.waves.length === 0) return "waves must be a non-empty list (leave it out for all waves)";
    if (!p.waves.every((w) => Number.isInteger(w) && (w as number) >= 0)) return "waves must be wave numbers";
    if (new Set(p.waves).size !== p.waves.length) return "waves must not repeat";
  }
  if (p.categories !== undefined) {
    if (!Array.isArray(p.categories) || p.categories.length === 0) return "categories must be a non-empty list (leave it out for all categories)";
    if (!p.categories.every((c) => typeof c === "string" && c.length > 0)) return "categories must be category ids";
  }
  return null;
}

/** Normalizes a roles list: known member roles only, no duplicates. */
export const validateRoles = (value: unknown): string | null =>
  !Array.isArray(value)
    ? "roles must be a list"
    : value.every((r) => (MEMBER_ROLES as readonly string[]).includes(r as string)) && new Set(value).size === value.length
      ? null
      : `roles must be some of ${MEMBER_ROLES.join(", ")}`;

export const can = (access: EffectiveAccess, screen: Screen, op: Operation): boolean => access.screens[screen][op];

// ---------------------------------------------------------------------------
// Data scope

const categoryKey = (name: string, sub: string | null | undefined): string => `${name}::${sub ?? ""}`;

/** The category a rider belongs to (name::subCategory match, as in the app). */
export const riderCategory = (state: RaceState, rider: Pick<SharedRider, "category" | "subCategory">): SharedCategory | undefined =>
  Object.values(state.categories).find((c) => categoryKey(c.name, c.subCategory) === categoryKey(rider.category, rider.subCategory));

/** A rider's wave: their category's heat, else their own. */
export const riderWave = (state: RaceState, rider: SharedRider): number | null => riderCategory(state, rider)?.heat ?? rider.heat ?? null;

export const waveInScope = (access: EffectiveAccess, wave: number | null): boolean =>
  access.waves === null || (wave !== null && access.waves.includes(wave));

export const categoryInScope = (access: EffectiveAccess, category: SharedCategory | undefined): boolean =>
  !!category &&
  waveInScope(access, category.heat) &&
  (access.categories === null || access.categories.includes(category.uuid));

export const riderInScope = (access: EffectiveAccess, state: RaceState, rider: SharedRider): boolean => {
  if (access.waves === null && access.categories === null) return true;
  const category = riderCategory(state, rider);
  if (access.categories !== null && (!category || !access.categories.includes(category.uuid))) return false;
  return waveInScope(access, category?.heat ?? rider.heat ?? null);
};

// ---------------------------------------------------------------------------
// Reading: what a member may receive (API responses, snapshots, socket events)

/** Screens that show riders' names and bibs. */
const RIDER_LIST_SCREENS: readonly Screen[] = ["riders", "results", "start", "checkin", "board", "status", "live", "schedule", "categories"];
/** Screens that show laps, times, positions and status. */
const RESULT_SCREENS: readonly Screen[] = ["results", "board", "status", "live", "start"];
/** Screens that show private participant details. */
const DETAIL_SCREENS: readonly Screen[] = ["riders", "checkin"];

const anyView = (access: EffectiveAccess, screens: readonly Screen[]): boolean => screens.some((s) => access.screens[s].view);

const RIDER_PUBLIC_FIELDS = [
  "uuid", "raceUuid", "bibNumber", "category", "subCategory", "firstName", "middleName", "lastName",
  "flag", "team", "heat", "viewOrder", "color", "createdAt", "updatedAt",
] as const satisfies readonly (keyof SharedRider)[];
const RIDER_RESULT_FIELDS = [
  "status", "raceStatus", "timeStartRace", "timeArrive", "lapsCounter", "lapsDetails", "totalLaps",
  "elapsedLastLap", "elapsedTimeFromStart", "distance", "position_start", "position_category", "position_race",
] as const satisfies readonly (keyof SharedRider)[];
const RIDER_DETAIL_FIELDS = [
  "checked", "standing", "comment", "image", "chipNumber", "points", "uciPoints", "federation", "uciNumber",
] as const satisfies readonly (keyof SharedRider)[];

/** The part of a rider this member may receive, or null if the rider is hidden. */
export function projectRider(access: EffectiveAccess, state: RaceState, rider: SharedRider): Partial<SharedRider> | null {
  if (!anyView(access, RIDER_LIST_SCREENS) || !riderInScope(access, state, rider)) return null;
  const out: Partial<SharedRider> = {};
  const copy = (fields: readonly (keyof SharedRider)[]) => {
    for (const f of fields) (out as Record<string, unknown>)[f] = rider[f];
  };
  copy(RIDER_PUBLIC_FIELDS);
  if (anyView(access, RESULT_SCREENS)) copy(RIDER_RESULT_FIELDS);
  if (anyView(access, DETAIL_SCREENS)) copy(RIDER_DETAIL_FIELDS);
  return out;
}

export const projectCategory = (access: EffectiveAccess, category: SharedCategory): SharedCategory | null =>
  categoryInScope(access, category) ? category : null;

const RACE_BASIC_FIELDS = [
  "uuid", "raceId", "name", "date", "location", "raceType", "status", "isActive", "lastSeq", "createdAt", "lastUpdateAt",
  "autoColor", "leaderFinishAll",
] as const satisfies readonly (keyof SharedRace)[];
const RACE_INFO_DETAIL_FIELDS = [
  "owner", "time", "image", "heat", "type", "level", "orgenizer", "manager", "phone", "takanon", "site", "distance",
] as const satisfies readonly (keyof SharedRace)[];
const RACE_MAP_FIELDS = ["map", "mapCenter", "mapZoom", "trackPoints", "mapMarkers", "tracks"] as const satisfies readonly (keyof SharedRace)[];

/** The part of the race record this member may receive. */
export function projectRace(access: EffectiveAccess, race: SharedRace): Partial<SharedRace> {
  const out: Partial<SharedRace> = {};
  const copy = (fields: readonly (keyof SharedRace)[]) => {
    for (const f of fields) (out as Record<string, unknown>)[f] = race[f];
  };
  copy(RACE_BASIC_FIELDS);
  if (access.screens.info.view) copy(RACE_INFO_DETAIL_FIELDS);
  if (access.screens.map.view) copy(RACE_MAP_FIELDS);
  if (access.screens.team.view) {
    out.ownerUserId = race.ownerUserId;
    out.joinCode = race.joinCode;
  }
  if (race.waveColors) {
    out.waveColors = Object.fromEntries(Object.entries(race.waveColors).filter(([w]) => waveInScope(access, Number(w))));
  } else {
    out.waveColors = null;
  }
  return out;
}

/** Everything this member may receive of a race state (snapshots, catch-up). */
export function projectState(access: EffectiveAccess, state: RaceState): {
  race: Partial<SharedRace>;
  categories: SharedCategory[];
  riders: Partial<SharedRider>[];
} {
  return {
    race: projectRace(access, state.race),
    categories: Object.values(state.categories).filter((c) => projectCategory(access, c) !== null),
    riders: Object.values(state.riders)
      .map((r) => projectRider(access, state, r))
      .filter((r): r is Partial<SharedRider> => r !== null),
  };
}

// ---------------------------------------------------------------------------
// Writing: may this member send this Action?

export type AuthResult = { ok: true } | { ok: false; reason: "forbidden" | "out_of_scope" | "invalid" };
const OK: AuthResult = { ok: true };
const forbidden: AuthResult = { ok: false, reason: "forbidden" };
const outOfScope: AuthResult = { ok: false, reason: "out_of_scope" };
const invalid: AuthResult = { ok: false, reason: "invalid" };

type Need = [Screen, WriteOperation];
const anyOf = (access: EffectiveAccess, needs: Need[]): boolean => needs.some(([s, op]) => access.screens[s][op]);

const SCHEDULE_FIELDS = new Set(["startTime", "heat"]);
const MAP_FIELDS = new Set<string>(RACE_MAP_FIELDS);
const OPERATION_SETTINGS = new Set<string>(RACE_OPERATION_SETTINGS);

/** Wave not yet started: the rider's category is still upcoming. */
const preStart = (state: RaceState, rider: SharedRider): boolean => {
  const category = riderCategory(state, rider);
  return (category?.status ?? "upcoming") === "upcoming" && rider.raceStatus === "upcoming";
};

/**
 * Whether a member may send an Action, checked against the Server's current
 * state (never against what the Device claims). The specific operation is
 * checked, not only whether the screen is visible.
 */
export function authorizeAction(access: EffectiveAccess, action: RaceAction, state: RaceState, targets?: Record<string, RaceAction>): AuthResult {
  if (action.raceUuid !== state.race.uuid) return invalid;
  const rider = (uuid: string) => state.riders[uuid];
  const onRider = (uuid: string, needs: Need[]): AuthResult => {
    const r = rider(uuid);
    if (!r) return invalid;
    if (!anyOf(access, needs)) return forbidden;
    return riderInScope(access, state, r) ? OK : outOfScope;
  };
  const onCategory = (uuid: string, needs: Need[]): AuthResult => {
    const c = state.categories[uuid];
    if (!c) return invalid;
    if (!anyOf(access, needs)) return forbidden;
    return categoryInScope(access, c) ? OK : outOfScope;
  };
  const onWave = (heat: number, needs: Need[]): AuthResult => {
    if (!anyOf(access, needs)) return forbidden;
    return waveInScope(access, heat) ? OK : outOfScope;
  };
  const newRidersInScope = (riders: { heat: number | null; category: string; subCategory: string | null }[]) =>
    riders.every((r) => {
      const category = riderCategory(state, r);
      if (access.categories !== null && (!category || !access.categories.includes(category.uuid))) return false;
      return waveInScope(access, category?.heat ?? r.heat);
    });

  switch (action.type) {
    case "AddLap":
      return onRider(action.payload.riderUuid, [["live", "create"]]);
    case "RiderFinished":
      return onRider(action.payload.riderUuid, [["live", "update"]]);
    case "Undo": {
      const target = targets?.[action.payload.targetActionId];
      // A missing or non-undoable target is a recorded no-op for the reducer, but
      // the sender still needs lap-delete permission.
      if (!target || !("riderUuid" in target.payload)) return anyOf(access, [["live", "delete"]]) ? OK : forbidden;
      return onRider((target.payload as { riderUuid: string }).riderUuid, [["live", "delete"]]);
    }
    case "LapCountCorrection":
      return onRider(action.payload.riderUuid, [["live", "update"], ["results", "update"]]);
    case "StatusCorrection": {
      const r = rider(action.payload.riderUuid);
      if (!r) return invalid;
      const preStartStatus = (action.payload.status === "DNS" || action.payload.status === "standing") && preStart(state, r);
      const needs: Need[] = preStartStatus
        ? [["checkin", "update"], ["live", "update"], ["results", "update"]]
        : [["live", "update"], ["results", "update"]];
      return onRider(r.uuid, needs);
    }
    case "WaveStarted":
    case "WaveFinished":
      return onWave(action.payload.heat, [["start", "update"]]);
    case "CategoryFinished":
      return onCategory(action.payload.categoryUuid, [["start", "update"]]);
    case "CategoryAdded":
      if (!anyOf(access, [["categories", "create"]])) return forbidden;
      return waveInScope(access, action.payload.category.heat) && access.categories === null ? OK : outOfScope;
    case "CategoryEdited": {
      const fields = Object.keys(action.payload.changes);
      const scheduleOnly = fields.length > 0 && fields.every((f) => SCHEDULE_FIELDS.has(f));
      const res = onCategory(action.payload.categoryUuid, scheduleOnly ? [["schedule", "update"], ["categories", "update"]] : [["categories", "update"]]);
      if (!res.ok) return res;
      const newHeat = action.payload.changes.heat;
      return newHeat === undefined || waveInScope(access, newHeat) ? OK : outOfScope;
    }
    case "CategoryDeleted":
      return onCategory(action.payload.categoryUuid, [["categories", "delete"]]);
    case "RiderAdded":
      if (!anyOf(access, [["riders", "create"]])) return forbidden;
      return newRidersInScope([action.payload.rider]) ? OK : outOfScope;
    case "RiderEdited": {
      const res = onRider(action.payload.riderUuid, [["riders", "update"]]);
      if (!res.ok) return res;
      const r = rider(action.payload.riderUuid)!;
      const moved = { ...r, ...action.payload.changes };
      return newRidersInScope([moved]) ? OK : outOfScope;
    }
    case "RiderDeleted":
      return onRider(action.payload.riderUuid, [["riders", "delete"]]);
    case "RidersImported":
      // Bulk import may add categories too, so it needs both (FR-10 matrix: owner/admin).
      if (!access.screens.riders.create || !access.screens.categories.create) return forbidden;
      return newRidersInScope(action.payload.riders) && action.payload.categories.every((c) => waveInScope(access, c.heat))
        ? OK
        : outOfScope;
    case "RiderCheckedIn":
      return onRider(action.payload.riderUuid, [["checkin", "update"]]);
    case "CommentSet":
      return onRider(action.payload.riderUuid, [["live", "update"], ["checkin", "update"], ["riders", "update"]]);
    case "RaceEdited": {
      const fields = Object.keys(action.payload.changes);
      const mapOnly = fields.length > 0 && fields.every((f) => MAP_FIELDS.has(f));
      return anyOf(access, mapOnly ? [["map", "update"], ["info", "update"]] : [["info", "update"]]) ? OK : forbidden;
    }
    case "SettingChanged": {
      const fields = Object.keys(action.payload.changes);
      const operationOnly = fields.length > 0 && fields.every((f) => OPERATION_SETTINGS.has(f));
      return anyOf(access, operationOnly ? [["settings", "update"], ["start", "update"]] : [["settings", "update"]]) ? OK : forbidden;
    }
    case "MemberChanged":
      if (!access.screens.team.update) return forbidden;
      // The owner's access is protected: nobody changes it through membership.
      return action.payload.userId === state.race.ownerUserId ? forbidden : OK;
    case "Finalized":
    case "Amended":
      return access.isOwner ? OK : forbidden;
  }
}
