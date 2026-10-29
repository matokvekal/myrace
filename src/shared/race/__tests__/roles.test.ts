import { describe, it, expect, beforeEach } from "vitest";
import { MEMBER_ROLES, PERMISSIONS, PERMISSION_MATRIX, ROLES, grantFor, isMemberRole, type Grant, type Permission, type Role } from "../roles";
import { authorizeAction, effectiveAccess, type EffectiveAccess } from "../access";
import type { RaceAction } from "../actions";
import { makeAction, makeCategory, makeRaceState, makeRider, resetHarnessIds, TEST_USER_ID } from "../testing";

/**
 * Story 2.1 — PRD FR-10 as data, one test per table row ("–" = no access), and
 * proof that the role defaults in access.ts give exactly those rights.
 */

type Row = [label: string, permission: Permission, expected: Record<Role, Grant | null>];

const FR10: Row[] = [
  ["See the live race, boards, results", "viewRace",
    { owner: "all", admin: "all", start: "all", counter: "all", checkin: "all", viewer: "all" }],
  ["Edit race setup (categories, laps, start times)", "editSetup",
    { owner: "all", admin: "all", start: "startTimesOnly", counter: null, checkin: null, viewer: null }],
  ["Add/edit riders, bibs, late entries", "editRiders",
    { owner: "all", admin: "all", start: null, counter: null, checkin: "all", viewer: null }],
  ["Check riders in, set DNS before start", "checkIn",
    { owner: "all", admin: "all", start: null, counter: null, checkin: "all", viewer: null }],
  ["Start / finish waves and categories, countdown", "runWaves",
    { owner: "all", admin: "all", start: "all", counter: null, checkin: null, viewer: null }],
  ["Add Lap, Undo, resolve Jokers", "recordLaps",
    { owner: "all", admin: "all", start: null, counter: "inScope", checkin: null, viewer: null }],
  ["Correct a rider's lap count", "correctLapCount",
    { owner: "all", admin: "all", start: null, counter: "inScope", checkin: null, viewer: null }],
  ["Set DNF / DSQ during the race", "setRaceStatus",
    { owner: "all", admin: "all", start: null, counter: "inScope", checkin: null, viewer: null }],
  ["Race settings (first-finish-all-finish etc.)", "raceSettings",
    { owner: "all", admin: "all", start: "raceOperationOnly", counter: null, checkin: null, viewer: null }],
  ["Manage members, view the Audit history", "manageMembers",
    { owner: "all", admin: "all", start: null, counter: null, checkin: null, viewer: null }],
  ["Finalize, Amend", "finalize",
    { owner: "all", admin: null, start: null, counter: null, checkin: null, viewer: null }],
  ["Delete race, transfer ownership", "deleteRace",
    { owner: "all", admin: null, start: null, counter: null, checkin: null, viewer: null }],
];

describe("FR-10 permission matrix", () => {
  it.each(FR10)("%s", (_label, permission, expected) => {
    for (const role of ROLES) expect([role, grantFor(role, permission)]).toEqual([role, expected[role]]);
  });

  it("covers every FR-10 row exactly once, in order", () => {
    expect(FR10.map(([, p]) => p)).toEqual([...PERMISSIONS]);
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual([...PERMISSIONS].sort());
  });

  it("member roles are the five commissaire roles' four plus viewer; owner comes from the race", () => {
    expect(MEMBER_ROLES).toEqual(["admin", "start", "counter", "checkin", "viewer"]);
    expect(isMemberRole("owner")).toBe(false);
    expect(isMemberRole("viewer")).toBe(true);
  });
});

/** One representative Action per FR-10 write row, against a race with a running wave 1. */
describe("role defaults give exactly the FR-10 rights", () => {
  beforeEach(() => resetHarnessIds());

  const setup = () => {
    const upcoming = makeCategory({ name: "Kids", heat: 2, status: "upcoming" });
    const running = makeCategory({ name: "Elite Men", heat: 1, status: "running" });
    const racer = makeRider({ category: "Elite Men", heat: 1, raceStatus: "running" });
    const waiting = makeRider({ category: "Kids", heat: 2 });
    const state = makeRaceState({ categories: [running, upcoming], riders: [racer, waiting] });
    const rows: Partial<Record<Permission, RaceAction>> = {
      editSetup: makeAction("CategoryEdited", { categoryUuid: upcoming.uuid, changes: { laps: 4 } }),
      editRiders: makeAction("RiderEdited", { riderUuid: waiting.uuid, changes: { bibNumber: 12 } }),
      checkIn: makeAction("RiderCheckedIn", { riderUuid: waiting.uuid, checked: true }),
      runWaves: makeAction("WaveStarted", { heat: 2 }),
      recordLaps: makeAction("AddLap", { riderUuid: racer.uuid }),
      correctLapCount: makeAction("LapCountCorrection", { riderUuid: racer.uuid, laps: 2 }),
      setRaceStatus: makeAction("StatusCorrection", { riderUuid: racer.uuid, status: "DNF" }),
      raceSettings: makeAction("SettingChanged", { changes: { leaderFinishAll: false } }),
      manageMembers: makeAction("MemberChanged", { userId: "someone-else", roles: ["counter"], permissions: {} }),
      finalize: makeAction("Finalized", { version: 1, token: "t" }),
    };
    return { state, rows, upcoming };
  };

  const accessFor = (role: Role): EffectiveAccess =>
    role === "owner" ? effectiveAccess({ isOwner: true, roles: [] }) : effectiveAccess({ isOwner: false, roles: [role] });

  it.each(Object.entries({
    editSetup: "edit race setup", editRiders: "add/edit riders", checkIn: "check in", runWaves: "start waves",
    recordLaps: "add laps", correctLapCount: "correct lap count", setRaceStatus: "DNF/DSQ",
    raceSettings: "race settings", manageMembers: "manage members", finalize: "finalize",
  }) as [Permission, string][])("%s (%s)", (permission) => {
    const { state, rows } = setup();
    const action = rows[permission]!;
    for (const role of ROLES) {
      const allowed = authorizeAction(accessFor(role), action, state).ok;
      const grant = grantFor(role, permission);
      // A limited grant allows the representative action only when it lies within the limit:
      // editSetup's action changes laps (not a start time); raceSettings' changes a race-operation setting.
      const expected = grant === null ? false : grant === "startTimesOnly" ? false : true;
      expect([role, allowed]).toEqual([role, expected]);
    }
  });

  it("Start may change only start times and waves, not other category fields", () => {
    const { state, upcoming } = setup();
    const start = accessFor("start");
    expect(authorizeAction(start, makeAction("CategoryEdited", { categoryUuid: upcoming.uuid, changes: { startTime: "11:30" } }), state).ok).toBe(true);
    expect(authorizeAction(start, makeAction("CategoryEdited", { categoryUuid: upcoming.uuid, changes: { laps: 5 } }), state).ok).toBe(false);
  });

  it("Start may change only race-operation settings", () => {
    const { state } = setup();
    expect(authorizeAction(accessFor("start"), makeAction("SettingChanged", { changes: { autoColor: false } }), state).ok).toBe(false);
  });

  it("nobody can change the owner's membership", () => {
    const { state } = setup();
    const change = makeAction("MemberChanged", { userId: TEST_USER_ID, roles: null, permissions: {} });
    expect(authorizeAction(accessFor("admin"), change, state)).toEqual({ ok: false, reason: "forbidden" });
  });
});
