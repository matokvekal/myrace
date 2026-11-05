/**
 * Commissaire 0.2 Phase 1 — original creator, creator-only delete, audit coverage
 * (RaceAdmin entries in race_events). Runs against the isolated test database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { action, addMember, api, auth, collect, newUser, publishRace, send, socketFor, startServer, stopServer, until, type TestUser } from "./helpers";
import { db } from "../../src/db/pool";

let owner: TestUser, admin: TestUser, counter: TestUser, outsider: TestUser;

beforeAll(async () => {
  await startServer();
  owner = await newUser("P1Owner");
  admin = await newUser("P1Admin");
  counter = await newUser("P1Counter");
  outsider = await newUser("P1Outsider");
});
afterAll(stopServer);

const adminEvents = (raceUuid: string) =>
  db.query<{ seq: number; userId: string; payload: Record<string, unknown>; applied: boolean }>(
    `SELECT seq, "userId", payload, applied FROM race_events WHERE "raceUuid" = $1 AND type = 'RaceAdmin' ORDER BY seq`,
    [raceUuid],
  );
const creatorOf = async (raceUuid: string) =>
  (await db.one<{ createdByUserId: string | null }>(`SELECT "createdByUserId" FROM races WHERE uuid = $1`, [raceUuid]))!.createdByUserId;

describe("original creator", () => {
  it("is recorded on publish and on create, and survives an ownership transfer", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    expect(await creatorOf(race.raceUuid)).toBe(owner.id);
    const created = await api().post("/api/v1/races").set(auth(owner.token)).send({ name: "Empty" });
    expect(created.status).toBe(201);
    expect(await creatorOf(created.body.race.uuid)).toBe(owner.id);

    await addMember(owner, race.raceUuid, admin, ["admin"]);
    expect((await api().post(`/api/v1/races/${race.raceUuid}/transfer`).set(auth(owner.token)).send({ userId: admin.id })).status).toBe(200);
    expect(await creatorOf(race.raceUuid)).toBe(owner.id); // owner changed, creator did not
    // Race edits by the new owner never touch it either.
    await send(admin, race.raceUuid, action(race.raceUuid, "RaceEdited", { changes: { name: "Renamed" } }));
    expect(await creatorOf(race.raceUuid)).toBe(owner.id);
  });

  it("access summary tells the app who is the creator", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    const mine = await api().get(`/api/v1/races/${race.raceUuid}`).set(auth(owner.token));
    expect(mine.body.access).toMatchObject({ isOwner: true, isCreator: true, memberWrites: false });
    const theirs = await api().get(`/api/v1/races/${race.raceUuid}`).set(auth(admin.token));
    expect(theirs.body.access).toMatchObject({ isOwner: false, isCreator: false });
  });
});

describe("creator-only delete", () => {
  it("after a transfer: the new owner only hides; the creator deletes for everyone, even after being removed", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    await api().post(`/api/v1/races/${race.raceUuid}/transfer`).set(auth(owner.token)).send({ userId: admin.id });
    // The new owner removes the creator from the race.
    expect((await api().delete(`/api/v1/races/${race.raceUuid}/members/${owner.id}`).set(auth(admin.token))).status).toBe(204);
    const hide = await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(admin.token));
    expect(hide.body.deleted).toBe("hidden");
    const del = await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(owner.token));
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe("race");
    expect((await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(admin.token))).status).toBe(410);
  });

  it("admins, judges and outsiders can't delete for everyone", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    await addMember(owner, race.raceUuid, counter, ["counter"]);
    for (const u of [admin, counter]) expect((await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(u.token))).body.deleted).toBe("hidden");
    expect((await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(outsider.token))).status).toBe(404);
    const snap = await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(owner.token));
    expect(snap.status).toBe(200);
  });

  it("a legacy race with an unknown creator: the current owner may delete it (0.1.x behaviour)", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    await db.query(`UPDATE races SET "createdByUserId" = NULL WHERE uuid = $1`, [race.raceUuid]);
    expect((await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(owner.token))).body.deleted).toBe("race");
  });
});

describe("audit: sensitive operations write one RaceAdmin entry each", () => {
  it("publish, unpublish, join code, invitations, transfer, hide, delete — with the right actor, and no secrets", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    const u = (path: string) => `/api/v1/races/${race.raceUuid}${path}`;
    await api().put(u("/publication")).set(auth(owner.token)).send({ published: true });
    await api().put(u("/publication")).set(auth(owner.token)).send({ published: true }); // no change → no entry
    await api().put(u("/publication")).set(auth(owner.token)).send({ published: false });
    const code = await api().post(u("/join-code")).set(auth(owner.token));
    const inv = await api().post(u("/invitations")).set(auth(owner.token)).send({ userIds: [counter.id], roles: ["counter"], sendEmail: false });
    expect(inv.status).toBe(201);
    const invId = inv.body.invitations[0].id;
    const secret = String(inv.body.invitations[0].url).split("/").pop()!;
    expect((await api().delete(u(`/invitations/${invId}`)).set(auth(owner.token))).status).toBe(204);
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    await api().post(u("/transfer")).set(auth(owner.token)).send({ userId: admin.id });
    await api().delete(u("")).set(auth(admin.token)); // hide (new owner, not creator)
    await api().delete(u("")).set(auth(owner.token)); // delete (creator)

    const events = await adminEvents(race.raceUuid);
    const ops = events.map((e) => e.payload.op);
    expect(ops).toEqual(["published", "unpublished", "joinCodeRotated", "invitationCreated", "invitationRevoked", "invitationCreated", "ownerTransferred", "hidden", "deleted"]);
    expect(events.every((e) => e.applied)).toBe(true);
    const actors = events.map((e) => e.userId);
    expect(actors.slice(0, 7).every((a) => a === owner.id)).toBe(true);
    expect(actors[7]).toBe(admin.id);
    expect(actors[8]).toBe(owner.id);
    expect(events[6].payload).toMatchObject({ from: owner.id, to: admin.id });
    const all = JSON.stringify(events);
    expect(all).not.toContain(secret);
    expect(all).not.toContain(code.body.joinCode);
  });

  it("a refused operation writes nothing", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    await addMember(owner, race.raceUuid, counter, ["counter"]);
    const u = (path: string) => `/api/v1/races/${race.raceUuid}${path}`;
    expect((await api().put(u("/publication")).set(auth(counter.token)).send({ published: true })).status).toBe(403);
    expect((await api().post(u("/join-code")).set(auth(counter.token))).status).toBe(403);
    expect((await api().post(u("/transfer")).set(auth(counter.token)).send({ userId: counter.id })).status).toBe(403);
    expect((await api().post(u("/invitations")).set(auth(counter.token)).send({ userIds: [outsider.id] })).status).toBe(403);
    expect((await api().put(u("/publication")).set(auth(outsider.token)).send({ published: true })).status).toBe(404);
    expect((await adminEvents(race.raceUuid)).filter((e) => e.payload.op !== "invitationCreated")).toEqual([]);
    expect(await adminEvents(race.raceUuid)).toHaveLength(1); // only the owner's addMember invitation
  });

  it("a device can't write a RaceAdmin entry", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    const r = await send(owner, race.raceUuid, action(race.raceUuid, "RaceAdmin", { op: "published" }));
    expect(r[0]).toMatchObject({ applied: false, reason: "invalid" });
  });
});

describe("admin delegation: only the current owner", () => {
  it("a delegated admin can't grant admin, change/remove an admin, or open Team writes; the owner can", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    const u = (path: string) => `/api/v1/races/${race.raceUuid}${path}`;
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    await addMember(owner, race.raceUuid, counter, ["counter"]);
    const other = await newUser("P1Admin2");
    await addMember(owner, race.raceUuid, other, ["admin"]);
    // Delegated admins manage members only where the owner turned member writes on (per race).
    await db.query(`UPDATE races SET "memberWrites" = true WHERE uuid = $1`, [race.raceUuid]);

    const refused = async (r: { status: number; body: { error?: { code?: string } } }) => {
      expect(r.status).toBe(403);
      expect(r.body.error?.code).toBe("owner_only_admin");
    };
    await refused(await api().patch(u(`/members/${counter.id}`)).set(auth(admin.token)).send({ roles: ["admin"] }));
    await refused(await api().patch(u(`/members/${counter.id}`)).set(auth(admin.token)).send({ permissions: { screens: { team: { update: true } } } }));
    await refused(await api().patch(u(`/members/${other.id}`)).set(auth(admin.token)).send({ roles: ["viewer"] }));
    await refused(await api().delete(u(`/members/${other.id}`)).set(auth(admin.token)));
    await refused(await api().post(u("/invitations")).set(auth(admin.token)).send({ link: true, roles: ["admin"], sendEmail: false }));
    // Ordinary judges stay manageable by a delegated admin.
    expect((await api().patch(u(`/members/${counter.id}`)).set(auth(admin.token)).send({ roles: ["counter", "results"] })).status).toBe(200);
    expect((await api().post(u("/invitations")).set(auth(admin.token)).send({ link: true, roles: ["results"], sendEmail: false })).status).toBe(201);
    // The owner can do all of it.
    expect((await api().patch(u(`/members/${counter.id}`)).set(auth(owner.token)).send({ roles: ["admin"] })).status).toBe(200);
    expect((await api().delete(u(`/members/${other.id}`)).set(auth(owner.token))).status).toBe(204);
  });
});

describe("Results judge", () => {
  it("corrects laps and statuses; can't record laps, start, finalize or amend", async () => {
    const race = await publishRace(owner, 1, 2, 2);
    const judge = await newUser("P1Results");
    await addMember(owner, race.raceUuid, judge, ["results"]);
    await db.query(`UPDATE races SET "memberWrites" = true WHERE uuid = $1`, [race.raceUuid]); // per-race switch (route comes in T3)
    await send(owner, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 }));
    const r = race.riders[0].uuid;
    const res = await send(judge, race.raceUuid,
      action(race.raceUuid, "LapCountCorrection", { riderUuid: r, laps: 1 }),
      action(race.raceUuid, "StatusCorrection", { riderUuid: r, status: "DSQ" }),
      action(race.raceUuid, "AddLap", { riderUuid: race.riders[1].uuid }),
      action(race.raceUuid, "WaveFinished", { heat: 1 }),
    );
    expect(res.map((x) => x.reason)).toEqual([null, null, "forbidden", "forbidden"]);
    expect((await api().post(`/api/v1/races/${race.raceUuid}/finalize`).set(auth(judge.token))).status).toBe(403);
    expect((await api().post(`/api/v1/races/${race.raceUuid}/amend`).set(auth(judge.token)).send({ reason: "late lap", includeActionIds: [] })).status).toBe(403);
  });
});

describe("delete and audit edge cases (QA)", () => {
  it("a finished race deleted by its creator is only hidden; a repeated delete after a soft delete is 410", async () => {
    const fin = await publishRace(owner, 1, 1, 2);
    await db.query(`UPDATE races SET status = 'finished' WHERE uuid = $1`, [fin.raceUuid]);
    expect((await api().delete(`/api/v1/races/${fin.raceUuid}`).set(auth(owner.token))).body.deleted).toBe("hidden");
    const act = await publishRace(owner, 1, 1, 2);
    expect((await api().delete(`/api/v1/races/${act.raceUuid}`).set(auth(owner.token))).body.deleted).toBe("race");
    expect((await api().delete(`/api/v1/races/${act.raceUuid}`).set(auth(owner.token))).status).toBe(410);
  });

  it("unpublishing an unpublished race writes no audit entry", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    expect((await api().put(`/api/v1/races/${race.raceUuid}/publication`).set(auth(owner.token)).send({ published: false })).status).toBe(200);
    expect(await adminEvents(race.raceUuid)).toEqual([]);
  });

  it("a transfer announces its own audit seq to joined devices", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    const r = await api().post(`/api/v1/races/${race.raceUuid}/transfer`).set(auth(owner.token)).send({ userId: admin.id });
    expect(r.status).toBe(200);
    const ev = (await adminEvents(race.raceUuid)).find((e) => e.payload.op === "ownerTransferred")!;
    const last = await db.one<{ lastSeq: number }>(`SELECT "lastSeq" FROM races WHERE uuid = $1`, [race.raceUuid]);
    expect(ev.seq).toBe(Number(last!.lastSeq));
  });

  it("the results role is accepted by both role CHECK constraints", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    const inv = await api().post(`/api/v1/races/${race.raceUuid}/invitations`).set(auth(owner.token)).send({ userIds: [outsider.id], roles: ["results"], sendEmail: false });
    expect(inv.status).toBe(201);
    await db.query(`UPDATE race_members SET roles = '{results}' WHERE "raceUuid" = $1 AND "userId" = $2`, [race.raceUuid, owner.id]);
  });
});

describe("member writes are per race (decision 1)", () => {
  it("off by default; owner switches it on/off; open sockets get the new access; other races unaffected", async () => {
    const a = await publishRace(owner, 1, 2, 2);
    const b = await publishRace(owner, 1, 2, 2);
    const judge = await newUser("P1Judge");
    for (const r of [a, b]) await addMember(owner, r.raceUuid, judge, ["start"]);
    const set = (u: TestUser, raceUuid: string, enabled: boolean) =>
      api().put(`/api/v1/races/${raceUuid}/member-writes`).set(auth(u.token)).send({ enabled });

    const s = await socketFor(judge);
    try {
      await s.emitWithAck("join", { raceUuid: a.raceUuid });
      const access = collect(s, "race:access");
      // Off: read-only, as in 0.1.x.
      expect((await send(judge, a.raceUuid, action(a.raceUuid, "WaveStarted", { heat: 1 })))[0].reason).toBe("forbidden");
      // Only the owner may switch it.
      expect((await set(judge, a.raceUuid, true)).status).toBe(403);
      expect((await set(owner, a.raceUuid, true)).status).toBe(200);
      await until(() => access.length > 0);
      expect(access.at(-1).access).toMatchObject({ memberWrites: true });
      expect(access.at(-1).access.screens.start.update).toBe(true);
      expect((await send(judge, a.raceUuid, action(a.raceUuid, "WaveStarted", { heat: 1 })))[0].applied).toBe(true);
      // The other race of the same owner is still read-only for the judge.
      expect((await send(judge, b.raceUuid, action(b.raceUuid, "WaveStarted", { heat: 1 })))[0].reason).toBe("forbidden");
      // Switching off again closes writes at once.
      const n = access.length;
      expect((await set(owner, a.raceUuid, false)).status).toBe(200);
      await until(() => access.length > n);
      expect((await send(judge, a.raceUuid, action(a.raceUuid, "WaveFinished", { heat: 1 })))[0].reason).toBe("forbidden");
      // Audited once per real change (repeat = no entry).
      await set(owner, a.raceUuid, false);
      const ops = (await adminEvents(a.raceUuid)).filter((e) => e.payload.op === "memberWritesChanged").map((e) => e.payload.enabled);
      expect(ops).toEqual([true, false]);
    } finally {
      s.disconnect();
    }
  });
});
