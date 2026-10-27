import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));
vi.mock("@/services/analytics/analyticsClient", () => ({ logAnalyticsEvent: vi.fn() }));

import { autoMapColumns } from "@/services/csvMapper";
import { saveRidersFromRows } from "../insertRidersCsv";
import { previewStartListRows } from "../startListPreview";
import { saveRace } from "../saveRace";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";

/**
 * Start-list import with real Hebrew headers (synthetic riders): every category
 * is created and every rider belongs to one — with or without a wave column.
 * "מקצה" is the race class (category), never a wave; only an explicit wave
 * column ("גל זינוק") is a wave; "צבע" is not a wave.
 */
const CATS = ["עילית גברים", "עילית נשים", "בוגרים רמה 2 17-29", "בוגרות רמה 2 17-29", "ג'וניורס בנים", "ג'וניורס בנות"];
const TIMES = ["08:20", "08:21", "09:20", "09:20", "10:00", "10:01"];

// File A: the headers of a real start list (no wave column).
const fileA = (): string[][] => [
  ["שעה", "דירוג", "דירוג UCI", "מספר חזה", "שם פרטי", "שם משפחה", "מקצה תחרות", "שם אגודה"],
  ...CATS.flatMap((c, i) => [0, 1].map((j) => [TIMES[i], String(j + 1), "", String(100 + i * 10 + j), `Rider${i}${j}`, "Test", c, "Club"])),
];
// File B: category + race class + Hebrew start time + an explicit wave column.
const fileB = (): string[][] => [
  ["מספר רוכב", "שם פרטי", "שם משפחה", "קטגוריה", "מקצה", "שעת זינוק", "גל זינוק"],
  ...CATS.flatMap((c, i) => [0, 1].map((j) => [String(200 + i * 10 + j), `Rider${i}${j}`, "Test", c, "XCO", TIMES[i], String(Math.floor(i / 2) + 1)])),
];
// File C: a colour column must not become waves.
const fileC = (): string[][] => [
  ["מספר רוכב", "שם פרטי", "שם משפחה", "קטגוריה", "שעה", "צבע"],
  ...CATS.map((c, i) => [String(300 + i), `Rider${i}`, "Test", c, TIMES[i], i % 2 ? "אדום" : "כחול"]),
];

const fieldOf = async (rows: string[][]) => {
  const m = await autoMapColumns(rows[0]);
  return Object.fromEntries(rows[0].map((h, i) => [h, m[i]?.targetField ?? null]));
};

beforeEach(() => {
  useCategoryStore.setState({ categories: [] });
  useRiderStore.setState({ riders: [] });
  useRaceStore.setState({ races: [] });
});

describe("column mapping with real Hebrew headers", () => {
  it("file without a wave column: מקצה תחרות → Category, שעה → Start time, no Wave, UCI ranking is not the UCI ID", async () => {
    const f = await fieldOf(fileA());
    expect(f["מקצה תחרות"]).toBe("category");
    expect(f["שעה"]).toBe("startTime");
    expect(Object.values(f)).not.toContain("heat");
    expect(f["דירוג UCI"]).not.toBe("uciNumber");
  });

  it("קטגוריה wins Category over מקצה; שעת זינוק → Start time; only גל זינוק → Wave", async () => {
    const f = await fieldOf(fileB());
    expect(f["קטגוריה"]).toBe("category");
    expect(f["מקצה"]).not.toBe("heat");
    expect(f["מקצה"]).not.toBe("category");
    expect(f["שעת זינוק"]).toBe("startTime");
    expect(f["גל זינוק"]).toBe("heat");
  });

  it("a colour column is not a wave", async () => {
    const f = await fieldOf(fileC());
    expect(f["צבע"]).not.toBe("heat");
  });
});

describe("import creates every category, waves or not", () => {
  const importAndCreate = async (rows: string[][], race: string) => {
    await saveRidersFromRows(rows, race);
    await useCategoryStore.getState().createCategoriesFromRiders(race);
    return {
      cats: useCategoryStore.getState().categories.filter((c) => c.raceUuid === race),
      riders: useRiderStore.getState().riders.filter((r) => r.raceUuid === race),
    };
  };

  it("without wave numbers: all 6 categories, every rider in one", async () => {
    const { cats, riders } = await importAndCreate(fileA(), "race-A");
    expect(cats.map((c) => c.name).sort()).toEqual([...CATS].sort());
    expect(riders).toHaveLength(12);
    expect(riders.every((r) => cats.some((c) => c.name === r.category))).toBe(true);
  });

  it("with explicit wave numbers: all 6 categories, waves from the file", async () => {
    const { cats } = await importAndCreate(fileB(), "race-B");
    expect(cats.map((c) => c.name).sort()).toEqual([...CATS].sort());
    expect(Object.fromEntries(cats.map((c) => [c.name, c.heat]))).toEqual({
      "עילית גברים": 1, "עילית נשים": 1, "בוגרים רמה 2 17-29": 2, "בוגרות רמה 2 17-29": 2, "ג'וניורס בנים": 3, "ג'וניורס בנות": 3,
    });
  });

  it("the preview shows the detected mapping and the categories; no Category column is a clear error", async () => {
    const p = await previewStartListRows(fileA());
    expect(p.categories).toHaveLength(6);
    expect(p.mapping.find((m) => m.header === "מקצה תחרות")?.field).toBe("category");
    const noCategory = [["מספר רוכב", "שם פרטי", "שם משפחה"], ["1", "A", "B"]];
    await expect(previewStartListRows(noCategory)).rejects.toThrow(/No column was recognised as Category/);
  });
});

describe("Create Race never keeps a race without categories", () => {
  it("a start list from which no category can be created fails clearly and the new race is rolled back", async () => {
    const csv = "מספר רוכב,שם פרטי,שם משפחה\n1,A,B\n2,C,D\n";
    const file = new File([csv], "no-category.csv", { type: "text/csv" });
    await expect(
      saveRace({ preventDefault() {} } as never, "Test race", "2026-10-27", "Here", "upcoming", null, file, () => {})
    ).rejects.toThrow();
    expect(useRaceStore.getState().races.filter((r) => r.name === "Test race")).toHaveLength(0);
    expect(useRiderStore.getState().riders.filter((r) => r.firstName === "A")).toHaveLength(0);
  });

  it("a normal start list creates the race with all its categories", async () => {
    const csv = fileA().map((r) => r.join(",")).join("\n");
    const file = new File([csv], "start.csv", { type: "text/csv" });
    await saveRace({ preventDefault() {} } as never, "Good race", "2026-10-27", "Here", "upcoming", null, file, () => {});
    const race = useRaceStore.getState().races.find((r) => r.name === "Good race")!;
    expect(useCategoryStore.getState().categories.filter((c) => c.raceUuid === race.uuid)).toHaveLength(6);
  });
});
