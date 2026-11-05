import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RacingRider from "../RacingRider";
import { makeRider } from "@/test/factories";
import { normalizeCardCoverMs, useBoardHold } from "@/stores/boardHoldStore";

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const noop = () => {};

const card = (timeArrive: string | null, raceStatus: "running" | "finished" = "running") => {
  render(<RacingRider rider={makeRider({ bibNumber: 7, raceStatus, timeArrive })} color="#f00" onClick={noop} onDoubleClick={noop} />);
  return screen.getByTestId("racing-rider-7");
};

describe("card cover", () => {
  it("lasts as long as the setting says, from the rider's arrival", () => {
    useBoardHold.getState().setCoverMs(30000);
    expect(card(secondsAgo(20))).toHaveAttribute("data-covered", "true");
  });

  it("is gone once the time has passed", () => {
    useBoardHold.getState().setCoverMs(10000);
    expect(card(secondsAgo(20))).not.toHaveAttribute("data-covered");
  });

  it("doesn't cover a rider who hasn't arrived yet", () => {
    useBoardHold.getState().setCoverMs(240000);
    expect(card(null)).not.toHaveAttribute("data-covered");
  });

  it("falls back to the default on a bad saved value", () => {
    expect(normalizeCardCoverMs(5)).toBe(10000);
    expect(normalizeCardCoverMs(undefined)).toBe(10000);
    expect(normalizeCardCoverMs(120000)).toBe(120000);
  });
});
