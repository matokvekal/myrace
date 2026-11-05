import { describe, it, expect } from "vitest";
import { categorySignature, emptyPrefs, learnRace, suggestFinishGroups } from "../finishGroupLearning";
import { makeCategory } from "@/test/factories";

const cat = (id: number, name: string, over: Record<string, unknown> = {}) => makeCategory({ id, name, heat: 1, status: "upcoming", ...over });

describe("Finish Group learning", () => {
  it("matches categories by normalized name parts (level, gender, age range)", () => {
    expect(categorySignature({ name: "Masters  Men 40 - 49", subCategory: null })).toBe(categorySignature({ name: "masters men 40-49", subCategory: null }));
    expect(categorySignature({ name: "Masters Men 40-49", subCategory: null })).not.toBe(categorySignature({ name: "Masters Women 40-49", subCategory: null }));
  });

  it("suggests the organizer's own past groupings, numbered after the race's groups, only with 2+ matches", () => {
    let prefs = emptyPrefs();
    prefs = learnRace(prefs, "past-1", [cat(1, "Men Masters", { linkGroup: "1" }), cat(2, "Women Masters", { linkGroup: "1" }), cat(3, "Elite", { linkGroup: "" })]);
    prefs = learnRace(prefs, "past-2", [cat(1, "Level 2 Men", { linkGroup: "2" }), cat(2, "Level 2 Women", { linkGroup: "2" })]);
    const now = [cat(11, "Men Masters", { heat: 1 }), cat(12, "Women Masters", { heat: 3 }), cat(13, "Level 2 Men"), cat(14, "Juniors", { linkGroup: "1" })];
    const s = suggestFinishGroups(prefs, "new", now);
    expect(s.get(11)).toBe("2"); // "1" is already used in this race
    expect(s.get(12)).toBe("2"); // across waves: wave does not matter
    expect(s.has(13)).toBe(false); // only one of its learned set is present
    expect(s.has(14)).toBe(false); // already assigned
  });

  it("never groups by wave or by 'Men'/'Women' in names when the organizer never did", () => {
    const now = [cat(1, "Men Elite", { heat: 1 }), cat(2, "Women Elite", { heat: 1 }), cat(3, "Men Juniors", { heat: 1 })];
    expect(suggestFinishGroups(emptyPrefs(), "new", now).size).toBe(0);
  });

  it("learning a race replaces its earlier entry; its own assignments are not suggested back to it", () => {
    let prefs = learnRace(emptyPrefs(), "r1", [cat(1, "A", { linkGroup: "1" }), cat(2, "B", { linkGroup: "1" })]);
    prefs = learnRace(prefs, "r1", [cat(1, "A", { linkGroup: "1" }), cat(2, "C", { linkGroup: "1" })]);
    expect(prefs.races.r1.groups).toEqual([["a", "c"]]);
    expect(suggestFinishGroups(prefs, "r1", [cat(1, "A"), cat(2, "C")]).size).toBe(0);
  });
});
