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
}




export interface TrackMarker {
  lat: number;
  lng: number;
  label: string;
  type?: "start" | "finish" | "feed" | "point";
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
  level: string;
  orgenizer: string;
  manager: string;
  phone: string;
  takanon: string;
  site: string;
  createdAt: Date;
  lastUpdateAt: Date;
  isActive: boolean;
  isFavorite?: boolean;
  map: string;
  // Map / course area
  mapCenter?: { lat: number; lng: number };  // race area center
  mapZoom?: number;                            // preferred zoom for the area
  trackPoints?: [number, number][];            // course polyline: [lat, lng] pairs
  mapMarkers?: TrackMarker[];                   // custom points (start, feed zone, etc.)
  distance: number;
  isPrivate?: boolean;  // If true, requires password to download
  password?: string;    // Password for private races
  syncedAt?: Date;      // Last sync timestamp
  serverVersion?: number;  // Version control for conflict resolution
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
  finishedAt?: number; // epoch ms when race was finished
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
  lapsDetails: Array<{ lap: number; startTime: Date; endTime: Date; lapTime: string; position?: number; speed_kph?: number }>;
  lastName: string;
  position_start: number | null;
  position_category: number;
  position_race: number;
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
  federation?: string | null;
}