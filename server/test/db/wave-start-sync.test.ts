/**
 * Regression (2026-11-04, "missing rider cards"): categories imported without a
 * wave column have heat null on the server. The phone started "wave 1" from
 * start times; the server matched categories by heat only, started nothing, and
 * its rows later reset the phone's riders to "upcoming". Now WaveStarted with
 * named categories starts them and gives them the wave.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { action, api, auth, newUser, riderOf, send, snapshot, startServer, stopServer, T } from "./helpers";

beforeAll(startServer);
afterAll(stopServer);

async function publishWaveless(owner: Awaited<ReturnType<typeof newUser>>) {
  const cats = ["Kids", "Youth"].map((name, i) => ({ uuid: randomUUID(), name, laps: 2, startTime: i === 0 ? "09:00" : "09:05" })); // no heat
  const riders = cats.flatMap((c, ci) => Array.from({ length: 5 }, (_, j) => ({ uuid: randomUUID(), firstName: "R", lastName: `${c.name}${j}`, bibNumber: 100 * (ci + 1) + j, category: c.name })));
  const r = await api().post("/api/v1/races/publish").set(auth(owner.token)).send({ race: { name: "Waveless", date: "2026-11-04" }, categories: cats, riders });
  expect(r.status).toBe(201);
  return { raceUuid: r.body.race.uuid as string, cats, riders };
}

describe("starting a wave whose categories have no wave yet", () => {
  it("named categories start on the server and take the wave; laps and statuses then count", async () => {
    const owner = await newUser("Starter");
    const { raceUuid, cats, riders } = await publishWaveless(owner);
    const before = await snapshot(owner, raceUuid);
    expect(before.categories.every((c: { heat: number | null }) => !c.heat)).toBe(true);

    const [started] = await send(owner, raceUuid, action(raceUuid, "WaveStarted", { heat: 1, categoryUuids: cats.map((c) => c.uuid) }, { at: T(-60_000) }));
    expect(started.applied).toBe(true);
    const snap = await snapshot(owner, raceUuid);
    for (const c of snap.categories) expect(c).toMatchObject({ heat: 1, status: "running" });
    for (const r of riders) expect(riderOf(snap, r.uuid)!.timeStartRace).toBeTruthy();

    const lapResults = await send(owner, raceUuid, ...riders.map((r) => action(raceUuid, "AddLap", { riderUuid: r.uuid })));
    expect(lapResults.every((x) => x.applied)).toBe(true);
    await send(owner, raceUuid, action(raceUuid, "StatusCorrection", { riderUuid: riders[0].uuid, status: "DNF" }));
    const after = await snapshot(owner, raceUuid);
    expect(riders.filter((r) => riderOf(after, r.uuid)!.lapsCounter === 1)).toHaveLength(riders.length);
    expect(riderOf(after, riders[0].uuid)!.status).toBe("DNF");
    expect(after.riders.filter((r: { raceStatus: string }) => r.raceStatus === "upcoming")).toHaveLength(0);
  });

  it("only one wave runs at a time: a second wave is refused while the first is running", async () => {
    const owner = await newUser("OneWave");
    const { raceUuid, cats } = await publishWaveless(owner);
    await send(owner, raceUuid, action(raceUuid, "WaveStarted", { heat: 1, categoryUuids: [cats[0].uuid] }));
    const [second] = await send(owner, raceUuid, action(raceUuid, "WaveStarted", { heat: 2, categoryUuids: [cats[1].uuid] }));
    expect(second).toMatchObject({ applied: false, reason: "locked" });
  });

  it("the changes feed gives another device the started riders (no reset to upcoming)", async () => {
    const owner = await newUser("Feed");
    const { raceUuid, cats, riders } = await publishWaveless(owner);
    const base = (await snapshot(owner, raceUuid)).lastSeq as number;
    await send(owner, raceUuid, action(raceUuid, "WaveStarted", { heat: 1, categoryUuids: cats.map((c) => c.uuid) }));
    const ch = await api().get(`/api/v1/races/${raceUuid}/changes?afterSeq=${base}`).set(auth(owner.token));
    expect(ch.status).toBe(200);
    const byUuid = new Map(ch.body.riders.map((r: { uuid: string }) => [r.uuid, r]));
    for (const r of riders) expect((byUuid.get(r.uuid) as { raceStatus: string }).raceStatus).not.toBe("upcoming");
  });
});
