import { describe, expect, it } from "vitest";
import { liveFilterOptions } from "../liveFilter";
import { makeCategory, makeRider } from "@/test/factories";

describe("Live category filter: only categories with riders in this wave", () => {
  const RACE = "race-1";
  it("drops a wave category that has no riders (e.g. 'ילדים 14' with nobody in it)", () => {
    const withRiders = makeCategory({ name: "ילדים 13", raceUuid: RACE, status: "running" });
    const empty = makeCategory({ name: "ילדים 14", raceUuid: RACE, status: "running" });
    const riders = [makeRider({ raceUuid: RACE, category: "ילדים 13" }), makeRider({ raceUuid: RACE, category: "ילדים 13" })];
    const out = liveFilterOptions([withRiders, empty], riders, RACE);
    expect(out.map((o) => [o.cat.name, o.riders])).toEqual([["ילדים 13", 2]]);
  });

  it("counts only this race's riders; another race's same-named category doesn't count", () => {
    const cat = makeCategory({ name: "Elite", raceUuid: RACE });
    expect(liveFilterOptions([cat], [makeRider({ raceUuid: "other", category: "Elite" })], RACE)).toEqual([]);
  });

  it("running first, then finished, then not started — and follows the wave it is given", () => {
    const a = makeCategory({ name: "A", raceUuid: RACE, status: "upcoming" });
    const b = makeCategory({ name: "B", raceUuid: RACE, status: "finished" });
    const c = makeCategory({ name: "C", raceUuid: RACE, status: "running" });
    const riders = ["A", "B", "C"].map((n) => makeRider({ raceUuid: RACE, category: n }));
    expect(liveFilterOptions([a, b, c], riders, RACE).map((o) => o.cat.name)).toEqual(["C", "B", "A"]);
    expect(liveFilterOptions([a], riders, RACE).map((o) => o.cat.name)).toEqual(["A"]); // other wave: only its own
  });
});
