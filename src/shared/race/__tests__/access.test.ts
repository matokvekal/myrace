import { describe, it, expect, beforeEach } from "vitest";
import {
  SCREENS,
  authorizeAction,
  can,
  effectiveAccess,
  projectRace,
  projectRider,
  projectState,
  readOnlyPermissions,
  validatePermissions,
  validateRoles,
  type MemberPermissions,
} from "../access";
import type { MemberRole } from "../roles";
import { makeAction, makeCategory, makeRaceState, makeRider, resetHarnessIds } from "../testing";

/**
 * Per-race access: roles × screen permissions × wave scope, enforced on Actions
 * and on everything a member can receive.
 */

beforeEach(() => resetHarnessIds());

const member = (roles: MemberRole[], permissions: MemberPermissions = {}) => effectiveAccess({ isOwner: false, roles, permissions });

/** Three waves, one category and one rider each. */
const race = () => {
  const cats = [1, 2, 3].map((heat) => makeCategory({ name: `Wave ${heat} Cat`, heat, status: heat === 1 ? "running" : "upcoming" }));
  const riders = cats.map((c, i) =>
    makeRider({ category: c.name, heat: c.heat, bibNumber: 100 + i, comment: `note ${i}`, chipNumber: `chip${i}`, lapsCounter: i, raceStatus: c.heat === 1 ? "running" : "upcoming" }),
  );
  const state = makeRaceState({
    race: { waveColors: { "1": "#f00", "2": "#0f0", "3": "#00f" }, phone: "050-0000000", joinCode: "ABCDEFGH" },
    categories: cats,
    riders,
  });
  return { state, cats, riders };
};

describe("effective access", () => {
  it("the owner has full access that overrides cannot remove", () => {
    const owner = effectiveAccess({ isOwner: true, roles: [], permissions: { screens: { live: { view: false } }, waves: [2] } });
    expect(SCREENS.every((s) => can(owner, s, "view") && can(owner, s, "delete"))).toBe(true);
    expect(owner.waves).toBeNull();
  });

  it("several roles combine their defaults", () => {
    const a = member(["counter", "checkin"]);
    expect(can(a, "live", "create")).toBe(true);
    expect(can(a, "checkin", "update")).toBe(true);
    expect(can(a, "start", "update")).toBe(false);
  });

  it("an override can add or remove a single operation", () => {
    const a = member(["counter"], { screens: { live: { delete: false }, results: { update: true } } });
    expect(can(a, "live", "create")).toBe(true);
    expect(can(a, "live", "delete")).toBe(false);
    expect(can(a, "results", "update")).toBe(true);
  });

  it("no write without view", () => {
    const a = member(["counter"], { screens: { live: { view: false } } });
    expect(can(a, "live", "create")).toBe(false);
  });

  it("no roles and no overrides = no access", () => {
    const a = member([]);
    expect(SCREENS.some((s) => can(a, s, "view"))).toBe(false);
  });
});

describe("screen restrictions", () => {
  it("a viewer limited to Live and Results sees only those screens", () => {
    const a = member(["viewer"], { screens: { board: { view: false }, status: { view: false }, map: { view: false }, info: { view: false } } });
    expect(SCREENS.filter((s) => can(a, s, "view")).sort()).toEqual(["live", "results"]);
  });

  it("the API checks the requested operation, not only that the screen is visible", () => {
    const { state, riders } = race();
    const lapsNoUndo = member(["counter"], { screens: { live: { delete: false } } });
    const lap = makeAction("AddLap", { riderUuid: riders[0].uuid });
    expect(authorizeAction(lapsNoUndo, lap, state).ok).toBe(true);
    const undo = makeAction("Undo", { targetActionId: lap.actionId });
    expect(authorizeAction(lapsNoUndo, undo, state, { [lap.actionId]: lap })).toEqual({ ok: false, reason: "forbidden" });
  });

  it("Check-in may create and edit riders but not delete or bulk-import them (matrix rows 23, 42-44)", () => {
    const { state, riders } = race();
    const a = member(["checkin"]);
    expect(authorizeAction(a, makeAction("RiderEdited", { riderUuid: riders[1].uuid, changes: { bibNumber: 7 } }), state).ok).toBe(true);
    expect(authorizeAction(a, makeAction("RiderDeleted", { riderUuid: riders[1].uuid }), state).ok).toBe(false);
    expect(authorizeAction(a, makeAction("RidersImported", { riders: [], categories: [] }), state).ok).toBe(false);
  });

  it("Check-in sets DNS only before the rider's wave starts; DNF during the race is the counter's", () => {
    const { state, riders } = race();
    const a = member(["checkin"]);
    expect(authorizeAction(a, makeAction("StatusCorrection", { riderUuid: riders[1].uuid, status: "DNS" }), state).ok).toBe(true);
    expect(authorizeAction(a, makeAction("StatusCorrection", { riderUuid: riders[0].uuid, status: "DNS" }), state).ok).toBe(false);
    expect(authorizeAction(a, makeAction("StatusCorrection", { riderUuid: riders[1].uuid, status: "DNF" }), state).ok).toBe(false);
  });
});

describe("read-only access", () => {
  it("full read-only access sees every screen and can change nothing", () => {
    const { state, riders, cats } = race();
    const a = member([], readOnlyPermissions());
    expect(SCREENS.every((s) => can(a, s, "view"))).toBe(true);
    const actions = [
      makeAction("AddLap", { riderUuid: riders[0].uuid }),
      makeAction("StatusCorrection", { riderUuid: riders[1].uuid, status: "DNS" }),
      makeAction("RiderCheckedIn", { riderUuid: riders[1].uuid, checked: true }),
      makeAction("CategoryEdited", { categoryUuid: cats[1].uuid, changes: { startTime: "12:00" } }),
      makeAction("WaveStarted", { heat: 2 }),
      makeAction("CommentSet", { riderUuid: riders[0].uuid, comment: "x" }),
      makeAction("RaceEdited", { changes: { name: "x" } }),
      makeAction("SettingChanged", { changes: { leaderFinishAll: false } }),
      makeAction("MemberChanged", { userId: "u", roles: ["admin"], permissions: {} }),
    ];
    for (const action of actions) expect([action.type, authorizeAction(a, action, state).ok]).toEqual([action.type, false]);
  });

  it("the viewer role cannot change anything either", () => {
    const { state, riders } = race();
    expect(authorizeAction(member(["viewer"]), makeAction("AddLap", { riderUuid: riders[0].uuid }), state)).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("wave restrictions", () => {
  it("spectator: Live and Results, wave 3 only, read-only", () => {
    const { state, riders } = race();
    const spectator = member([], { screens: { live: { view: true }, results: { view: true } }, waves: [3] });
    const seen = projectState(spectator, state);
    expect(seen.riders.map((r) => r.bibNumber)).toEqual([102]);
    expect(seen.categories.map((c) => c.heat)).toEqual([3]);
    expect(seen.race.waveColors).toEqual({ "3": "#00f" });
    expect(authorizeAction(spectator, makeAction("AddLap", { riderUuid: riders[2].uuid }), state).ok).toBe(false);
  });

  it("organizer: Live and Results, waves 2 and 3, read-only", () => {
    const { state } = race();
    const organizer = member(["viewer"], { screens: { board: { view: false }, status: { view: false }, map: { view: false }, info: { view: false } }, waves: [2, 3] });
    expect(projectState(organizer, state).riders.map((r) => r.bibNumber).sort()).toEqual([101, 102]);
  });

  it("commissaire: laps in wave 1 only", () => {
    const { state, riders } = race();
    const counter = member(["counter"], { waves: [1] });
    expect(authorizeAction(counter, makeAction("AddLap", { riderUuid: riders[0].uuid }), state).ok).toBe(true);
    expect(authorizeAction(counter, makeAction("AddLap", { riderUuid: riders[1].uuid }), state)).toEqual({ ok: false, reason: "out_of_scope" });
    expect(authorizeAction(member(["start"], { waves: [1] }), makeAction("WaveStarted", { heat: 2 }), state)).toEqual({ ok: false, reason: "out_of_scope" });
  });

  it("a rider cannot be moved into a hidden wave", () => {
    const { state, riders, cats } = race();
    const a = member(["checkin"], { waves: [2] });
    expect(authorizeAction(a, makeAction("RiderEdited", { riderUuid: riders[1].uuid, changes: { category: cats[2].name } }), state)).toEqual({ ok: false, reason: "out_of_scope" });
  });

  it("counter category scope (FR-11) limits laps within a wave", () => {
    const { state, riders, cats } = race();
    const a = member(["counter"], { categories: [cats[0].uuid] });
    expect(authorizeAction(a, makeAction("AddLap", { riderUuid: riders[0].uuid }), state).ok).toBe(true);
    expect(authorizeAction(a, makeAction("AddLap", { riderUuid: riders[1].uuid }), state).ok).toBe(false);
  });
});

describe("what a member receives", () => {
  it("lap data only with a results-type screen; private details only with Riders or Check-In", () => {
    const { state, riders } = race();
    const infoOnly = member([], { screens: { schedule: { view: true } } });
    const r = projectRider(infoOnly, state, riders[0])!;
    expect(r.bibNumber).toBe(100);
    expect(r).not.toHaveProperty("lapsDetails");
    expect(r).not.toHaveProperty("comment");
    const live = projectRider(member(["viewer"]), state, riders[0])!;
    expect(live.lapsCounter).toBe(0);
    expect(live).not.toHaveProperty("comment");
    expect(live).not.toHaveProperty("chipNumber");
    expect(projectRider(member(["checkin"]), state, riders[0])).toMatchObject({ comment: "note 0", chipNumber: "chip0" });
  });

  it("no rider screen = no riders at all", () => {
    const { state } = race();
    expect(projectState(member([], { screens: { map: { view: true } } }), state).riders).toEqual([]);
  });

  it("organizer contact, join code and owner only with the right screens", () => {
    const { state } = race();
    const viewer = projectRace(member([], { screens: { live: { view: true } } }), state.race);
    expect(viewer).not.toHaveProperty("phone");
    expect(viewer).not.toHaveProperty("joinCode");
    expect(projectRace(member(["admin"]), state.race)).toMatchObject({ phone: "050-0000000", joinCode: "ABCDEFGH" });
  });
});

describe("cross-race isolation", () => {
  it("an Action addressed to another race is invalid, whatever the member's rights", () => {
    const { state, riders } = race();
    const elsewhere = makeAction("AddLap", { riderUuid: riders[0].uuid }, { raceUuid: "another-race" });
    expect(authorizeAction(effectiveAccess({ isOwner: true, roles: [] }), elsewhere, state)).toEqual({ ok: false, reason: "invalid" });
  });

  it("a rider of another race is invalid (ids resolve only within the race)", () => {
    const { state } = race();
    const other = makeRaceState({ race: { uuid: "another-race" }, riders: [makeRider({ raceUuid: "another-race" })] });
    const foreignRider = Object.keys(other.riders)[0];
    expect(authorizeAction(member(["admin"]), makeAction("AddLap", { riderUuid: foreignRider }), state)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("stored permissions are validated", () => {
  it.each<[unknown, string | null]>([
    [{}, null],
    [{ screens: { live: { view: true, create: false } }, waves: [1, 3] }, null],
    [{ screens: { cockpit: { view: true } } }, 'unknown screen "cockpit"'],
    [{ screens: { live: { fly: true } } }, 'unknown operation "fly" on "live"'],
    [{ screens: { live: { view: "yes" } } }, '"live.view" must be true or false'],
    [{ waves: [] }, "waves must be a non-empty list (leave it out for all waves)"],
    [{ waves: [1, 1] }, "waves must not repeat"],
    [{ waves: ["1"] }, "waves must be wave numbers"],
    [{ admin: true }, 'unknown key "admin"'],
    [[], "permissions must be an object"],
  ])("%j", (value, error) => {
    expect(validatePermissions(value)).toBe(error);
  });

  it("roles", () => {
    expect(validateRoles(["counter", "viewer"])).toBeNull();
    expect(validateRoles(["owner"])).not.toBeNull();
    expect(validateRoles(["counter", "counter"])).not.toBeNull();
  });
});
