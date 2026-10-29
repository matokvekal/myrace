export interface RaceCardProps {
  id: number;
  uuid: string;
  name: string;
  time: string;
  date: string;
  image: string;
  location: string;
  ridersCount: number;
  status?: "finished" | "running" | "upcoming";
  curentHeat: string | null;
  isFavorite?: boolean;
  onToggleFavorite?: (uuid: string) => void;
  /** Downloaded read-only race — enables the light one-tap delete (BUGS.md #8). */
  viewOnly?: boolean;
  /** Race closed with "Finish Race" — shows the locked "Final" badge. */
  finalized?: boolean;
  /** Remove a view-only race straight from the list. */
  onDelete?: (uuid: string) => void;
}




export interface TrackMarker {
  lat: number;
  lng: number;
  label: string;
  type?: "start" | "finish" | "feed" | "point";
}

/**
 * One course map. A race can hold several (e.g. Elite, Kids, Katkatim), each
 * with its own title, route and points. Point ORDER is the direction of travel:
 * first point = start, last = finish.
 */
export interface RaceTrack {
  id: string;
  title: string;
  /** Free-text header/subtitle shown under the title (e.g. "2 laps · 4.2 km"). */
  header?: string;
  color: string;
  points: [number, number][];
  markers: TrackMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  /** Categories that ride this map, as catWaveKey(name, subCategory). Empty/unset = not assigned. */
  categoryKeys?: string[];
  /** Route drawn in the map editor: the tapped points, in order. `points` holds the routed line. */
  waypoints?: TrackWaypoint[];
  /** Routing between waypoints: follow roads (car) or cycling paths/trails (bike). */
  routeMode?: "car" | "bike";
}

/** A tapped route point; a label (Start, Water, …) also shows it on the map. */
export interface TrackWaypoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface RaceProps {
  id: number;
  uuid: string;
  raceId?: string;  // Formatted ID: YYYY-MM-DD-name (e.g., "2026-06-12-mountain-race")
  owner: string;
  name: string;
  location: string;
  time: string;
  date: string;
  image: string;
  heat: string;
  status?: "finished" | "running" | "upcoming";
  type: string;
  /**
   * Discipline picked when the race is created. "MTB" is the default; more
   * disciplines (Gravel, …) are planned. Undefined counts as "MTB" so existing
   * races keep rendering.
   */
  raceType?: "MTB" | "Gravel";
  level: string;
  orgenizer: string;
  manager: string;
  phone: string;
  takanon: string;
  site: string;
  /** Event logo (data URL), shown on the Info page. */
  logo?: string | null;
  /** Organizer / federation logo (data URL), shown on the Info page. */
  federationLogo?: string | null;
  createdAt: Date;
  lastUpdateAt: Date;
  isActive: boolean;
  isFavorite?: boolean;
  /**
   * Auto-assign category colours, keeping starts that overlap on course
   * visually distinct. On by default — undefined counts as true so existing
   * races keep the behaviour. Off means the organizer picks colours by hand.
   */
  autoColor?: boolean;
  /** Minimum seconds between two counted passages of a rider. Unset = 60 (races before this setting); new races get 180. */
  minLapSeconds?: number | null;
  /**
   * Optional colour per wave, keyed by wave number (heat). Independent of the
   * category colours — a wave without an entry simply has no colour of its own.
   */
  waveColors?: Record<string, string>;
  /**
   * "First finish – all finish": when a category's leader takes the bell, every
   * rider in it gets the bell; when the leader finishes, everyone finishes on
   * their next crossing whatever their lap count. On by default — undefined
   * counts as true. Off means each rider rides their own full lap count.
   */
  leaderFinishAll?: boolean;
  map: string;
  // Map / course area
  mapCenter?: { lat: number; lng: number };  // race area center
  mapZoom?: number;                            // preferred zoom for the area
  trackPoints?: [number, number][];            // course polyline: [lat, lng] pairs
  mapMarkers?: TrackMarker[];                   // custom points (start, feed zone, etc.)
  /** Multiple named maps. When set it wins over the single trackPoints/mapMarkers above (legacy). */
  tracks?: RaceTrack[];
  distance: number;
  isPrivate?: boolean;  // If true, requires password to download
  password?: string;    // Password for private races
  /**
   * True for a race pulled in via "Download a Race" — a read-only copy kept just
   * to view someone else's results, not to run. Deleting one is intentionally
   * light (one tap, no heavy confirm) since it's disposable and re-downloadable
   * (BUGS.md #8).
   */
  viewOnly?: boolean;
  /**
   * Set once by "Finish Race" (Info tab). Its presence means the race is
   * FINALIZED: results are computed, and riders/categories/race details are
   * permanently read-only. Enforced in the stores, not just the UI — see
   * `utils/raceLock.ts`. Never clear this by hand; the whole point is that a
   * published result cannot be quietly edited afterwards.
   */
  finalized?: RaceFinalization;
  syncedAt?: Date;      // Last sync timestamp
  serverVersion?: number;  // Version control for conflict resolution
}

/**
 * Tamper-evident record of a race being finalized. `token` is a SHA-256 over
 * `payload`, which folds in who finalized it, when, a nonce and a digest of
 * every rider's final result — so a result sheet can be checked later and any
 * edited placing, lap count or status shows up as a broken signature.
 */
export interface RaceFinalization {
  /** Format tag — bump only on a breaking payload change. */
  version: string;
  algo: "SHA-256";
  /** ISO timestamp of the moment the race was closed. */
  at: string;
  /** Who closed it — logged-in user's email/id, or "anonymous" for a local race. */
  by: string;
  nonce: string;
  /** The exact string that was hashed. Stored so the record verifies standalone. */
  payload: string;
  /** Lowercase hex SHA-256 of `payload`. */
  token: string;
  riderCount: number;
  categoryCount: number;
}


//create interface for category  as  
// /    id: 4,
// name: "נשים בוגרות 19-29",
// laps: 5,
// riders: 40,
// startTime: null,
// isConnected: false,
// color: "#FFC300",
// heat: 2,

export interface CategoryProps {
  id: number;
  /** Shared races only: the category's id on the server (same on every Device). */
  uuid?: string;
  raceUuid: string;
  name: string;
  subCategory?: string | null;  // Optional sub-category (e.g., age groups: "19-29", "30-39")
  laps: number | null;
  lapsCounter: number | 0;
  riders: number | null;
  startTime: string | null;
  isConnected: boolean | null;
  color: string | null;
  heat: number | null;
  status?: "finished" | "running" | "upcoming";
  linkedFinish?: boolean;
  /** Categories sharing a group ring the bell / finish together. Empty = own category (Masters auto-group). */
  linkGroup?: string;
  /** Wave ignored by the organizer: kept, but out of starts, laps, positions and results. */
  ignored?: boolean;
  /** Default bib background / text colour for this category's riders ("#RRGGBB"). */
  bibColor?: string | null;
  bibTextColor?: string | null;
  finishedAt?: number; // epoch ms when race was finished
  /** Position of the category's first rider in the uploaded file (0-based) — the file's schedule order. */
  importOrder?: number;
}

// Template for reusable categories across races
export interface CategoryTemplate {
  id: string;
  name: string;
  subCategories: string[];  // List of sub-categories (empty if not applicable)
  color: string;
  createdAt: Date;
  lastUsed: Date;
}

export interface RiderProps {
  /** Shared races only: the rider's id on the server (same on every Device). */
  uuid?: string;
  bibNumber: number;
  category: string;
  subCategory?: string | null;  // Optional sub-category
  checked: boolean;
  distance: number | null;
  elapsedLastLap: string | null;      // Duration of last lap
  elapsedTimeFromStart: string | null; // Total time since start
  timeStartRace: string | null;
  timeArrive: string | null;      // Timestamp of last lap end
  firstName: string;
  middleName?: string | null;     // Optional middle name
  flag: string | null;
  id: number;
  lapsCounter: number | 0;
  /** `actionId`: shared races only — the AddLap that recorded the lap (Undo targets it). */
  lapsDetails: Array<{ lap: number; startTime: Date; endTime: Date; lapTime: string; position?: number; speed_kph?: number; actionId?: string }>;
  lastName: string;
  position_start: number | null;
  position_category: number;
  position_race: number;
  /** Pre-race ranking/seeding order from the start list. NOT the bib number. */
  standing?: number | null;
  raceStatus: "finished" | "running" | "upcoming";
  status: "standing" | "running" | "finished" | "DNF" | "DSQ" | "DNS";
  raceUuid: string;
  team: string | null;
  viewOrder: number;
  // Time race started
  totalLaps: number;
  heat: number;
  color: string | null;
  image: string | null;
  comment: string | null;
  chipNumber?: string;
  points?: number | null;
  uciPoints?: number | null;
  federation?: string | null;
  uciNumber?: string | null;
  /** Bib colour overrides for this rider (unset = the category's). */
  bibColor?: string | null;
  bibTextColor?: string | null;
  /**
   * Imported columns kept for reference but NOT used by the app (BUGS.md #A).
   * Shown on the full rider card so a commissaire can see things like UCI
   * number, ID, road number, etc. Keyed by a human label. Order preserved.
   */
  extraFields?: Record<string, string>;
}