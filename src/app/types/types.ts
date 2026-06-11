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




export interface RaceProps {
  id: number;
  uuid: string;
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
  distance: number;
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
  laps: number | null;
  lapsCounter: number | 0;
  riders: number | null;
  startTime: string | null;
  isConnected: boolean | null;
  color: string | null;
  heat: number | null;
  status?: "finished" | "running" | "upcoming";
}

export interface RiderProps {
  bibNumber: number;
  category: string;
  checked: boolean;
  distance: number | null;
  elapsedLastLap: string | null;      // Duration of last lap
  elapsedTimeFromStart: string | null; // Total time since start
  timeStartRace: string | null;
  timeArrive: string | null;      // Timestamp of last lap end
  firstName: string;
  flag: string | null;
  id: number;
  lapsCounter: number | 0;
  lapsDetails: Array<{ lap: number; startTime: Date; endTime: Date; lapTime: string }>;
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
  image: string | StaticImageData | null;
  comment: string | null;
  chipNumber?: string;
}