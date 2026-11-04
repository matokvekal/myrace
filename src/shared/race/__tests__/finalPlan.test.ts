import { describe, expect, it } from "vitest";
import { planFinalization } from "../finalPlan";

const cat = (name: string, status: string, startedAt: number | null = status === "upcoming" ? null : 1, extra = {}) => ({ uuid: name, name, status, startedAt, ...extra });
const rider = (bib: number, category: string, status: string, raceStatus: string, timeStartRace: string | null = raceStatus === "upcoming" ? null : "09:00:00") =>
  ({ uuid: `r${bib}`, bibNumber: bib, category, status, raceStatus, timeStartRace });

describe("Finish Race plan (mixed race)", () => {
  const categories = [cat("Elite", "running"), cat("Juniors", "finished"), cat("Kids", "upcoming"), cat("Ignored", "upcoming", null, { ignored: true })];
  const riders = [
    rider(1, "Elite", "finished", "finished"), // crossed the line
    rider(2, "Elite", "standing", "running"), // still on course → FINISHED on its laps
    rider(3, "Elite", "DSQ", "finished"), // kept
    rider(4, "Elite", "DNS", "upcoming"), // kept
    rider(5, "Juniors", "finished", "finished"), // wave already finished
    rider(6, "Juniors", "DNF", "finished"), // kept
    rider(7, "Kids", "standing", "upcoming"), // wave never started → DNS
    rider(8, "Kids", "standing", "upcoming"),
    rider(9, "Ignored", "standing", "upcoming"), // ignored wave: untouched
  ];
  const plan = planFinalization(riders, categories);
  const bibs = (xs: { bibNumber?: number | null }[]) => xs.map((x) => x.bibNumber);

  it("keeps finished and out results; still on course → FINISHED (never DNF); never started → DNS", () => {
    expect(bibs(plan.finished)).toEqual([1, 5]);
    expect(bibs(plan.toFinish)).toEqual([2]);
    expect(bibs(plan.toDNS)).toEqual([7, 8]);
    expect(bibs(plan.kept.DSQ)).toEqual([3]);
    expect(bibs(plan.kept.DNS)).toEqual([4]);
    expect(bibs(plan.kept.DNF)).toEqual([6]);
  });

  it("closes every open category; the one that never started is 'not started'; ignored waves are left alone", () => {
    expect(plan.toClose.map((c) => c.name)).toEqual(["Elite", "Kids"]);
    expect(plan.notStarted.map((c) => c.name)).toEqual(["Kids"]);
  });

  it("every non-ignored rider is accounted for exactly once", () => {
    const all = [...plan.finished, ...plan.toFinish, ...plan.toDNS, ...plan.kept.DNF, ...plan.kept.DSQ, ...plan.kept.DNS];
    expect(all).toHaveLength(8);
    expect(new Set(all.map((r) => r.uuid)).size).toBe(8);
  });

  it("a category closed by Finish Wave without ever starting still counts as not started", () => {
    const p = planFinalization([rider(1, "Late", "standing", "upcoming")], [cat("Late", "finished", null)]);
    expect(p.notStarted.map((c) => c.name)).toEqual(["Late"]);
    expect(bibs(p.toDNS)).toEqual([1]);
  });
});
