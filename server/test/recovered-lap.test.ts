/**
 * RECAP recovery over the API: a missed passage sent afterwards as
 * AddLap {recovered, enteredAt} at its estimated time lands in time order,
 * is kept marked recovered, and is not taken for a duplicate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/pool";
import { action, newUser, publishRace, send, snapshot, startServer, stopServer, type TestUser } from "./helpers";

let owner: TestUser;
beforeAll(async () => {
  await startServer();
  owner = await newUser("RecapOwner");
});
afterAll(() => stopServer());

describe("recovered passage (AddLap recovered)", () => {
  it("is applied at its estimated time, marked recovered, with its entry time kept", async () => {
    const race = await publishRace(owner, 1, 1, 5);
    const rider = race.riders[0];
    const t0 = Date.now() - 60 * 60_000; // in the past: events dated in the future are held to their arrival time
    await send(owner, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 }, { at: new Date(t0).toISOString() }));
    await send(owner, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: rider.uuid }, { at: new Date(t0 + 10 * 60_000).toISOString() }));
    await send(owner, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: rider.uuid }, { at: new Date(t0 + 20 * 60_000).toISOString() }));
    const enteredAt = new Date(t0 + 25 * 60_000).toISOString();
    const [res] = await send(
      owner,
      race.raceUuid,
      action(race.raceUuid, "AddLap", { riderUuid: rider.uuid, recovered: true, enteredAt }, { at: new Date(t0 + 15 * 60_000).toISOString() }),
    );
    expect(res.applied).toBe(true);

    const snap = await snapshot(owner, race.raceUuid);
    const r = snap.riders.find((x: { uuid: string }) => x.uuid === rider.uuid);
    expect(r.lapsCounter).toBe(3);
    expect(r.lapsDetails.map((l: { recovered?: boolean }) => !!l.recovered)).toEqual([false, true, false]);

    const ev = await db.one<{ payload: { recovered: boolean; enteredAt: string } }>(
      `SELECT payload FROM race_events WHERE "actionId" = $1`, [res.actionId],
    );
    expect(ev?.payload).toMatchObject({ recovered: true, enteredAt });
  });

  it("rejects unknown fields on AddLap (strict payload)", async () => {
    const race = await publishRace(owner, 1, 1, 5);
    const r = await import("./helpers").then(({ api, auth }) =>
      api().post(`/api/v1/races/${race.raceUuid}/actions`).set(auth(owner.token))
        .send({ actions: [action(race.raceUuid, "AddLap", { riderUuid: race.riders[0].uuid, recovered: "yes" })] }),
    );
    expect(r.status === 400 || r.body.results?.[0]?.applied === false).toBe(true);
  });
});
