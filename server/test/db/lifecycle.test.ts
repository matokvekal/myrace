/**
 * A whole race with several independently signed-in users: publish, invite,
 * roles + screens + waves, riders, categories, schedule, check-in, starts, laps
 * (incl. backdated Joker laps and late offline laps), undo, finish,
 * first-finish-all-finish, close-out, results, finalize and amendment,
 * conflicts and live delivery over Socket.IO.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  action, addMember, api, auth, collect, newUser, publishRace, riderOf, send, snapshot, socketFor, startServer, stopServer, T, until,
  type RaceFixture, type TestUser,
} from "./helpers";

const MIN = 60_000;
let owner: TestUser, counter: TestUser, starter: TestUser, checker: TestUser, spectator: TestUser;
let race: RaceFixture;
const sockets: import("socket.io-client").Socket[] = [];

beforeAll(async () => {
  await startServer();
  [owner, counter, starter, checker, spectator] = await Promise.all(["Owner", "Counter", "Starter", "Checker", "Spectator"].map((n) => newUser(n)));
  race = await publishRace(owner, 3, 3, 3);
  await addMember(owner, race.raceUuid, counter, ["counter"], { waves: [1] });
  await addMember(owner, race.raceUuid, starter, ["start"]);
  await addMember(owner, race.raceUuid, checker, ["checkin"]);
  await addMember(owner, race.raceUuid, spectator, [], { screens: { live: { view: true }, results: { view: true } }, waves: [3] });
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await stopServer();
});

const w1 = () => race.riders.filter((r) => r.heat === 1);
const cat = (heat: number) => race.cats.find((c) => c.heat === heat)!;

describe("setup by several members", () => {
  it("check-in commissaire checks riders in and fixes a bib; a duplicate bib is refused", async () => {
    const [a, b] = w1();
    const res = await send(checker, race.raceUuid,
      action(race.raceUuid, "RiderCheckedIn", { riderUuid: a.uuid, checked: true }),
      action(race.raceUuid, "RiderEdited", { riderUuid: a.uuid, changes: { bibNumber: 199 } }),
      action(race.raceUuid, "RiderEdited", { riderUuid: b.uuid, changes: { bibNumber: 199 } }));
    expect(res.map((r) => r.applied)).toEqual([true, true, false]);
    expect(res[2].reason).toBe("invalid");
    a.bibNumber = 199;
    const snap = await snapshot(owner, race.raceUuid);
    expect(riderOf(snap, a.uuid)).toMatchObject({ checked: true, bibNumber: 199 });
  });

  it("check-in may add a late entry but may not delete or bulk-import", async () => {
    const late = { uuid: randomUUID(), firstName: "Late", lastName: "Entry", bibNumber: 150, category: cat(1).name, heat: 1 };
    const res = await send(checker, race.raceUuid,
      action(race.raceUuid, "RiderAdded", { rider: late }),
      action(race.raceUuid, "RiderDeleted", { riderUuid: late.uuid }),
      action(race.raceUuid, "RidersImported", { riders: [], categories: [] }));
    expect(res.map((r) => r.reason)).toEqual([null, "forbidden", "forbidden"]);
    race.riders.push({ uuid: late.uuid, bibNumber: 150, category: cat(1).name, heat: 1 });
  });

  it("owner manages categories; start commissaire may only move start times", async () => {
    const extra = { uuid: randomUUID(), name: "Kids", heat: 3, laps: 1, startTime: "11:00" };
    let res = await send(owner, race.raceUuid, action(race.raceUuid, "CategoryAdded", { category: extra }));
    expect(res[0].applied).toBe(true);
    res = await send(starter, race.raceUuid,
      action(race.raceUuid, "CategoryEdited", { categoryUuid: extra.uuid, changes: { startTime: "11:15" } }),
      action(race.raceUuid, "CategoryEdited", { categoryUuid: extra.uuid, changes: { laps: 2 } }),
      action(race.raceUuid, "CategoryDeleted", { categoryUuid: extra.uuid }));
    expect(res.map((r) => r.reason)).toEqual([null, "forbidden", "forbidden"]);
    res = await send(owner, race.raceUuid, action(race.raceUuid, "CategoryDeleted", { categoryUuid: extra.uuid }));
    expect(res[0].applied).toBe(true);
  });

  it("a category with riders cannot be deleted", async () => {
    const res = await send(owner, race.raceUuid, action(race.raceUuid, "CategoryDeleted", { categoryUuid: cat(2).uuid }));
    expect(res[0]).toMatchObject({ applied: false, reason: "locked" });
  });
});

describe("race day", () => {
  let start: number;

  it("only start may start a wave; a second wave cannot start while one runs", async () => {
    start = Date.now() - 30 * MIN;
    let res = await send(counter, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 }, { at: new Date(start).toISOString() }));
    expect(res[0].reason).toBe("forbidden");
    res = await send(starter, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 }, { at: new Date(start).toISOString() }));
    expect(res[0].applied).toBe(true);
    res = await send(starter, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 2 }));
    expect(res[0]).toMatchObject({ applied: false, reason: "locked" });
    const snap = await snapshot(owner, race.raceUuid);
    expect(snap.categories.find((c: any) => c.heat === 1).status).toBe("running");
  });

  it("laps are timed by the device event time; laps under 60 s don't count; a duplicate tap from a second phone doesn't double count", async () => {
    const [a] = w1();
    const lapAt = (m: number) => new Date(start + m * MIN).toISOString();
    const res = await send(counter, race.raceUuid,
      action(race.raceUuid, "AddLap", { riderUuid: a.uuid }, { at: lapAt(8) }),
      action(race.raceUuid, "AddLap", { riderUuid: a.uuid }, { at: new Date(start + 8 * MIN + 1500).toISOString() })); // same crossing, other phone
    expect(res.every((r) => r.applied)).toBe(true);
    const r = riderOf(await snapshot(owner, race.raceUuid), a.uuid)!;
    expect(r.lapsCounter).toBe(1);
    expect(r.lapsDetails[0].lapTime).toBe("08:00");
    expect(r.elapsedTimeFromStart).toBe("08:00");
  });

  it("the clock offset corrects the device time; the event time is kept, not the arrival time", async () => {
    const [, b] = w1();
    // Device clock 2 minutes slow: it says start+7m, the measured offset adds 2 minutes → lap at 9:00.
    await send(counter, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: b.uuid }, { at: new Date(start + 7 * MIN).toISOString(), offset: 2 * MIN }));
    const r = riderOf(await snapshot(owner, race.raceUuid), b.uuid)!;
    expect(r.lapsDetails[0].lapTime).toBe("09:00");
    const h = await api().get(`/api/v1/races/${race.raceUuid}/history?riderUuid=${b.uuid}`).set(auth(owner.token));
    const ev = h.body.events.find((e: any) => e.type === "AddLap");
    expect(new Date(ev.eventAt).getTime()).toBe(start + 9 * MIN);
    expect(new Date(ev.serverReceivedAt).getTime()).toBeGreaterThan(start + 25 * MIN);
    expect(ev.clockCheck).toBeNull();
  });

  it("unreasonable clocks are flagged: a future time is held to arrival; a ±24 h+ offset is ignored", async () => {
    const [, , c] = w1();
    await send(counter, race.raceUuid,
      action(race.raceUuid, "AddLap", { riderUuid: c.uuid }, { at: new Date(start + 5 * MIN).toISOString(), offset: 3 * 86_400_000 }),
      action(race.raceUuid, "CommentSet", { riderUuid: c.uuid, comment: "x" }, { at: T(10 * MIN) }));
    const h = await api().get(`/api/v1/races/${race.raceUuid}/history?riderUuid=${c.uuid}`).set(auth(owner.token));
    const [lap, comment] = h.body.events;
    expect(lap.clockCheck).toBe("offset_ignored");
    expect(new Date(lap.eventAt).getTime()).toBe(start + 5 * MIN);
    expect(comment.clockCheck).toBe("future");
    expect(new Date(comment.deviceTime).getTime()).toBeGreaterThan(Date.now()); // the device's own time is kept
  });

  it("a Joker lap resolved later keeps its captured time and lands in order", async () => {
    const [a] = w1();
    // Lap 2 tapped live at 16:00, then a Joker captured at 15:00... is not a lap (under 60 s of 16:00? no — 15:00 is before it):
    await send(counter, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: a.uuid }, { at: new Date(start + 17 * MIN).toISOString() }));
    // Joker resolved now, captured at 12:30 — between lap 1 (8:00) and the 17:00 lap.
    await send(counter, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: a.uuid }, { at: new Date(start + 12.5 * MIN).toISOString() }));
    const r = riderOf(await snapshot(owner, race.raceUuid), a.uuid)!;
    expect(r.lapsDetails.map((l: any) => l.lapTime)).toEqual(["08:00", "04:30", "04:30"]);
    expect(r.lapsCounter).toBe(3);
    expect(r.raceStatus).toBe("finished"); // 3 laps = total
  });

  it("undo reverses exactly its target, whoever recorded laps since; undoing twice is refused", async () => {
    const [, b] = w1();
    // b: lap 1 at 9:00; the counter taps 13:00, the owner (another phone) taps 16:00.
    const lap2 = action(race.raceUuid, "AddLap", { riderUuid: b.uuid }, { at: new Date(start + 13 * MIN).toISOString() });
    await send(counter, race.raceUuid, lap2);
    await send(owner, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: b.uuid }, { at: new Date(start + 16 * MIN).toISOString() }));
    let r = riderOf(await snapshot(owner, race.raceUuid), b.uuid)!;
    expect(r.lapsCounter).toBe(3);
    const undo = await send(counter, race.raceUuid, action(race.raceUuid, "Undo", { targetActionId: lap2.actionId }));
    expect(undo[0].applied).toBe(true);
    r = riderOf(await snapshot(owner, race.raceUuid), b.uuid)!;
    expect(r.lapsDetails.map((l: any) => l.lapTime)).toEqual(["09:00", "07:00"]); // exactly the 13:00 lap removed
    const again = await send(counter, race.raceUuid, action(race.raceUuid, "Undo", { targetActionId: lap2.actionId }));
    expect(again[0]).toMatchObject({ applied: false, reason: "invalid" });
  });

  it("a counter cannot touch riders outside their waves, nor see them", async () => {
    const other = race.riders.find((r) => r.heat === 2)!;
    const res = await send(counter, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: other.uuid }));
    expect(res[0].reason).toBe("out_of_scope");
    const snap = await snapshot(counter, race.raceUuid);
    expect(snap.riders.every((r: any) => r.heat === 1)).toBe(true);
    expect(snap.categories.every((c: any) => c.heat === 1)).toBe(true);
  });

  it("status corrections: latest wins, never change laps; DNF is never inferred", async () => {
    const [, , c] = w1();
    const before = riderOf(await snapshot(owner, race.raceUuid), c.uuid)!.lapsCounter;
    await send(counter, race.raceUuid, action(race.raceUuid, "StatusCorrection", { riderUuid: c.uuid, status: "DNF" }));
    await send(owner, race.raceUuid, action(race.raceUuid, "StatusCorrection", { riderUuid: c.uuid, status: "running" }));
    const r = riderOf(await snapshot(owner, race.raceUuid), c.uuid)!;
    expect(r.status).toBe("standing");
    expect(r.raceStatus).toBe("running");
    expect(r.lapsCounter).toBe(before);
  });

  it("manual finish and its undo", async () => {
    const late = race.riders.find((r) => r.bibNumber === 150)!;
    await send(counter, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: late.uuid }, { at: new Date(start + 10 * MIN).toISOString() }));
    const fin = action(race.raceUuid, "RiderFinished", { riderUuid: late.uuid }, { at: new Date(start + 11 * MIN).toISOString() });
    await send(counter, race.raceUuid, fin);
    expect(riderOf(await snapshot(owner, race.raceUuid), late.uuid)!.raceStatus).toBe("finished");
    await send(counter, race.raceUuid, action(race.raceUuid, "Undo", { targetActionId: fin.actionId }));
    expect(riderOf(await snapshot(owner, race.raceUuid), late.uuid)!.raceStatus).toBe("running");
  });

  it("first finish, all finish: after the leader finished, others finish on their next crossing", async () => {
    const [, b] = w1();
    // The leader (a) finished all 3 laps at 17:00. b has 2 laps; its next crossing finishes it, and
    // a crossing after that is kept in the log but not counted.
    await send(counter, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: b.uuid }, { at: new Date(start + 22 * MIN).toISOString() }));
    await send(counter, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: b.uuid }, { at: new Date(start + 26 * MIN).toISOString() }));
    const r = riderOf(await snapshot(owner, race.raceUuid), b.uuid)!;
    expect(r.lapsCounter).toBe(3);
    expect(r.raceStatus).toBe("finished");
  });

  it("finishing the wave closes out riders still on track as finishers, never DNF", async () => {
    const late = race.riders.find((r) => r.bibNumber === 150)!;
    const res = await send(starter, race.raceUuid, action(race.raceUuid, "WaveFinished", { heat: 1 }, { at: new Date(start + 29 * MIN).toISOString() }));
    expect(res[0].applied).toBe(true);
    const r = riderOf(await snapshot(owner, race.raceUuid), late.uuid)!;
    expect(r).toMatchObject({ raceStatus: "finished", status: "finished", lapsCounter: 1 });
  });

  it("results rank more laps first, then earlier arrival", async () => {
    const res = await api().get(`/api/v1/races/${race.raceUuid}/results`).set(auth(owner.token));
    const wave1 = res.body.categories.find((c: any) => c.category.heat === 1);
    const order = wave1.riders.map((r: any) => r.bibNumber);
    expect(order.slice(0, 2)).toEqual([199, 102]); // 3 laps at 17:00, 3 laps at 22:00
  });
});

describe("what each member receives", () => {
  it("the spectator sees only wave 3 on Live/Results, without private details or organizer contact", async () => {
    const snap = await snapshot(spectator, race.raceUuid);
    expect(snap.riders.length).toBeGreaterThan(0);
    expect(snap.riders.every((r: any) => r.heat === 3)).toBe(true);
    expect(snap.riders[0]).not.toHaveProperty("comment");
    expect(snap.riders[0]).not.toHaveProperty("chipNumber");
    expect(snap.riders[0]).toHaveProperty("lapsCounter");
    expect(snap.race).not.toHaveProperty("phone");
    expect(snap.race).not.toHaveProperty("joinCode");
    const hist = await api().get(`/api/v1/races/${race.raceUuid}/history`).set(auth(spectator.token));
    expect(hist.status).toBe(403);
    const members = await api().get(`/api/v1/races/${race.raceUuid}/members`).set(auth(spectator.token));
    expect(members.status).toBe(403);
  });

  it("live updates reach each member filtered: wave-3 changes reach the spectator, wave-1 changes do not", async () => {
    const [sCounter, sSpectator] = await Promise.all([socketFor(counter), socketFor(spectator)]);
    sockets.push(sCounter, sSpectator);
    await sCounter.emitWithAck("join", { raceUuid: race.raceUuid });
    await sSpectator.emitWithAck("join", { raceUuid: race.raceUuid });
    const gotCounter = collect(sCounter, "race:changes");
    const gotSpectator = collect(sSpectator, "race:changes");
    const w3 = race.riders.find((r) => r.heat === 3)!;
    await send(owner, race.raceUuid, action(race.raceUuid, "CommentSet", { riderUuid: w3.uuid, comment: "wave 3 note" }));
    await until(() => gotCounter.length > 0 && gotSpectator.length > 0);
    // Both advance their cursor; only the spectator gets the wave-3 rider, and without the comment.
    expect(gotCounter[0].riders).toEqual([]);
    expect(gotSpectator[0].riders.map((r: any) => r.uuid)).toEqual([w3.uuid]);
    expect(gotSpectator[0].riders[0]).not.toHaveProperty("comment");
    expect(gotCounter[0].seq).toBe(gotSpectator[0].seq);
  });

  it("changing a member's access reaches their open socket; revoking closes it", async () => {
    const s = await socketFor(checker);
    sockets.push(s);
    await s.emitWithAck("join", { raceUuid: race.raceUuid });
    const access = collect(s, "race:access");
    const revoked = collect(s, "race:revoked");
    await api().patch(`/api/v1/races/${race.raceUuid}/members/${checker.id}`).set(auth(owner.token)).send({ roles: ["viewer"], permissions: { waves: [2] } });
    await until(() => access.length > 0);
    expect(access[0].access.roles).toEqual(["viewer"]);
    expect(access[0].access.waves).toEqual([2]);
    const write = await send(checker, race.raceUuid, action(race.raceUuid, "RiderCheckedIn", { riderUuid: race.riders.find((r) => r.heat === 2)!.uuid, checked: true }));
    expect(write[0].reason).toBe("forbidden");
    await api().delete(`/api/v1/races/${race.raceUuid}/members/${checker.id}`).set(auth(owner.token));
    await until(() => revoked.length > 0);
    expect((await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(checker.token))).status).toBe(404);
    // What a revoked member recorded offline is kept but not applied (FR-12).
    const late = await send(checker, race.raceUuid, action(race.raceUuid, "CommentSet", { riderUuid: race.riders[0].uuid, comment: "offline" }));
    expect(late[0].reason).toBe("not_member");
  });

  it("the owner cannot be changed or removed by an admin", async () => {
    const admin = await newUser("Admin");
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    expect((await api().patch(`/api/v1/races/${race.raceUuid}/members/${owner.id}`).set(auth(admin.token)).send({ roles: ["viewer"] })).status).toBe(403);
    expect((await api().delete(`/api/v1/races/${race.raceUuid}/members/${owner.id}`).set(auth(admin.token))).status).toBe(403);
  });
});

describe("offline delivery and conflicts", () => {
  it("a batch re-sent after a lost answer is applied once (idempotent)", async () => {
    const r = race.riders.find((x) => x.heat === 3)!;
    const a = action(race.raceUuid, "CommentSet", { riderUuid: r.uuid, comment: "once" });
    const first = await send(owner, race.raceUuid, a);
    const again = await send(owner, race.raceUuid, a);
    expect(again[0].seq).toBe(first[0].seq);
  });

  it("concurrent batches from three members get a gap-free sequence", async () => {
    const r3 = race.riders.filter((x) => x.heat === 3);
    const before = (await snapshot(owner, race.raceUuid)).lastSeq;
    const batches = [owner, starter, owner].map((u, i) =>
      send(u, race.raceUuid, ...Array.from({ length: 5 }, (_, j) => action(race.raceUuid, u === starter ? "CategoryEdited" : "CommentSet",
        u === starter ? { categoryUuid: cat(3).uuid, changes: { startTime: `12:0${j}` } } : { riderUuid: r3[j % r3.length].uuid, comment: `c${i}${j}` }))));
    const results = (await Promise.all(batches)).flat();
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 15 }, (_, i) => before + 1 + i));
  });

  it("an old app version is told to update; nothing is stored", async () => {
    const r = await api().post(`/api/v1/races/${race.raceUuid}/actions`).set(auth(owner.token))
      .send({ actions: [{ ...action(race.raceUuid, "CommentSet", { riderUuid: race.riders[0].uuid, comment: "v9" }), protocolVersion: 9 }] });
    expect(r.status).toBe(426);
  });

  it("a malformed item is refused on its own without blocking the rest", async () => {
    const res = await send(owner, race.raceUuid,
      action(race.raceUuid, "CommentSet", { riderUuid: race.riders[0].uuid, comment: "ok", idNumber: "123456789" }),
      action(race.raceUuid, "CommentSet", { riderUuid: race.riders[0].uuid, comment: "fine" }));
    expect(res.map((r) => r.reason)).toEqual(["invalid", null]);
  });
});

describe("official results", () => {
  it("only the owner finalizes; later changes are held back; an amendment includes a late offline lap at its original time", async () => {
    expect((await api().post(`/api/v1/races/${race.raceUuid}/finalize`).set(auth(starter.token))).status).toBe(403);
    const fin = await api().post(`/api/v1/races/${race.raceUuid}/finalize`).set(auth(owner.token));
    expect(fin.status).toBe(201);
    expect(fin.body.official.officialVersion).toBe(1);
    // A lap recorded offline during the race arrives after finalize.
    const r3 = race.riders.find((x) => x.heat === 3)!;
    const snapBefore = await snapshot(owner, race.raceUuid);
    expect(riderOf(snapBefore, r3.uuid)!.raceStatus).not.toBe("running"); // wave 3 never started: closed out
    const w1rider = w1()[2];
    const lateLap = action(race.raceUuid, "AddLap", { riderUuid: w1rider.uuid }, { at: new Date(Date.now() - 20 * MIN).toISOString() });
    const held = await send(counter, race.raceUuid, lateLap);
    expect(held[0].reason).toBe("race_official");
    const amend = await api().post(`/api/v1/races/${race.raceUuid}/amend`).set(auth(owner.token)).send({ reason: "late lap from offline phone", includeActionIds: [lateLap.actionId] });
    expect(amend.status).toBe(201);
    expect(amend.body.official).toMatchObject({ officialVersion: 2, prevToken: fin.body.official.token });
    const official = await api().get(`/api/v1/races/${race.raceUuid}/official`).set(auth(owner.token));
    expect(official.body.versions).toHaveLength(2);
    expect(official.body.publicKey).toContain("BEGIN PUBLIC KEY");
  });
});
