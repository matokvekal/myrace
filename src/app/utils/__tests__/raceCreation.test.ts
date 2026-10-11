import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/services/analytics/analyticsClient", () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock("@/services/auditLog/auditLogService", () => ({ AuditLogService: { log: vi.fn() } }));

import { saveRace } from "../saveRace";
import { saveRidersFromCsv } from "../insertRidersCsv";
import useRaceStore from "@/stores/racesStore";
import useRiderStore from "@/stores/ridersStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";

// The importer loads its header dictionaries over HTTP. Serve the REAL files from
// public/data through MSW so the test exercises true header detection offline.
const dataDir = path.resolve(__dirname, "../../../../public/data");
const server = setupServer(
  http.get("*/data/:file", ({ params }) => {
    const file = path.join(dataDir, String(params.file));
    return fs.existsSync(file)
      ? HttpResponse.text(fs.readFileSync(file, "utf8"), { headers: { "Content-Type": "application/json" } })
      : new HttpResponse(null, { status: 404 });
  })
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const submit = (name: string, file: File | null = null, opts: { date?: string; location?: string } = {}) => {
  const setAdd = vi.fn();
  const done = saveRace(
    { preventDefault: vi.fn() } as any,
    name,
    opts.date ?? "2026-06-01",
    opts.location ?? "Park",
    "upcoming",
    null,
    file,
    setAdd
  );
  return { done, setAdd };
};

beforeEach(() => {
  useRaceStore.setState({ races: [] });
  useRiderStore.setState({ riders: [], lastFetchedRaceUuid: "" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("race creation", () => {
  it("creates a race, stores it in memory and IndexedDB, and closes the dialog", async () => {
    const { done, setAdd } = submit("  Spring Classic ");
    await done;

    const [race] = useRaceStore.getState().races;
    expect(race).toMatchObject({ name: "Spring Classic", date: "2026-06-01", location: "Park", status: "upcoming" });
    expect(race.uuid).toBeTruthy();
    expect(setAdd).toHaveBeenCalledWith(false);

    const db = await initIndexedDB();
    expect((await db.getAll("races")).map((r) => r.uuid)).toEqual([race.uuid]);
    db.close();
  });

  it("falls back to sensible defaults for a blank name / location", async () => {
    await submit("   ", null, { location: "  " }).done;
    const [race] = useRaceStore.getState().races;
    expect(race.name).toMatch(/^Race \d+/);
    expect(race.location).toBe("TBD");
  });

  it("gives every new race a unique uuid", async () => {
    await submit("A").done;
    // Race ids are Date.now(): two creations inside one millisecond share an IDB
    // key (impossible for a person, but it made this test flaky on fast CI).
    await new Promise((r) => setTimeout(r, 5));
    await submit("B").done;
    const uuids = useRaceStore.getState().races.map((r) => r.uuid);
    expect(new Set(uuids).size).toBe(2);
  });

  it("a created race survives a reload", async () => {
    await submit("Persisted").done;
    useRaceStore.setState({ races: [] });
    const loaded = await useRaceStore.getState().getRaces();
    expect(loaded.map((r) => r.name)).toEqual(["Persisted"]);
  });

  it("imports riders from a CSV start list with the race", async () => {
    const csv = ["First Name,Last Name,Bib,Category,Standing", "Dana,Levi,345,Men Elite,2", "Noa,Cohen,12,Men Elite,1"].join("\n");
    const file = new File([csv], "riders.csv", { type: "text/csv" });
    await submit("With riders", file).done;

    const [race] = useRaceStore.getState().races;
    const riders = useRiderStore.getState().riders.filter((r) => r.raceUuid === race.uuid);
    expect(riders).toHaveLength(2);
    const dana = riders.find((r) => r.firstName === "Dana")!;
    expect(dana).toMatchObject({ bibNumber: 345, category: "Men Elite", lastName: "Levi" });
    expect(dana.standing).toBe(2); // standing is NOT mixed up with the bib
  });
});

describe("start-list import validation", () => {
  it("rejects an empty file", async () => {
    await expect(saveRidersFromCsv("", "race-x")).rejects.toThrow(/empty|invalid/i);
  });

  it("rejects a file with a header but no riders", async () => {
    await expect(saveRidersFromCsv("First Name,Last Name,Bib", "race-x")).rejects.toThrow();
  });

  it("rejects a file with no recognisable bib / name columns and says what it found", async () => {
    await expect(saveRidersFromCsv("foo,bar\n1,2", "race-x")).rejects.toThrow(/required column/i);
  });

  it("imports columns in any order (matched by header, not position)", async () => {
    const csv = ["Category,Bib,Last Name,First Name", "Masters,88,Katz,Ron"].join("\n");
    await saveRidersFromCsv(csv, "race-order");
    const [r] = useRiderStore.getState().riders.filter((x) => x.raceUuid === "race-order");
    expect(r).toMatchObject({ bibNumber: 88, firstName: "Ron", lastName: "Katz", category: "Masters" });
  });
});
