import { describe, expect, it } from "vitest";
import { computeFinalRiders } from "../finalizeRace";
import { makeCategory, makeRider } from "@/test/factories";

/** Finish Race locally: same rule as the modal and the server (shared/race/finalPlan.ts). */
const RACE = "race-1";
const NOW = new Date("2026-10-27T12:00:00Z");

describe("computeFinalRiders", () => {
  it("on course → FINISHED on completed laps (never DNF); never started → DNS; DNF/DSQ/DNS kept", () => {
    const cats = [
      makeCategory({ raceUuid: RACE, name: "Elite", heat: 1, status: "running" }),
      makeCategory({ raceUuid: RACE, name: "Kids", heat: 2, status: "upcoming" }),
    ];
    const riders = [
      makeRider({ id: 1, raceUuid: RACE, category: "Elite", raceStatus: "running", timeStartRace: "10:00:00", lapsCounter: 2 }),
      makeRider({ id: 2, raceUuid: RACE, category: "Elite", raceStatus: "running", status: "DNF", timeStartRace: "10:00:00" }),
      makeRider({ id: 3, raceUuid: RACE, category: "Elite", raceStatus: "finished", timeStartRace: "10:00:00", lapsCounter: 3 }),
      makeRider({ id: 4, raceUuid: RACE, category: "Kids", raceStatus: "upcoming" }),
      makeRider({ id: 5, raceUuid: RACE, category: "Kids", raceStatus: "upcoming", status: "DSQ" }),
    ];
    const out = computeFinalRiders(riders, NOW, cats);
    const by = (id: number) => out.find((r) => r.id === id)!;
    expect(by(1)).toMatchObject({ status: "finished", raceStatus: "finished", lapsCounter: 2 });
    expect(by(2).status).toBe("DNF");
    expect(by(3)).toMatchObject({ status: "finished", lapsCounter: 3 });
    expect(by(4).status).toBe("DNS");
    expect(by(5).status).toBe("DSQ");
    expect(out.every((r) => r.raceStatus === "finished")).toBe(true);
  });
});
