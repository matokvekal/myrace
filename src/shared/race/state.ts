/**
 * Shared race state — the one shape every Device and the Server reduce Actions
 * into (Architecture AD-4/AD-5/AD-19).
 *
 * The records are the app's own RaceProps / CategoryProps / RiderProps (same
 * field names and meanings) as stored by the Server (`server/sql/002-races.sql`):
 * keyed by `uuid` instead of the device-local numeric `id`, with device-only
 * fields left out and dates as ISO strings.
 *
 * Pure TypeScript: no React, IndexedDB, DOM or Node APIs (enforced by ESLint and
 * `tsconfig.shared.json`). Nothing in the app uses it yet; the reducer arrives in
 * Story 2.3 and the local adapter in 2.5.
 */

export type RaceUuid = string;
export type RiderUuid = string;
export type CategoryUuid = string;
export type ActionId = string;
export type UserId = string;

export type RiderStatus = "standing" | "running" | "finished" | "DNF" | "DSQ" | "DNS";
/** Out-statuses, in the app's display order DNF → DSQ → DNS. */
export const OUT_STATUSES = ["DNF", "DSQ", "DNS"] as const;
export type OutStatus = (typeof OUT_STATUSES)[number];

/** Where a rider, category or race is in the race. */
export type RaceProgress = "upcoming" | "running" | "finished";

/** One completed lap, as in RiderProps.lapsDetails (dates as ISO strings). */
export interface LapDetail {
  lap: number;
  startTime: string;
  endTime: string;
  lapTime: string;
  position?: number;
  speed_kph?: number;
  /** The AddLap Action that recorded this lap (multi-user races). */
  actionId?: ActionId;
}

export interface TrackMarker {
  lat: number;
  lng: number;
  label: string;
  type?: "start" | "finish" | "feed" | "point";
}

export interface RaceTrack {
  id: string;
  title: string;
  header?: string;
  color: string;
  points: [number, number][];
  markers: TrackMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  categoryKeys?: string[];
}

/** RaceProps as stored by the Server. */
export interface SharedRace {
  uuid: RaceUuid;
  ownerUserId: UserId;
  /** Readable "YYYY-MM-DD-name"; not a key. */
  raceId: string | null;
  owner: string;
  name: string;
  location: string;
  time: string;
  date: string;
  image: string;
  heat: string;
  status: RaceProgress | null;
  type: string;
  raceType: "MTB" | "Gravel" | null;
  level: string;
  orgenizer: string;
  manager: string;
  phone: string;
  takanon: string;
  site: string;
  map: string;
  distance: number;
  isActive: boolean;
  /** Race settings: null counts as on, as in the app. */
  autoColor: boolean | null;
  leaderFinishAll: boolean | null;
  waveColors: Record<string, string> | null;
  mapCenter: { lat: number; lng: number } | null;
  mapZoom: number | null;
  trackPoints: [number, number][] | null;
  mapMarkers: TrackMarker[] | null;
  tracks: RaceTrack[] | null;
  joinCode: string | null;
  /** Last applied Race sequence (0 = Publish snapshot). */
  lastSeq: number;
  createdAt: string;
  lastUpdateAt: string;
}

/** CategoryProps as stored by the Server. */
export interface SharedCategory {
  uuid: CategoryUuid;
  raceUuid: RaceUuid;
  /** Flat category name, one per age band. */
  name: string;
  /** Legacy only; new categories always have null. */
  subCategory: string | null;
  /** 0 or null means "not set yet". */
  laps: number | null;
  /** Scheduled start, "HH:MM". Display only. */
  startTime: string | null;
  isConnected: boolean | null;
  color: string | null;
  /** Wave number. */
  heat: number | null;
  status: RaceProgress | null;
  linkedFinish: boolean | null;
  linkGroup: string | null;
  /** Epoch ms when the category was finished. */
  finishedAt: number | null;
  importOrder: number | null;
}

/** RiderProps as stored by the Server. */
export interface SharedRider {
  uuid: RiderUuid;
  raceUuid: RaceUuid;
  /** Plate number. Never the seed order (`standing`). */
  bibNumber: number | null;
  /** Category name; matched with subCategory (`name::subCategory`) as in the app. */
  category: string;
  subCategory: string | null;
  checked: boolean;
  firstName: string;
  middleName: string | null;
  lastName: string;
  flag: string | null;
  team: string | null;
  /** Pre-race seed order. */
  standing: number | null;
  heat: number | null;
  status: RiderStatus;
  comment: string | null;
  image: string | null;
  chipNumber: string | null;
  points: number | null;
  uciPoints: number | null;
  federation: string | null;
  uciNumber: string | null;
  viewOrder: number;
  // Computed by the rules engine from Actions; never sent by a Device (AD-19).
  raceStatus: RaceProgress;
  /** "HH:MM:SS" display copy of the wave start. */
  timeStartRace: string | null;
  timeArrive: string | null;
  lapsCounter: number;
  lapsDetails: LapDetail[];
  totalLaps: number;
  elapsedLastLap: string | null;
  elapsedTimeFromStart: string | null;
  distance: number | null;
  position_start: number | null;
  position_category: number;
  position_race: number;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields a `RiderEdited` Action may change (Story 2.6, AD-19); never derived ones. */
export const RIDER_IDENTITY_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "bibNumber",
  "team",
  "chipNumber",
  "federation",
  "points",
  "category",
  "subCategory",
  "heat",
] as const satisfies readonly (keyof SharedRider)[];
export type RiderIdentityField = (typeof RIDER_IDENTITY_FIELDS)[number];

/**
 * Race settings — one typed view over the race's setting fields, changed only
 * by `SettingChanged` (AD-16). Adding a setting needs product-owner approval.
 */
export interface RaceSettings {
  leaderFinishAll: boolean;
  autoColor: boolean;
}
export const RACE_SETTING_FIELDS = ["leaderFinishAll", "autoColor"] as const satisfies readonly (keyof RaceSettings)[];
/** Settings a Start commissaire may change (race operation, not data collection). */
export const RACE_OPERATION_SETTINGS = ["leaderFinishAll"] as const satisfies readonly (keyof RaceSettings)[];

/** The one accessor for race settings: null/undefined counts as on, as in the app. */
export const raceSettings = (race: Pick<SharedRace, "leaderFinishAll" | "autoColor">): RaceSettings => ({
  leaderFinishAll: race.leaderFinishAll !== false,
  autoColor: race.autoColor !== false,
});

/** Race fields a `RaceEdited` Action may change (info, maps, wave colours). */
export const RACE_INFO_FIELDS = [
  "raceId", "owner", "name", "location", "time", "date", "image", "heat", "type", "raceType", "level",
  "orgenizer", "manager", "phone", "takanon", "site", "map", "distance", "isActive",
  "waveColors", "mapCenter", "mapZoom", "trackPoints", "mapMarkers", "tracks",
] as const satisfies readonly (keyof SharedRace)[];
export type RaceInfoField = (typeof RACE_INFO_FIELDS)[number];

export interface RaceState {
  race: SharedRace;
  categories: Record<CategoryUuid, SharedCategory>;
  riders: Record<RiderUuid, SharedRider>;
}
