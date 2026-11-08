/** 0.3.5 — result fingerprint (approval validity), RiderNameCorrected, who may approve. */
import { describe, expect, it } from "vitest";
import { approvalBlocker, categoryResultFingerprint } from "../approval";
import { authorizeAction, canApproveCategory, effectiveAccess } from "../access";
import { applyAction } from "../engine";
import { makeAction, makeCategory, makeRaceState, makeRider, T0 } from "../testing";

const setup = () => {
  const elite = makeCategory({ name: "Elite Men", status: "finished", startedAt: T0 });
  const kids = makeCategory({ name: "Kids", heat: 2, status: "upcoming" });
  const a = makeRider({ firstName: "Noam", lastName: "Levi", status: "finished", raceStatus: "finished", lapsCounter: 3, position_category: 1 });
  const b = makeRider({ firstName: "Dana", lastName: "Cohen", status: "finished", raceStatus: "finished", lapsCounter: 3, position_category: 2 });
  const k = makeRider({ category: "Kids", heat: 2 });
  return { state: makeRaceState({ categories: [elite, kids], riders: [a, b, k] }), elite, kids, a, b, k };
};

describe("category result fingerprint", () => {
  it("changes with the category's result, not with other categories or check-in/comment", () => {
    const { state, elite, a, k } = setup();
    const f0 = categoryResultFingerprint(state, elite.uuid);
    k.lapsCounter = 1; k.status = "DNF";
    a.checked = true; a.comment = "note";
    expect(categoryResultFingerprint(state, elite.uuid)).toBe(f0);
    for (const change of [
      () => { a.lastName = "Levy"; },
      () => { a.status = "DSQ"; },
      () => { a.lapsCounter = 2; },
      () => { a.position_category = 2; },
      () => { a.bibNumber = 7; },
      () => { a.elapsedTimeFromStart = "1:00:00"; },
      () => { elite.laps = 4; },
      () => { delete state.riders[a.uuid]; },
    ]) {
      const before = categoryResultFingerprint(state, elite.uuid);
      change();
      expect(categoryResultFingerprint(state, elite.uuid)).not.toBe(before);
    }
  });

  it("only a finished category that ran can be approved", () => {
    const { state, elite, kids } = setup();
    expect(approvalBlocker(state, elite.uuid)).toBeNull();
    expect(approvalBlocker(state, kids.uuid)).toMatch(/finished/);
    kids.status = "finished"; // closed without a start ("not started")
    expect(approvalBlocker(state, kids.uuid)).toMatch(/finished/);
    expect(approvalBlocker(state, "nope")).toMatch(/not found/);
  });
});

describe("RiderNameCorrected (audited name fix after GO)", () => {
  it("applies after GO where RiderEdited is locked; names only, reason required", () => {
    const { state, a } = setup();
    expect(applyAction(state, makeAction("RiderEdited", { riderUuid: a.uuid, changes: { lastName: "X" } }), T0)).toMatchObject({ applied: false, reason: "locked" });
    expect(applyAction(state, makeAction("RiderNameCorrected", { riderUuid: a.uuid, changes: { lastName: "Levy" }, reason: "" }), T0)).toMatchObject({ applied: false, reason: "invalid" });
    expect(applyAction(state, makeAction("RiderNameCorrected", { riderUuid: a.uuid, changes: { bibNumber: 3 } as never, reason: "typo" }), T0)).toMatchObject({ applied: false, reason: "invalid" });
    expect(applyAction(state, makeAction("RiderNameCorrected", { riderUuid: a.uuid, changes: { lastName: " " }, reason: "typo" }), T0)).toMatchObject({ applied: false, reason: "invalid" });
    expect(applyAction(state, makeAction("RiderNameCorrected", { riderUuid: a.uuid, changes: { lastName: "Levy" }, reason: "typo" }), T0)).toMatchObject({ applied: true });
    expect(state.riders[a.uuid].lastName).toBe("Levy");
  });

  it("needs results.update: owner, admin, results judge and (0.3.6) the counter / invited judge — not check-in or start alone", () => {
    const { state, a } = setup();
    const act = makeAction("RiderNameCorrected", { riderUuid: a.uuid, changes: { lastName: "Levy" }, reason: "typo" });
    const ok = (isOwner: boolean, roles: string[]) => authorizeAction(effectiveAccess({ isOwner, roles: roles as never, permissions: {} }), act, state).ok;
    expect(ok(true, [])).toBe(true);
    expect(ok(false, ["admin"])).toBe(true);
    expect(ok(false, ["results"])).toBe(true);
    expect(ok(false, ["start", "counter", "checkin"])).toBe(true);
    expect(ok(false, ["counter"])).toBe(true);
    expect(ok(false, ["checkin"])).toBe(false);
    expect(ok(false, ["start"])).toBe(false);
    expect(ok(false, ["viewer"])).toBe(false);
  });
});

describe("who may approve", () => {
  it("live.update or results.update with the category in scope", () => {
    const { elite } = setup();
    const can = (isOwner: boolean, roles: string[], permissions = {}) => canApproveCategory(effectiveAccess({ isOwner, roles: roles as never, permissions }), elite);
    expect(can(true, [])).toBe(true);
    expect(can(false, ["start", "counter", "checkin"])).toBe(true);
    expect(can(false, ["results"])).toBe(true);
    expect(can(false, ["checkin"])).toBe(false);
    expect(can(false, ["start"])).toBe(false);
    expect(can(false, ["viewer"])).toBe(false);
    expect(can(false, ["counter"], { waves: [2] })).toBe(false); // out of scope
  });
});
