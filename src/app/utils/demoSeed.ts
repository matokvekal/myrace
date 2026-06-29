import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import useRaceStore from "@/stores/racesStore";
import type { RaceProps, CategoryProps, RiderProps } from "@/types/types";

export const DEMO_RACE_UUID = "demo-race-99001";

const _now = new Date();
const _dd = String(_now.getDate()).padStart(2, "0");
const _mm = String(_now.getMonth() + 1).padStart(2, "0");
const _yyyy = String(_now.getFullYear());
const TODAY = `${_dd}/${_mm}/${_yyyy}`;
const ISO_TODAY = `${_yyyy}-${_mm}-${_dd}`;

const RACE: RaceProps = {
  id: 99001,
  uuid: DEMO_RACE_UUID,
  raceId: `${ISO_TODAY}-demo-race`,
  owner: "demo",
  name: "מרוץ הדגמה | Demo Race",
  location: "פארק הירקון | Yarkon Park, Tel Aviv",
  time: "08:00",
  date: TODAY,
  image: "",
  heat: "1",
  status: "upcoming",
  type: "MTB",
  level: "All",
  orgenizer: "Demo Org",
  manager: "Demo Manager",
  phone: "050-0000000",
  takanon: "",
  site: "",
  createdAt: _now,
  lastUpdateAt: _now,
  isActive: true,
  isFavorite: false,
  map: "",
  distance: 5,
  isPrivate: false,
};

// 8 categories — 2 waves × 2 start slots × 2 categories per slot
// Wave 1: 08:00 + 08:10  |  Wave 2: 09:00 + 09:10
const CATEGORIES: CategoryProps[] = [
  { id: 99001, raceUuid: DEMO_RACE_UUID, name: "עילית גברים | Elite Men",       laps: 7, lapsCounter: 0, riders: 4, startTime: "08:00", isConnected: false, color: "#e74c3c", heat: 1, status: "upcoming", linkedFinish: false },
  { id: 99002, raceUuid: DEMO_RACE_UUID, name: "מאסטרס א' | Masters Men A",     laps: 5, lapsCounter: 0, riders: 4, startTime: "08:00", isConnected: false, color: "#2980b9", heat: 1, status: "upcoming", linkedFinish: false },
  { id: 99003, raceUuid: DEMO_RACE_UUID, name: "מאסטרס ב' | Masters Men B",     laps: 5, lapsCounter: 0, riders: 4, startTime: "08:10", isConnected: false, color: "#27ae60", heat: 1, status: "upcoming", linkedFinish: false },
  { id: 99004, raceUuid: DEMO_RACE_UUID, name: "ג'וניור גברים | Junior Men",    laps: 6, lapsCounter: 0, riders: 4, startTime: "08:10", isConnected: false, color: "#f39c12", heat: 1, status: "upcoming", linkedFinish: false },
  { id: 99005, raceUuid: DEMO_RACE_UUID, name: "עילית נשים | Elite Women",      laps: 6, lapsCounter: 0, riders: 4, startTime: "09:00", isConnected: false, color: "#9b59b6", heat: 2, status: "upcoming", linkedFinish: false },
  { id: 99006, raceUuid: DEMO_RACE_UUID, name: "מאסטרס נשים | Masters Women",  laps: 5, lapsCounter: 0, riders: 4, startTime: "09:00", isConnected: false, color: "#e91e63", heat: 2, status: "upcoming", linkedFinish: false },
  { id: 99007, raceUuid: DEMO_RACE_UUID, name: "ג'וניור נשים | Junior Women",  laps: 4, lapsCounter: 0, riders: 4, startTime: "09:10", isConnected: false, color: "#00bcd4", heat: 2, status: "upcoming", linkedFinish: false },
  { id: 99008, raceUuid: DEMO_RACE_UUID, name: "ותיקים | Veterans",            laps: 4, lapsCounter: 0, riders: 4, startTime: "09:10", isConnected: false, color: "#795548", heat: 2, status: "upcoming", linkedFinish: false },
];

function mk(
  id: number, bib: number, first: string, last: string,
  cat: string, team: string, heat: number, color: string, laps: number, ord: number,
): RiderProps {
  return {
    id, bibNumber: bib, firstName: first, lastName: last, middleName: null,
    category: cat, subCategory: null, team, heat, color, totalLaps: laps,
    raceUuid: DEMO_RACE_UUID, raceStatus: "upcoming", status: "standing",
    lapsCounter: 0, lapsDetails: [],
    timeStartRace: null, timeArrive: null,
    elapsedLastLap: null, elapsedTimeFromStart: null,
    checked: false, distance: null, flag: null,
    position_start: ord, position_category: 0, position_race: 0,
    viewOrder: ord, image: null, comment: null,
    points: null, federation: null,
  };
}

// Teams — bilingual, 8 clubs covering real Israeli cycling scene vibe
const TN  = "Team North / קבוצת הצפון";
const TC  = "Team Carmel / קבוצת הכרמל";
const GL  = "Galgalim TLV / גלגלים ת\"א";
const NR  = "Negev Riders / רוכבי הנגב";
const MX  = "Max Bikes / מאקס ביקס";
const CP  = "Cycle Pro / סייקל פרו";
const BR  = "Beta Racing / ביטא רייסינג";
const PS  = "Peak Sport / פיק ספורט";

const RIDERS: RiderProps[] = [
  // ─── Wave 1 ────────────────────────────────────────────────────────────────
  // עילית גברים | Elite Men — bibs 1–4, 7 laps
  mk(99001, 1,  "יואב",  "כהן",      "עילית גברים | Elite Men",      TN, 1, "#e74c3c", 7, 1),
  mk(99002, 2,  "ניר",   "לוי",      "עילית גברים | Elite Men",      BR, 1, "#e74c3c", 7, 2),
  mk(99003, 3,  "אייל",  "מזרחי",    "עילית גברים | Elite Men",      CP, 1, "#e74c3c", 7, 3),
  mk(99004, 4,  "טל",    "בן-דוד",   "עילית גברים | Elite Men",      NR, 1, "#e74c3c", 7, 4),
  // מאסטרס א' | Masters Men A — bibs 11–14, 5 laps
  mk(99005, 11, "עידו",  "שפירו",    "מאסטרס א' | Masters Men A",    TC, 1, "#2980b9", 5, 1),
  mk(99006, 12, "גיא",   "ברגמן",    "מאסטרס א' | Masters Men A",    MX, 1, "#2980b9", 5, 2),
  mk(99007, 13, "רון",   "גולדשטיין","מאסטרס א' | Masters Men A",    PS, 1, "#2980b9", 5, 3),
  mk(99008, 14, "עמית",  "פרידמן",   "מאסטרס א' | Masters Men A",    GL, 1, "#2980b9", 5, 4),
  // מאסטרס ב' | Masters Men B — bibs 21–24, 5 laps
  mk(99009, 21, "קובי",  "גרינברג",  "מאסטרס ב' | Masters Men B",    BR, 1, "#27ae60", 5, 1),
  mk(99010, 22, "ברק",   "רוזנברג",  "מאסטרס ב' | Masters Men B",    CP, 1, "#27ae60", 5, 2),
  mk(99011, 23, "רועי",  "שוורץ",    "מאסטרס ב' | Masters Men B",    TN, 1, "#27ae60", 5, 3),
  mk(99012, 24, "יובל",  "כץ",       "מאסטרס ב' | Masters Men B",    TC, 1, "#27ae60", 5, 4),
  // ג'וניור גברים | Junior Men — bibs 31–34, 6 laps
  mk(99013, 31, "נדב",   "בן-דוד",   "ג'וניור גברים | Junior Men",   NR, 1, "#f39c12", 6, 1),
  mk(99014, 32, "ליאור", "כהן",      "ג'וניור גברים | Junior Men",   MX, 1, "#f39c12", 6, 2),
  mk(99015, 33, "אורן",  "לוי",      "ג'וניור גברים | Junior Men",   PS, 1, "#f39c12", 6, 3),
  mk(99016, 34, "דן",    "מזרחי",    "ג'וניור גברים | Junior Men",   GL, 1, "#f39c12", 6, 4),
  // ─── Wave 2 ────────────────────────────────────────────────────────────────
  // עילית נשים | Elite Women — bibs 51–54, 6 laps
  mk(99017, 51, "מאיה",  "שפירו",    "עילית נשים | Elite Women",     TN, 2, "#9b59b6", 6, 1),
  mk(99018, 52, "נועה",  "ברגמן",    "עילית נשים | Elite Women",     BR, 2, "#9b59b6", 6, 2),
  mk(99019, 53, "יעל",   "גולדשטיין","עילית נשים | Elite Women",     CP, 2, "#9b59b6", 6, 3),
  mk(99020, 54, "תמר",   "פרידמן",   "עילית נשים | Elite Women",     NR, 2, "#9b59b6", 6, 4),
  // מאסטרס נשים | Masters Women — bibs 61–64, 5 laps
  mk(99021, 61, "שירה",  "גרינברג",  "מאסטרס נשים | Masters Women",  TC, 2, "#e91e63", 5, 1),
  mk(99022, 62, "דנה",   "רוזנברג",  "מאסטרס נשים | Masters Women",  MX, 2, "#e91e63", 5, 2),
  mk(99023, 63, "אביטל", "שוורץ",    "מאסטרס נשים | Masters Women",  PS, 2, "#e91e63", 5, 3),
  mk(99024, 64, "גלי",   "כץ",       "מאסטרס נשים | Masters Women",  GL, 2, "#e91e63", 5, 4),
  // ג'וניור נשים | Junior Women — bibs 71–74, 4 laps
  mk(99025, 71, "ענבר",  "בן-דוד",   "ג'וניור נשים | Junior Women",  TN, 2, "#00bcd4", 4, 1),
  mk(99026, 72, "קרן",   "כהן",      "ג'וניור נשים | Junior Women",  BR, 2, "#00bcd4", 4, 2),
  mk(99027, 73, "רוני",  "לוי",      "ג'וניור נשים | Junior Women",  CP, 2, "#00bcd4", 4, 3),
  mk(99028, 74, "סיוון", "מזרחי",    "ג'וניור נשים | Junior Women",  TC, 2, "#00bcd4", 4, 4),
  // ותיקים | Veterans — bibs 81–84, 4 laps
  mk(99029, 81, "משה",   "שפירו",    "ותיקים | Veterans",            NR, 2, "#795548", 4, 1),
  mk(99030, 82, "יעקב",  "ברגמן",    "ותיקים | Veterans",            MX, 2, "#795548", 4, 2),
  mk(99031, 83, "אברהם", "גולדשטיין","ותיקים | Veterans",            PS, 2, "#795548", 4, 3),
  mk(99032, 84, "שמעון", "פרידמן",   "ותיקים | Veterans",            GL, 2, "#795548", 4, 4),
];

// Idempotent — safe to call multiple times; skips if demo already loaded.
export async function seedDemoRace(): Promise<string> {
  const db = await initIndexedDB();
  const allRaces = await db.getAll("races");
  if ((allRaces as RaceProps[]).some((r) => r.uuid === DEMO_RACE_UUID)) {
    db.close();
    return DEMO_RACE_UUID;
  }

  const catTx = db.transaction("categories", "readwrite");
  for (const cat of CATEGORIES) await catTx.store.put(cat);
  await catTx.done;

  const riderTx = db.transaction("riders", "readwrite");
  for (const rider of RIDERS) await riderTx.store.put(rider);
  await riderTx.done;

  db.close();

  // insertRace handles both IDB write and Zustand state update
  await useRaceStore.getState().insertRace(RACE);

  return DEMO_RACE_UUID;
}
