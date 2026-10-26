import { describe, it, expect, beforeEach } from "vitest";
import {
  ACTION_TYPES,
  NOT_APPLIED_REASONS,
  PROTOCOL_VERSION,
  UNDOABLE_ACTION_TYPES,
  isActionType,
  type RaceAction,
} from "../actions";
import { RACE_INFO_FIELDS, RIDER_IDENTITY_FIELDS, raceSettings } from "../state";
import {
  T0,
  TEST_RACE_UUID,
  makeAction,
  makeCategory,
  makeRaceState,
  makeRider,
  resetHarnessIds,
} from "../testing";

/** Story 2.1 — the shared model's constants and the test harness. */

beforeEach(() => resetHarnessIds());

describe("Action catalog", () => {
  it("is the closed enum from the architecture, in order (same list as server/sql/004)", () => {
    expect(ACTION_TYPES).toEqual([
      "AddLap", "Undo", "RiderFinished", "LapCountCorrection", "StatusCorrection",
      "WaveStarted", "WaveFinished", "CategoryFinished",
      "CategoryAdded", "CategoryEdited", "CategoryDeleted",
      "RiderAdded", "RiderEdited", "RiderDeleted", "RidersImported",
      "RiderCheckedIn", "CommentSet", "RaceEdited", "SettingChanged",
      "MemberChanged", "Finalized", "Amended",
    ]);
  });

  it("recognises only catalog types", () => {
    expect(isActionType("AddLap")).toBe(true);
    expect(isActionType("addLap")).toBe(false);
    expect(isActionType("StartTimeSet")).toBe(false); // folded into CategoryEdited
    expect(isActionType(undefined)).toBe(false);
  });

  it("Undo may target only AddLap and RiderFinished", () => {
    expect(UNDOABLE_ACTION_TYPES).toEqual(["AddLap", "RiderFinished"]);
  });

  it("not-applied reasons are the API error codes", () => {
    expect([...NOT_APPLIED_REASONS].sort()).toEqual(
      ["forbidden", "invalid", "locked", "not_member", "out_of_scope", "race_official", "upgrade_required"],
    );
  });
});

describe("state fields", () => {
  it("RiderEdited fields are identity only, never computed values", () => {
    for (const f of ["timeStartRace", "totalLaps", "raceStatus", "lapsCounter", "lapsDetails", "position_category", "status"]) {
      expect(RIDER_IDENTITY_FIELDS).not.toContain(f);
    }
    expect(RIDER_IDENTITY_FIELDS).toContain("bibNumber");
  });

  it("RaceEdited cannot change settings, ownership or the sequence", () => {
    for (const f of ["autoColor", "leaderFinishAll", "ownerUserId", "lastSeq", "uuid", "joinCode"]) {
      expect(RACE_INFO_FIELDS).not.toContain(f);
    }
  });

  it("settings treat null as on, like the app", () => {
    expect(raceSettings({ autoColor: null, leaderFinishAll: null })).toEqual({ autoColor: true, leaderFinishAll: true });
    expect(raceSettings({ autoColor: false, leaderFinishAll: true })).toEqual({ autoColor: false, leaderFinishAll: true });
  });
});

describe("test harness", () => {
  it("builds a race state keyed by uuid, scoped to one race", () => {
    const cat = makeCategory();
    const rider = makeRider({ bibNumber: 7 });
    const state = makeRaceState({ categories: [cat], riders: [rider] });
    expect(state.race.uuid).toBe(TEST_RACE_UUID);
    expect(state.categories[cat.uuid]).toBe(cat);
    expect(state.riders[rider.uuid]).toMatchObject({ raceUuid: TEST_RACE_UUID, category: cat.name, lapsDetails: [] });
    expect(state.race.lastSeq).toBe(0);
  });

  it("gives the same ids after a reset (deterministic fixtures)", () => {
    const first = [makeRider().uuid, makeCategory().uuid];
    resetHarnessIds();
    expect([makeRider().uuid, makeCategory().uuid]).toEqual(first);
  });

  it("builds a complete Action envelope at an aligned time", () => {
    const action: RaceAction = makeAction("AddLap", { riderUuid: "r1" }, { atMs: T0 + 61_000 });
    expect(action).toMatchObject({
      raceUuid: TEST_RACE_UUID,
      type: "AddLap",
      payload: { riderUuid: "r1" },
      deviceTime: "2026-06-01T10:01:01.000Z",
      clockOffsetMs: 0,
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(action.actionId).toMatch(/^[0-9a-f-]{36}$/);
    // Server-only fields are never set by a Device.
    expect(action).not.toHaveProperty("seq");
    expect(action).not.toHaveProperty("userId");
  });

  it("states do not share objects", () => {
    const a = makeRaceState();
    const b = makeRaceState({ race: { uuid: "other-race" } });
    a.race.name = "changed";
    expect(b.race.name).toBe("Test Race");
    expect(b.race.uuid).toBe("other-race");
  });
});
