import { describe, it, expect } from "vitest";
import { makeRider } from "@/test/factories";
import { importProblems } from "../importCheck";
import { newRider } from "../../../../../server/src/races/schemas";

const RACE = "race-1";
const rider = (bib: number, over: Record<string, unknown> = {}) =>
  makeRider({ raceUuid: RACE, bibNumber: bib, firstName: "Test", lastName: `R${bib}`, category: "Elite", heat: 1, ...over });

describe("Shared-race import check (what the server would refuse)", () => {
  it("a clean start list has no problems", () => {
    expect(importProblems([rider(1), rider(2), rider(0), rider(0)], [2, 3, 4, 5], [])).toEqual([]);
  });

  it("names the rows of a duplicate bib in the file", () => {
    const p = importProblems([rider(7), rider(8), rider(7)], [2, 3, 4], []);
    expect(p).toEqual([{ rows: [2, 4], message: "Bib 7 appears on rows 2, 4" }]);
  });

  it("a bib already in the race (e.g. the same file imported twice)", () => {
    const p = importProblems([rider(5)], [9], [rider(5, { firstName: "Dana", lastName: "Old" })]);
    expect(p[0].message).toBe("Row 9: bib 5 is already in this race (Dana Old)");
  });

  it("a row with no category", () => {
    const p = importProblems([rider(3, { category: "  " })], [6], []);
    expect(p[0].message).toBe("Row 6 (Test R3): no category");
  });

  it("field limits, wave and colours", () => {
    const p = importProblems(
      [rider(1, { firstName: "x".repeat(101) }), rider(2, { heat: 1000 }), rider(3, { bibColor: "red" }), rider(1_000_000)],
      [2, 3, 4, 5],
      [],
    ).map((x) => x.message);
    expect(p).toEqual([
      "Row 2: firstName is longer than 100 characters",
      'Row 3: wave "1000" is not a number from 0 to 999',
      'Row 4: bib colour "red" is not a colour',
      "Row 5: bib 1000000 is too large",
    ]);
  });

  it("stays in step with the server: what passes here passes the server's rider schema, and the limits match", () => {
    const toServer = (r: ReturnType<typeof rider>) => ({
      uuid: "11111111-1111-4111-8111-111111111111", firstName: r.firstName, middleName: null, lastName: r.lastName,
      bibNumber: r.bibNumber > 0 ? r.bibNumber : null, team: r.team ?? null, category: r.category, heat: r.heat ?? null,
      bibColor: r.bibColor ?? null, bibTextColor: r.bibTextColor ?? null,
    });
    const ok = rider(999999, { firstName: "x".repeat(100), category: "c".repeat(120), team: "t".repeat(150), heat: 999, bibColor: "#AABBCC" });
    expect(importProblems([ok], [2], [])).toEqual([]);
    expect(newRider.safeParse(toServer(ok)).success).toBe(true);
    for (const bad of [rider(1, { firstName: "x".repeat(101) }), rider(1, { category: "c".repeat(121) }), rider(1, { category: "" }), rider(1, { heat: 1000 }), rider(1, { bibColor: "red" })]) {
      expect(importProblems([bad], [2], []).length).toBeGreaterThan(0);
      expect(newRider.safeParse(toServer(bad)).success).toBe(false);
    }
  });
});
