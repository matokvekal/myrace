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

// ─── Demo course: Albstadt Bike-Arena — Bullentäle, Germany ──────────────────
// Real UCI MTB XCO World Cup / 2020 World Championships venue on the Swabian Alb
// (Albstadt-Tailfingen). These are REAL trail coordinates pulled from
// OpenStreetMap — a gap-free closed loop stitched from three connected mapped
// singletrack ways at the arena (OSM ways 244277022 → 1426660403 → 1413261296).
// [lat, lng] pairs.
const DEMO_MAP_CENTER = { lat: 48.2461, lng: 9.0181 };
const DEMO_MAP_ZOOM = 17;
const DEMO_TRACK_POINTS: [number, number][] = [
  [48.2454910, 9.0182560], // start / finish (arena junction)
  [48.2456462, 9.0181433],
  [48.2458423, 9.0180471],
  [48.2460605, 9.0178924],
  [48.2463591, 9.0176997],
  [48.2464924, 9.0176185],
  [48.2466340, 9.0176224],
  [48.2466996, 9.0177177], // top of climb
  [48.2466821, 9.0177982],
  [48.2466137, 9.0179056],
  [48.2465391, 9.0179803],
  [48.2464364, 9.0180597],
  [48.2463463, 9.0181251],
  [48.2462498, 9.0181905],
  [48.2461597, 9.0182512],
  [48.2460664, 9.0183072],
  [48.2459948, 9.0183586],
  [48.2459140, 9.0184193],
  [48.2458331, 9.0184847],
  [48.2457740, 9.0185361],
  [48.2456960, 9.0186037], // technical descent
  [48.2456879, 9.0184868],
  [48.2456784, 9.0184228],
  [48.2456480, 9.0183862],
  [48.2455891, 9.0183517],
  [48.2455410, 9.0183059],
  [48.2454910, 9.0182560], // back to start / finish
];
const DEMO_MAP_MARKERS = [
  { lat: 48.2454910, lng: 9.0182560, label: "Start / Finish", type: "start" as const },
  { lat: 48.2466996, lng: 9.0177177, label: "Feed Zone", type: "feed" as const },
  { lat: 48.2456960, lng: 9.0186037, label: "Technical Descent", type: "point" as const },
];

const RACE: RaceProps = {
  id: 99001,
  uuid: DEMO_RACE_UUID,
  raceId: `${ISO_TODAY}-demo-race`,
  owner: "demo",
  name: "Demo Race",
  location: "Albstadt Bike-Arena (Bullentäle), Germany",
  time: "08:00",
  date: TODAY,
  image: "images/2.jpg",
  heat: "2",
  status: "upcoming",
  type: "MTB",
  level: "All",
  orgenizer: "Israeli Cycling Federation",
  manager: "Demo Manager",
  phone: "050-0000000",
  takanon: "",
  site: "",
  createdAt: _now,
  lastUpdateAt: _now,
  isActive: true,
  isFavorite: false,
  map: "https://maps.google.com/maps?q=48.2461,9.0181&z=17&output=embed",
  mapCenter: DEMO_MAP_CENTER,
  mapZoom: DEMO_MAP_ZOOM,
  trackPoints: DEMO_TRACK_POINTS,
  mapMarkers: DEMO_MAP_MARKERS,
  distance: 5,
  isPrivate: false,
};

// ─── Category name constants ────────────────────────────────────────────────
// Each Masters category shares a parent name; sub-categories hold the age group.
// Elite has no sub-category (single group).
const C_EM = "Elite Men ";
const C_EW = "Elite Women ";
const C_MM = "Masters Men ";
const C_MW = "Masters Women ";

// ─── Schedule: 2 waves × 3 starts ──────────────────────────────────────────
//
//  Wave 1:
//    08:00 → Elite Men  (solo)
//    08:15 → Elite Women  (solo)
//    08:30 → Masters Men 19-29 + Masters Women 19-29
//
//  Wave 2:
//    09:00 → Masters Men 30-49 + Masters Women 30-49
//    09:15 → Masters Men 50+
//    09:30 → Masters Women 50+
//
const CATEGORIES: CategoryProps[] = [
  // Wave 1 — 08:00
  { id: 99001, raceUuid: DEMO_RACE_UUID, name: C_EM, subCategory: null, laps: 7, lapsCounter: 0, riders: 5, startTime: "08:00", isConnected: false, color: "#e74c3c", heat: 1, status: "upcoming", linkedFinish: false },
  // Wave 1 — 08:15
  { id: 99002, raceUuid: DEMO_RACE_UUID, name: C_EW, subCategory: null, laps: 6, lapsCounter: 0, riders: 5, startTime: "08:15", isConnected: false, color: "#9b59b6", heat: 1, status: "upcoming", linkedFinish: false },
  // Wave 1 — 08:30
  { id: 99003, raceUuid: DEMO_RACE_UUID, name: C_MM, subCategory: "19-29", laps: 5, lapsCounter: 0, riders: 5, startTime: "08:30", isConnected: false, color: "#2980b9", heat: 1, status: "upcoming", linkedFinish: false },
  { id: 99004, raceUuid: DEMO_RACE_UUID, name: C_MW, subCategory: "19-29", laps: 5, lapsCounter: 0, riders: 5, startTime: "08:30", isConnected: false, color: "#e91e63", heat: 1, status: "upcoming", linkedFinish: false },
  // Wave 2 — 09:00
  { id: 99005, raceUuid: DEMO_RACE_UUID, name: C_MM, subCategory: "30-49", laps: 5, lapsCounter: 0, riders: 5, startTime: "09:00", isConnected: false, color: "#27ae60", heat: 2, status: "upcoming", linkedFinish: false },
  { id: 99006, raceUuid: DEMO_RACE_UUID, name: C_MW, subCategory: "30-49", laps: 5, lapsCounter: 0, riders: 5, startTime: "09:00", isConnected: false, color: "#f39c12", heat: 2, status: "upcoming", linkedFinish: false },
  // Wave 2 — 09:15
  { id: 99007, raceUuid: DEMO_RACE_UUID, name: C_MM, subCategory: "50+", laps: 4, lapsCounter: 0, riders: 5, startTime: "09:15", isConnected: false, color: "#00bcd4", heat: 2, status: "upcoming", linkedFinish: false },
  // Wave 2 — 09:30
  { id: 99008, raceUuid: DEMO_RACE_UUID, name: C_MW, subCategory: "50+", laps: 4, lapsCounter: 0, riders: 5, startTime: "09:30", isConnected: false, color: "#795548", heat: 2, status: "upcoming", linkedFinish: false },
];

// ─── Clubs (fictional bicycle clubs, one nationality each) ───────────────────
// US clubs
const US_SUMMIT = "Summit Velo";
const US_IRON = "Iron Peak Cycling";
const US_REDW = "Redwood Racing";
// GB clubs
const GB_ALBION = "Albion Wheelers";
const GB_THAMES = "Thames Velo Club";
const GB_PENN = "Pennine CC";
// IT clubs
const IT_AURORA = "Velo Aurora";
const IT_MARINO = "Ciclismo Marino";

function mk(
  id: number, bib: number, first: string, last: string,
  cat: string, sub: string | null, team: string, flag: string,
  heat: number, color: string, laps: number, ord: number,
): RiderProps {
  return {
    id, bibNumber: bib, firstName: first, lastName: last, middleName: null,
    category: cat, subCategory: sub, team, heat, color, totalLaps: laps,
    raceUuid: DEMO_RACE_UUID, raceStatus: "upcoming", status: "standing",
    lapsCounter: 0, lapsDetails: [],
    timeStartRace: null, timeArrive: null,
    elapsedLastLap: null, elapsedTimeFromStart: null,
    checked: false, distance: null, flag,
    position_start: ord, position_category: 0, position_race: 0,
    viewOrder: ord, image: null, comment: null,
    points: null, federation: null,
  };
}

const RIDERS: RiderProps[] = [
  // ── Wave 1 · 08:00 · Elite Men — bibs 1–5 (1-digit) ────────────────────
  mk(99001, 1, "Tyler", "Brooks", C_EM, null, US_SUMMIT, "us", 1, "#e74c3c", 7, 1),
  mk(99002, 2, "Gareth", "Ashworth", C_EM, null, GB_ALBION, "gb", 1, "#e74c3c", 7, 2),
  mk(99003, 3, "Matteo", "Bellandi", C_EM, null, IT_AURORA, "it", 1, "#e74c3c", 7, 3),
  mk(99004, 4, "Cody", "Sullivan", C_EM, null, US_IRON, "us", 1, "#e74c3c", 7, 4),
  mk(99005, 5, "Alistair", "Pemberton", C_EM, null, GB_THAMES, "gb", 1, "#e74c3c", 7, 5),

  // ── Wave 1 · 08:15 · Elite Women — bibs 51–55 ──────────────────────────
  mk(99006, 51, "Ashley", "Harper", C_EW, null, US_REDW, "us", 1, "#9b59b6", 6, 1),
  mk(99007, 52, "Chiara", "Moretti", C_EW, null, IT_MARINO, "it", 1, "#9b59b6", 6, 2),
  mk(99008, 53, "Imogen", "Wetherby", C_EW, null, GB_PENN, "gb", 1, "#9b59b6", 6, 3),
  mk(99009, 54, "Brittany", "Callahan", C_EW, null, US_SUMMIT, "us", 1, "#9b59b6", 6, 4),
  mk(99010, 55, "Giulia", "Ferraro", C_EW, null, IT_AURORA, "it", 1, "#9b59b6", 6, 5),

  // ── Wave 1 · 08:30 · Masters Men 19-29 — bibs 11–15 ────────────────────
  mk(99011, 11, "Trevor", "Hargreaves", C_MM, "19-29", GB_ALBION, "gb", 1, "#2980b9", 5, 1),
  mk(99012, 12, "Brandon", "Whitaker", C_MM, "19-29", US_IRON, "us", 1, "#2980b9", 5, 2),
  mk(99013, 13, "Lorenzo", "Colombo", C_MM, "19-29", IT_MARINO, "it", 1, "#2980b9", 5, 3),
  mk(99014, 14, "Chase", "Reeves", C_MM, "19-29", US_REDW, "us", 1, "#2980b9", 5, 4),
  mk(99015, 15, "Barnaby", "Whitmore", C_MM, "19-29", GB_THAMES, "gb", 1, "#2980b9", 5, 5),

  // ── Wave 1 · 08:30 · Masters Women 19-29 — bibs 61–65 ──────────────────
  mk(99016, 61, "Fiona", "Barrow", C_MW, "19-29", GB_ALBION, "gb", 1, "#e91e63", 5, 1),
  mk(99017, 62, "Courtney", "Dawson", C_MW, "19-29", US_IRON, "us", 1, "#e91e63", 5, 2),
  mk(99018, 63, "Valentina", "Rizzo", C_MW, "19-29", IT_AURORA, "it", 1, "#e91e63", 5, 3),
  mk(99019, 64, "Paige", "Whitfield", C_MW, "19-29", US_SUMMIT, "us", 1, "#e91e63", 5, 4),
  mk(99020, 65, "Alessia", "Barbieri", C_MW, "19-29", IT_MARINO, "it", 1, "#e91e63", 5, 5),

  // ── Wave 2 · 09:00 · Masters Men 30-49 — bibs 21–25 ────────────────────
  mk(99021, 21, "Travis", "Miller", C_MM, "30-49", US_REDW, "us", 2, "#27ae60", 5, 1),
  mk(99022, 22, "Clive", "Fairbanks", C_MM, "30-49", GB_PENN, "gb", 2, "#27ae60", 5, 2),
  mk(99023, 23, "Alessandro", "Fontana", C_MM, "30-49", IT_AURORA, "it", 2, "#27ae60", 5, 3),
  mk(99024, 24, "Wyatt", "Carver", C_MM, "30-49", US_IRON, "us", 2, "#27ae60", 5, 4),
  mk(99025, 25, "Malcolm", "Cheshire", C_MM, "30-49", GB_THAMES, "gb", 2, "#27ae60", 5, 5),

  // ── Wave 2 · 09:00 · Masters Women 30-49 — bibs 71–75 ──────────────────
  mk(99026, 71, "Francesca", "Gallo", C_MW, "30-49", IT_MARINO, "it", 2, "#f39c12", 5, 1),
  mk(99027, 72, "Chelsea", "Monroe", C_MW, "30-49", US_SUMMIT, "us", 2, "#f39c12", 5, 2),
  mk(99028, 73, "Harriet", "Ashby", C_MW, "30-49", GB_ALBION, "gb", 2, "#f39c12", 5, 3),
  mk(99029, 74, "Serena", "Marchetti", C_MW, "30-49", IT_AURORA, "it", 2, "#f39c12", 5, 4),
  mk(99030, 75, "Bailey", "Hutchins", C_MW, "30-49", US_REDW, "us", 2, "#f39c12", 5, 5),

  // ── Wave 2 · 09:15 · Masters Men 50+ — bibs 31–35 ──────────────────────
  mk(99031, 31, "Nigel", "Ashcroft", C_MM, "50+", GB_PENN, "gb", 2, "#00bcd4", 4, 1),
  mk(99032, 32, "Fabrizio", "Greco", C_MM, "50+", IT_MARINO, "it", 2, "#00bcd4", 4, 2),
  mk(99033, 33, "Dwayne", "Foster", C_MM, "50+", US_IRON, "us", 2, "#00bcd4", 4, 3),
  mk(99034, 34, "Rupert", "Wexley", C_MM, "50+", GB_THAMES, "gb", 2, "#00bcd4", 4, 4),
  mk(99035, 35, "Rocco", "Esposito", C_MM, "50+", IT_AURORA, "it", 2, "#00bcd4", 4, 5),

  // ── Wave 2 · 09:30 · Masters Women 50+ — bibs 101–105 (3-digit) ─────────
  mk(99036, 101, "Meghan", "Sinclair", C_MW, "50+", US_SUMMIT, "us", 2, "#795548", 4, 1),
  mk(99037, 102, "Philippa", "Ellison", C_MW, "50+", GB_ALBION, "gb", 2, "#795548", 4, 2),
  mk(99038, 103, "Bianca", "Lombardi", C_MW, "50+", IT_MARINO, "it", 2, "#795548", 4, 3),
  mk(99039, 104, "Karen", "Prescott", C_MW, "50+", US_REDW, "us", 2, "#795548", 4, 4),
  mk(99040, 105, "Paola", "Vitale", C_MW, "50+", IT_AURORA, "it", 2, "#795548", 4, 5),
];

// Idempotent — safe to call multiple times; skips silently if demo already loaded.
export async function seedDemoRace(): Promise<void> {
  try {
    const db = await initIndexedDB();
    const allRaces = await db.getAll("races");
    const existing = (allRaces as RaceProps[]).find((r) => r.uuid === DEMO_RACE_UUID);
    if (existing) {
      // Backfill / refresh the real Bullentäle course onto demos seeded before
      // the map feature (or with an earlier, incorrect course) existed.
      const stale =
        !existing.trackPoints ||
        existing.trackPoints.length === 0 ||
        !existing.mapCenter ||
        existing.mapCenter.lat !== DEMO_MAP_CENTER.lat ||
        existing.mapCenter.lng !== DEMO_MAP_CENTER.lng;
      if (stale) {
        const patched: RaceProps = {
          ...existing,
          location: RACE.location,
          map: RACE.map,
          mapCenter: DEMO_MAP_CENTER,
          mapZoom: DEMO_MAP_ZOOM,
          trackPoints: DEMO_TRACK_POINTS,
          mapMarkers: DEMO_MAP_MARKERS,
        };
        db.close();
        await useRaceStore.getState().updateRace(patched);
        return;
      }
      db.close();
      return;
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
  } catch (e) {
    console.warn("Demo seed failed (non-fatal):", e);
  }
}
