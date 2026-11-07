/**
 * 0.2 business rule — "first write wins per rider + lap". The first committed lap of a rider is
 * authoritative; a later report of the same lap (another judge, a double tap, a late offline
 * report — even one with an EARLIER device time) is kept in race_events as NOT applied with
 * reason "duplicate". Same window as the engine's minimum lap time. Only an explicit correction
 * changes laps afterwards. Runs against the isolated test database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/db/pool";
import { action, addMember, newUser, publishRace, riderOf, send, snapshot, startServer, stopServer, type RaceFixture, type TestUser } from "./helpers";

const MIN = 60_000;
let owner: TestUser, judgeA: TestUser, judgeB: TestUser;

beforeAll(async () => {
  await startServer();
  [owner, judgeA, judgeB] = await Promise.all(["FwwOwner", "FwwJudgeA", "FwwJudgeB"].map((n) => newUser(n)));
});
afterAll(stopServer);

/** A started 1-wave race (5 laps, min lap 180 s), two counter judges with member writes on. */
async function startedRace(): Promise<{ race: RaceFixture; start: number; at: (ms: number) => string; rider: string }> {
  const race = await publishRace(owner, 1, 2, 5);
  await addMember(owner, race.raceUuid, judgeA, ["counter"]);
  await addMember(owner, race.raceUuid, judgeB, ["counter"]);
  await db.query(`UPDATE races SET "memberWrites" = true WHERE uuid = $1`, [race.raceUuid]);
  const start = Date.now() - 60 * MIN; // in the past: future-dated events are held to arrival
  const at = (ms: number) => new Date(start + ms).toISOString();
  const res = await send(owner, race.raceUuid,
    action(race.raceUuid, "SettingChanged", { changes: { minLapSeconds: 180 } }, { at: at(0) }),
    action(race.raceUuid, "WaveStarted", { heat: 1 }, { at: at(0) }));
  expect(res.every((r) => r.applied)).toBe(true);
  return { race, start, at, rider: race.riders[0].uuid };
}

const events = (raceUuid: string, riderUuid: string) =>
  db.query<{ actionId: string; applied: boolean; reason: string | null; eventAt: Date; userId: string }>(
    `SELECT "actionId", applied, reason, "eventAt", "userId" FROM race_events
     WHERE "raceUuid" = $1 AND type = 'AddLap' AND payload->>'riderUuid' = $2 ORDER BY seq`,
    [raceUuid, riderUuid],
  );

describe("first write wins per rider + lap", () => {
  it("two judges tap the same rider ~1 s apart, concurrently: one lap, timed by the first committed", async () => {
    const { race, start, at, rider } = await startedRace();
    const [ra, rb] = await Promise.all([
      send(judgeA, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN) })),
      send(judgeB, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN + 1000) })),
    ]);
    const results = [ra[0], rb[0]];
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.filter((r) => !r.applied).map((r) => r.reason)).toEqual(["duplicate"]);

    const log = await events(race.raceUuid, rider);
    expect(log).toHaveLength(2); // the duplicate is retained (audit)
    const [first, second] = log; // commit order
    expect([first.applied, second.applied, second.reason]).toEqual([true, false, "duplicate"]);
    const r = riderOf(await snapshot(owner, race.raceUuid), rider)!;
    expect(r.lapsCounter).toBe(1);
    expect(Date.parse(r.lapsDetails[0].endTime)).toBe(first.eventAt.getTime());
    expect(Date.parse(r.lapsDetails[0].endTime) - start).toBeLessThanOrEqual(8 * MIN + 1000);
  });

  it("a late offline report with an EARLIER device time doesn't replace the committed lap", async () => {
    const { race, at, rider } = await startedRace();
    expect((await send(judgeA, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(10 * MIN) })))[0].applied).toBe(true);
    const late = await send(judgeB, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(10 * MIN - 20_000) }));
    expect(late[0]).toMatchObject({ applied: false, reason: "duplicate" });
    const r = riderOf(await snapshot(owner, race.raceUuid), rider)!;
    expect(r.lapsCounter).toBe(1);
    expect(r.lapsDetails[0].lapTime).toBe("10:00");
  });

  it("the same judge's double tap is a duplicate; a genuine next lap (beyond the minimum) counts", async () => {
    const { race, at, rider } = await startedRace();
    const res = await send(judgeA, race.raceUuid,
      action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN) }),
      action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN + 400) }),
      action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(16 * MIN) }));
    expect(res.map((r) => [r.applied, r.reason])).toEqual([[true, null], [false, "duplicate"], [true, null]]);
    const r = riderOf(await snapshot(owner, race.raceUuid), rider)!;
    expect(r.lapsCounter).toBe(2);
    expect(r.lapsDetails.map((l: { lapTime: string }) => l.lapTime)).toEqual(["08:00", "08:00"]);
  });

  it("Undo of the first lap leaves no lap: the duplicate is not resurrected", async () => {
    const { race, at, rider } = await startedRace();
    const [first] = await send(judgeA, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN) }));
    const [dup] = await send(judgeB, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN + 1000) }));
    expect(dup.reason).toBe("duplicate");
    expect((await send(judgeA, race.raceUuid, action(race.raceUuid, "Undo", { targetActionId: first.actionId })))[0].applied).toBe(true);
    const r = riderOf(await snapshot(owner, race.raceUuid), rider)!;
    expect(r.lapsCounter).toBe(0);
    expect(r.lapsDetails).toEqual([]);
    // The duplicate can't be undone either: it never counted.
    expect((await send(judgeA, race.raceUuid, action(race.raceUuid, "Undo", { targetActionId: dup.actionId })))[0])
      .toMatchObject({ applied: false, reason: "invalid" });
  });

  it("an explicit LapCountCorrection still sets the count", async () => {
    const { race, at, rider } = await startedRace();
    await send(judgeA, race.raceUuid,
      action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN) }),
      action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN + 500) }));
    const [fix] = await send(owner, race.raceUuid, action(race.raceUuid, "LapCountCorrection", { riderUuid: rider, laps: 2 }, { at: at(9 * MIN) }));
    expect(fix.applied).toBe(true);
    expect(riderOf(await snapshot(owner, race.raceUuid), rider)!.lapsCounter).toBe(2);
  });

  it("a re-send of the same actionId returns the stored result", async () => {
    const { race, at, rider } = await startedRace();
    await send(judgeA, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN) }));
    const dup = action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN + 900) });
    const [once] = await send(judgeB, race.raceUuid, dup);
    const [again] = await send(judgeB, race.raceUuid, dup);
    expect(again).toEqual(once);
    expect(once).toMatchObject({ applied: false, reason: "duplicate" });
    expect(await events(race.raceUuid, rider)).toHaveLength(2);
  });

  it("other riders are independent; a recovered passage is exempt (as in the engine)", async () => {
    const { race, at, rider } = await startedRace();
    const other = race.riders[1].uuid;
    const res = await send(judgeA, race.raceUuid,
      action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(8 * MIN) }),
      action(race.raceUuid, "AddLap", { riderUuid: other }, { at: at(8 * MIN + 300) }),
      action(race.raceUuid, "AddLap", { riderUuid: rider }, { at: at(16 * MIN) }),
      action(race.raceUuid, "AddLap", { riderUuid: rider, recovered: true, enteredAt: at(20 * MIN) }, { at: at(15 * MIN) }));
    expect(res.every((r) => r.applied)).toBe(true);
    expect(riderOf(await snapshot(owner, race.raceUuid), rider)!.lapsCounter).toBe(3);
  });
});
