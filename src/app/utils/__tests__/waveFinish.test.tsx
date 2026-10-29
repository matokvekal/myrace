import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { planWaveFinish, isAdministrativeFinish } from "../waveFinish";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import { makeCategory, makeRider } from "@/test/factories";

/** Finish Wave from Live: same rule as Race → Start; only this wave; nothing invented; idempotent. */
const RACE = "race-1";
const NOW = new Date("2026-10-27T11:00:00Z");

describe("planWaveFinish", () => {
  const setup = () => {
    const w2a = makeCategory({ raceUuid: RACE, name: "Masters Men", heat: 2, status: "running", linkGroup: "1" });
    const w2b = makeCategory({ raceUuid: RACE, name: "Juniors", heat: 2, status: "upcoming" });
    const w3 = makeCategory({ raceUuid: RACE, name: "Masters Women", heat: 3, status: "running", linkGroup: "1" }); // same Finish Group, other wave
    const lap = { lap: 3, startTime: new Date(), endTime: new Date(), lapTime: "10:00" };
    const riders = [
      makeRider({ id: 1, raceUuid: RACE, category: "Masters Men", raceStatus: "finished", lapsCounter: 4, timeArrive: "2026-10-27T10:50:00Z", elapsedTimeFromStart: "50:00" }), // crossed the line
      makeRider({ id: 2, raceUuid: RACE, category: "Masters Men", raceStatus: "running", lapsCounter: 3, timeArrive: "2026-10-27T10:45:00Z", lapsDetails: [lap] }), // still racing
      makeRider({ id: 3, raceUuid: RACE, category: "Masters Men", raceStatus: "running", status: "DNF", lapsCounter: 1 }), // DNF stays DNF
      makeRider({ id: 4, raceUuid: RACE, category: "Masters Women", raceStatus: "running", lapsCounter: 2 }), // other wave
    ];
    return { waveCats: [w2a, w2b], riders };
  };

  it("finishes only this wave; still-racing riders become administrative finishers with laps and times untouched", () => {
    const { waveCats, riders } = setup();
    const plan = planWaveFinish(waveCats, riders, RACE, NOW);
    expect(plan.categories.map((c) => [c.name, c.status, c.finishedAt])).toEqual([
      ["Masters Men", "finished", NOW.getTime()],
      ["Juniors", "finished", NOW.getTime()],
    ]);
    const closed = plan.closedOut.find((r) => r.id === 2)!;
    expect(closed).toMatchObject({ raceStatus: "finished", status: "finished", lapsCounter: 3, timeArrive: "2026-10-27T10:45:00Z" });
    expect(closed.lapsDetails).toHaveLength(1); // no invented crossing
    expect(isAdministrativeFinish(closed)).toBe(true);
    expect(plan.closedOut.find((r) => r.id === 3)?.status).toBe("DNF");
    expect(isAdministrativeFinish(plan.finalized.find((r) => r.id === 1)!)).toBe(false); // measured finish
    // Wave 3 — even in the same Finish Group — is untouched.
    expect([...plan.closedOut, ...plan.finalized].some((r) => r.id === 4)).toBe(false);
  });

  it("is idempotent: once applied, a second run changes nothing", () => {
    const { waveCats, riders } = setup();
    const first = planWaveFinish(waveCats, riders, RACE, NOW);
    const after = riders.map((r) => [...first.closedOut, ...first.finalized].find((x) => x.id === r.id) ?? r);
    const second = planWaveFinish(first.categories, after, RACE, new Date(NOW.getTime() + 60_000));
    expect(second.categories).toEqual([]);
    expect(second.closedOut).toEqual([]);
  });
});

describe("Finish Wave confirmation", () => {
  it("needs FINISH typed; Cancel does nothing", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteConfirmModal title="Finish Wave 2?" description="Wave 2: 4 riders, 1 still racing." confirmWord="FINISH" confirmLabel="Finish Wave" busyLabel="Finishing…" onConfirm={onConfirm} onCancel={onCancel} />);
    const btn = screen.getByRole("button", { name: "Finish Wave" });
    expect(btn).toBeDisabled();
    await user.type(screen.getByPlaceholderText("FINISH"), "finish");
    expect(btn).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
