import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import useRaceStore from "@/stores/racesStore";
import type { RaceProps, CategoryProps, RiderProps } from "@/types/types";

export const DEMO_RACE_UUID = "demo-race-99001";

const _now   = new Date();
const _dd    = String(_now.getDate()).padStart(2, "0");
const _mm    = String(_now.getMonth() + 1).padStart(2, "0");
const _yyyy  = String(_now.getFullYear());
const TODAY     = `${_dd}/${_mm}/${_yyyy}`;
const ISO_TODAY = `${_yyyy}-${_mm}-${_dd}`;

const RACE: RaceProps = {
  id: 99001,
  uuid: DEMO_RACE_UUID,
  raceId: `${ISO_TODAY}-demo-race`,
  owner: "demo",
  name: "Demo Race",
  location: "Yarkon Park / פארק הירקון, Tel Aviv",
  time: "08:00",
  date: TODAY,
  image: "",
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
  map: "https://maps.google.com/maps?q=32.1057,34.8099&z=15&output=embed",
  distance: 5,
  isPrivate: false,
};

// ─── Category name constants ────────────────────────────────────────────────
// Each Masters category shares a parent name; sub-categories hold the age group.
// Elite has no sub-category (single group).
const C_EM  = "Elite Men / עילית גברים";
const C_EW  = "Elite Women / עילית נשים";
const C_MM  = "Masters Men / מאסטרס גברים";
const C_MW  = "Masters Women / מאסטרס נשים";

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
  { id: 99001, raceUuid: DEMO_RACE_UUID, name: C_EM, subCategory: null,   laps: 7, lapsCounter: 0, riders: 5, startTime: "08:00", isConnected: false, color: "#e74c3c", heat: 1, status: "upcoming", linkedFinish: false },
  // Wave 1 — 08:15
  { id: 99002, raceUuid: DEMO_RACE_UUID, name: C_EW, subCategory: null,   laps: 6, lapsCounter: 0, riders: 5, startTime: "08:15", isConnected: false, color: "#9b59b6", heat: 1, status: "upcoming", linkedFinish: false },
  // Wave 1 — 08:30
  { id: 99003, raceUuid: DEMO_RACE_UUID, name: C_MM, subCategory: "19-29", laps: 5, lapsCounter: 0, riders: 5, startTime: "08:30", isConnected: false, color: "#2980b9", heat: 1, status: "upcoming", linkedFinish: false },
  { id: 99004, raceUuid: DEMO_RACE_UUID, name: C_MW, subCategory: "19-29", laps: 5, lapsCounter: 0, riders: 5, startTime: "08:30", isConnected: false, color: "#e91e63", heat: 1, status: "upcoming", linkedFinish: false },
  // Wave 2 — 09:00
  { id: 99005, raceUuid: DEMO_RACE_UUID, name: C_MM, subCategory: "30-49", laps: 5, lapsCounter: 0, riders: 5, startTime: "09:00", isConnected: false, color: "#27ae60", heat: 2, status: "upcoming", linkedFinish: false },
  { id: 99006, raceUuid: DEMO_RACE_UUID, name: C_MW, subCategory: "30-49", laps: 5, lapsCounter: 0, riders: 5, startTime: "09:00", isConnected: false, color: "#f39c12", heat: 2, status: "upcoming", linkedFinish: false },
  // Wave 2 — 09:15
  { id: 99007, raceUuid: DEMO_RACE_UUID, name: C_MM, subCategory: "50+",  laps: 4, lapsCounter: 0, riders: 5, startTime: "09:15", isConnected: false, color: "#00bcd4", heat: 2, status: "upcoming", linkedFinish: false },
  // Wave 2 — 09:30
  { id: 99008, raceUuid: DEMO_RACE_UUID, name: C_MW, subCategory: "50+",  laps: 4, lapsCounter: 0, riders: 5, startTime: "09:30", isConnected: false, color: "#795548", heat: 2, status: "upcoming", linkedFinish: false },
];

// ─── Teams ───────────────────────────────────────────────────────────────────
const TN = "Team North / קבוצת הצפון";
const TC = "Carmel Cycling / רוכבי כרמל";
const GL = "Galgalim TLV / גלגלים ת\"א";
const NR = "Negev Riders / נגב רייסינג";
const MX = "MaxBikes / מאקס ביקס";
const CP = "CyclePro / סייקל פרו";
const BR = "Beta Racing / ביטא רייסינג";
const PS = "PeakSport / פיק ספורט";

function mk(
  id: number, bib: number, first: string, last: string,
  cat: string, sub: string | null, team: string,
  heat: number, color: string, laps: number, ord: number,
): RiderProps {
  return {
    id, bibNumber: bib, firstName: first, lastName: last, middleName: null,
    category: cat, subCategory: sub, team, heat, color, totalLaps: laps,
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

const RIDERS: RiderProps[] = [
  // ── Wave 1 · 08:00 · Elite Men — bibs 1–5 (1-digit) ────────────────────
  mk(99001,  1, "יואב",    "כהן",        C_EM, null,   TN, 1, "#e74c3c", 7, 1),
  mk(99002,  2, "Alex",    "Levy",        C_EM, null,   BR, 1, "#e74c3c", 7, 2),
  mk(99003,  3, "אייל",   "מזרחי",      C_EM, null,   CP, 1, "#e74c3c", 7, 3),
  mk(99004,  4, "Tom",     "Ben-David",   C_EM, null,   NR, 1, "#e74c3c", 7, 4),
  mk(99005,  5, "גבריאל", "פרידמן",     C_EM, null,   MX, 1, "#e74c3c", 7, 5),

  // ── Wave 1 · 08:15 · Elite Women — bibs 51–55 ──────────────────────────
  mk(99006, 51, "Maya",    "Shapiro",     C_EW, null,   TN, 1, "#9b59b6", 6, 1),
  mk(99007, 52, "נועה",   "לוי",        C_EW, null,   GL, 1, "#9b59b6", 6, 2),
  mk(99008, 53, "Rachel",  "Bergman",     C_EW, null,   CP, 1, "#9b59b6", 6, 3),
  mk(99009, 54, "יעל",    "גולד",       C_EW, null,   PS, 1, "#9b59b6", 6, 4),
  mk(99010, 55, "Sara",    "Klein",       C_EW, null,   BR, 1, "#9b59b6", 6, 5),

  // ── Wave 1 · 08:30 · Masters Men 19-29 — bibs 11–15 ────────────────────
  mk(99011, 11, "עידו",   "שפירו",      C_MM, "19-29", TC, 1, "#2980b9", 5, 1),
  mk(99012, 12, "David",   "Rosenberg",   C_MM, "19-29", MX, 1, "#2980b9", 5, 2),
  mk(99013, 13, "יגאל",   "כץ",         C_MM, "19-29", PS, 1, "#2980b9", 5, 3),
  mk(99014, 14, "Michael", "Greenberg",   C_MM, "19-29", GL, 1, "#2980b9", 5, 4),
  mk(99015, 15, "אמיר",   "חדד",        C_MM, "19-29", NR, 1, "#2980b9", 5, 5),

  // ── Wave 1 · 08:30 · Masters Women 19-29 — bibs 61–65 ──────────────────
  mk(99016, 61, "שירה",   "גרינברג",    C_MW, "19-29", TC, 1, "#e91e63", 5, 1),
  mk(99017, 62, "Dana",    "Rozen",       C_MW, "19-29", MX, 1, "#e91e63", 5, 2),
  mk(99018, 63, "אביטל",  "שוורץ",     C_MW, "19-29", PS, 1, "#e91e63", 5, 3),
  mk(99019, 64, "Gali",    "Katz",        C_MW, "19-29", GL, 1, "#e91e63", 5, 4),
  mk(99020, 65, "מיכל",   "פרץ",        C_MW, "19-29", BR, 1, "#e91e63", 5, 5),

  // ── Wave 2 · 09:00 · Masters Men 30-49 — bibs 21–25 ────────────────────
  mk(99021, 21, "קובי",   "גרינברג",    C_MM, "30-49", BR, 2, "#27ae60", 5, 1),
  mk(99022, 22, "Roni",    "Schwartz",    C_MM, "30-49", CP, 2, "#27ae60", 5, 2),
  mk(99023, 23, "ברק",    "כהן",        C_MM, "30-49", TN, 2, "#27ae60", 5, 3),
  mk(99024, 24, "Itay",    "Bar-Lev",     C_MM, "30-49", TC, 2, "#27ae60", 5, 4),
  mk(99025, 25, "ולרי",   "זלמנוב",     C_MM, "30-49", MX, 2, "#27ae60", 5, 5),

  // ── Wave 2 · 09:00 · Masters Women 30-49 — bibs 71–75 ──────────────────
  mk(99026, 71, "ענבר",   "בן-דוד",     C_MW, "30-49", TN, 2, "#f39c12", 5, 1),
  mk(99027, 72, "Keren",   "Cohen",       C_MW, "30-49", BR, 2, "#f39c12", 5, 2),
  mk(99028, 73, "רוני",   "לוי",        C_MW, "30-49", CP, 2, "#f39c12", 5, 3),
  mk(99029, 74, "Sivan",   "Mizrahi",     C_MW, "30-49", TC, 2, "#f39c12", 5, 4),
  mk(99030, 75, "נטע",    "ביטון",      C_MW, "30-49", MX, 2, "#f39c12", 5, 5),

  // ── Wave 2 · 09:15 · Masters Men 50+ — bibs 31–35 ──────────────────────
  mk(99031, 31, "Moshe",   "Shapiro",     C_MM, "50+",  NR, 2, "#00bcd4", 4, 1),
  mk(99032, 32, "יעקב",   "ברגמן",      C_MM, "50+",  MX, 2, "#00bcd4", 4, 2),
  mk(99033, 33, "Abraham", "Gold",        C_MM, "50+",  PS, 2, "#00bcd4", 4, 3),
  mk(99034, 34, "שמעון",  "פרידמן",     C_MM, "50+",  GL, 2, "#00bcd4", 4, 4),
  mk(99035, 35, "Yitzhak", "Ben-Simon",   C_MM, "50+",  TC, 2, "#00bcd4", 4, 5),

  // ── Wave 2 · 09:30 · Masters Women 50+ — bibs 101–105 (3-digit) ─────────
  mk(99036, 101, "מרים",  "כהן",        C_MW, "50+",  TN, 2, "#795548", 4, 1),
  mk(99037, 102, "Ruth",   "Levi",        C_MW, "50+",  BR, 2, "#795548", 4, 2),
  mk(99038, 103, "פנינה", "מזרחי",      C_MW, "50+",  CP, 2, "#795548", 4, 3),
  mk(99039, 104, "Helen",  "Goldstein",   C_MW, "50+",  GL, 2, "#795548", 4, 4),
  mk(99040, 105, "חנה",   "שפירו",      C_MW, "50+",  PS, 2, "#795548", 4, 5),
];

// Idempotent — safe to call multiple times; skips silently if demo already loaded.
export async function seedDemoRace(): Promise<void> {
  try {
    const db = await initIndexedDB();
    const allRaces = await db.getAll("races");
    if ((allRaces as RaceProps[]).some((r) => r.uuid === DEMO_RACE_UUID)) {
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
