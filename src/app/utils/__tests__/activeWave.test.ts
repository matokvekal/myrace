import { describe, expect, it } from "vitest";
import { runningWaveOtherThan } from "../activeWave";
import { makeCategory } from "@/test/factories";

describe("runningWaveOtherThan (which wave blocks a start)", () => {
  const cats = (s1: "upcoming" | "running" | "finished", s2: "upcoming" | "running" | "finished") => [
    makeCategory({ name: "A", heat: 1, startTime: "09:00", status: s1 }),
    makeCategory({ name: "B", heat: 2, startTime: "10:00", status: s2 }),
  ];
  it("names the earlier wave still on course", () => {
    expect(runningWaveOtherThan(cats("running", "upcoming"), 2)).toBe(1);
  });
  it("nothing blocks once it is finished, or for the running wave itself", () => {
    expect(runningWaveOtherThan(cats("finished", "upcoming"), 2)).toBeNull();
    expect(runningWaveOtherThan(cats("running", "upcoming"), 1)).toBeNull();
  });
  it("works for waves derived from start times (no heat set)", () => {
    const derived = [
      makeCategory({ name: "A", heat: null, startTime: "09:00", status: "running" }),
      makeCategory({ name: "B", heat: null, startTime: "11:00", status: "upcoming" }),
    ];
    expect(runningWaveOtherThan(derived, 2)).toBe(1);
  });
});
