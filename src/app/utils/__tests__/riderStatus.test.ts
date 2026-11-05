import { describe, it, expect } from "vitest";
import { withStatus } from "../riderStatus";
import { makeRider } from "@/test/factories";

/** Story 1.6 / BUG-05 — status toggles keep raceStatus consistent and never touch laps. */
describe("withStatus", () => {
  const upcoming = makeRider({ id: 1, raceStatus: "upcoming", lapsCounter: 0, timeStartRace: null, totalLaps: 5 });
  const running = makeRider({ id: 2, raceStatus: "running", lapsCounter: 2, timeStartRace: "08:00:00", totalLaps: 5 });
  const done = makeRider({ id: 3, raceStatus: "finished", status: "finished", lapsCounter: 5, timeStartRace: "08:00:00", totalLaps: 5 });

  it("an out-status on a started rider takes them off the course", () => {
    for (const s of ["DNF", "DSQ", "DNS"] as const) {
      expect(withStatus(running, s)).toMatchObject({ status: s, raceStatus: "finished", lapsCounter: 2 });
    }
  });

  it("an out-status before the start keeps the rider upcoming", () => {
    expect(withStatus(upcoming, "DNS")).toMatchObject({ status: "DNS", raceStatus: "upcoming" });
  });

  it("clearing puts a started rider back on course and keeps a never-started one upcoming", () => {
    expect(withStatus({ ...running, status: "DNF", raceStatus: "finished" }, "standing")).toMatchObject({
      status: "standing", raceStatus: "running", lapsCounter: 2,
    });
    expect(withStatus({ ...upcoming, status: "DNS" }, "standing")).toMatchObject({ status: "standing", raceStatus: "upcoming" });
  });

  it("clearing a rider who had completed every lap keeps them finished", () => {
    expect(withStatus({ ...done, status: "DSQ" }, "standing")).toMatchObject({ raceStatus: "finished", lapsCounter: 5 });
  });

  it("never changes laps or times", () => {
    const out = withStatus(running, "DSQ");
    expect(out.lapsDetails).toBe(running.lapsDetails);
    expect(out.timeArrive).toBe(running.timeArrive);
  });
});
