import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import JokerCard from "../jokerCard/JokerCard";
import { jokerResolveBlock } from "../jokerResolve";

/** Unknown Rider (Joker): recorded with the exact passage time, assigned later without duplicates. */
const MIN = 60_000;
const at = "2026-10-27T09:30:00.000Z";
const rider = (over: Record<string, unknown> = {}) =>
  ({ bibNumber: 42, timeArrive: null, raceStatus: "running", totalLaps: 5, lapsCounter: 1, ...over }) as Parameters<typeof jokerResolveBlock>[0];

describe("Unknown Rider passage card", () => {
  it("reads '? Unknown Rider' with the original passage time (HH:mm), keeping the full timestamp", () => {
    render(<JokerCard joker={{ id: "j1", sequence: 3, capturedAt: at }} onClick={() => {}} />);
    expect(screen.getByText("? Unknown Rider")).toBeInTheDocument();
    const time = screen.getByText(/^\d{2}:\d{2}$/);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", at);
  });
});

describe("assigning an Unknown Rider passage", () => {
  it("is allowed for a rider whose last passage is a real lap earlier", () => {
    expect(jokerResolveBlock(rider({ timeArrive: "2026-10-27T09:20:00.000Z" }), at, MIN)).toBeNull();
    expect(jokerResolveBlock(rider(), at, MIN)).toBeNull();
  });

  it("is refused (no duplicate lap, the passage is kept) when the rider already has this crossing", () => {
    expect(jokerResolveBlock(rider({ timeArrive: "2026-10-27T09:29:40.000Z" }), at, MIN)).toMatch(/already has this passage/);
  });

  it("is refused when the rider already has a later passage, or has finished", () => {
    expect(jokerResolveBlock(rider({ timeArrive: "2026-10-27T09:31:00.000Z" }), at, MIN)).toMatch(/later passage/);
    expect(jokerResolveBlock(rider({ raceStatus: "finished" }), at, MIN)).toMatch(/finished/);
    expect(jokerResolveBlock(rider({ lapsCounter: 5 }), at, MIN)).toMatch(/finished/);
  });
});
