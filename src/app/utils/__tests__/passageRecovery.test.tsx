import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkRecovery, withRecoveredPassage, hhmm } from "../passageRecovery";
import RecapPanel from "../../race/[id]/heat/[heatId]/RecapPanel";
import { makeRider } from "@/test/factories";

/** RECAP and missed-passage recovery (times on today's date). */
const at = (hm: string) => { const [h, m] = hm.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const MIN3 = 180_000;
const rider = () =>
  makeRider({
    id: 1, bibNumber: 42, raceStatus: "running", status: "standing", timeStartRace: "00:00:00", totalLaps: 5, lapsCounter: 2,
    lapsDetails: [
      { lap: 1, startTime: at("00:00"), endTime: at("00:10"), lapTime: "10:00" },
      { lap: 2, startTime: at("00:10"), endTime: at("00:30"), lapTime: "20:00" },
    ],
  });
const NOW = at("23:59");

describe("checkRecovery", () => {
  it("a genuinely missing passage: ok, and which lap it becomes", () => {
    expect(checkRecovery(rider(), at("00:20"), MIN3, NOW)).toEqual({ kind: "ok", becomesLap: 2 });
  });
  it("an existing passage within the minimum: shown as possibly the same crossing (never added silently)", () => {
    const r = checkRecovery(rider(), at("00:31"), MIN3, NOW);
    expect(r.kind).toBe("near");
    if (r.kind === "near") expect(hhmm(r.nearest)).toBe(hhmm(at("00:30")));
  });
  it("refuses before the start, in the future, or once all laps are done", () => {
    expect(checkRecovery({ ...rider(), timeStartRace: null }, at("00:20"), MIN3, NOW).kind).toBe("invalid");
    expect(checkRecovery(rider(), new Date(NOW.getTime() + 60_000), MIN3, NOW).kind).toBe("invalid");
    expect(checkRecovery({ ...rider(), lapsCounter: 5 }, at("00:20"), MIN3, NOW).kind).toBe("invalid");
  });
});

describe("withRecoveredPassage", () => {
  it("inserts at the estimated time, renumbers laps, keeps the other passages, marks it recovered", () => {
    const out = withRecoveredPassage(rider(), at("00:20"), at("00:40"));
    expect(out.lapsCounter).toBe(3);
    expect(out.lapsDetails.map((l) => [l.lap, hhmm(l.endTime), l.lapTime, !!(l as { recovered?: boolean }).recovered])).toEqual([
      [1, hhmm(at("00:10")), "10:00", false],
      [2, hhmm(at("00:20")), "10:00", true],
      [3, hhmm(at("00:30")), "10:00", false],
    ]);
    expect(out.timeArrive).toBe(at("00:30").toISOString());
  });
});

describe("RECAP panel", () => {
  it("lists passages (bib + HH:mm) and Unknown Rider; recovery needs confirmation when a passage is near", async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    render(<RecapPanel riders={[rider()]} jokers={[{ id: "j", sequence: 1, capturedAt: at("00:35").toISOString() }]} minLapMs={MIN3} onRecover={onRecover} />);
    const items = screen.getByTestId("recap-list").querySelectorAll("li");
    expect([...items].map((li) => li.textContent)).toEqual([`#42${hhmm(at("00:10"))}`, `#42${hhmm(at("00:30"))}`, `? Unknown Rider${hhmm(at("00:35"))}`]);

    await user.type(screen.getByTestId("recap-bib"), "42");
    await user.clear(screen.getByTestId("recap-time"));
    await user.type(screen.getByTestId("recap-time"), "00:31");
    await user.click(screen.getByTestId("recap-check"));
    expect(screen.getByRole("alert")).toHaveTextContent(/may be this same crossing/);
    expect(screen.queryByTestId("recap-add")).toBeNull();
    await user.click(screen.getByTestId("recap-add-anyway"));
    expect(onRecover).toHaveBeenCalledTimes(1);

    await user.clear(screen.getByTestId("recap-bib")); // the selected bib stays after a correction
    await user.type(screen.getByTestId("recap-bib"), "42");
    await user.clear(screen.getByTestId("recap-time"));
    await user.type(screen.getByTestId("recap-time"), "00:20");
    await user.click(screen.getByTestId("recap-check"));
    await user.click(screen.getByTestId("recap-add"));
    expect(onRecover).toHaveBeenCalledTimes(2);
    expect(onRecover.mock.calls[1][1].getTime()).toBe(at("00:20").getTime());
  });
});
