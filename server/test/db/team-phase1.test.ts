/**
 * Commissaire 0.2 Phase 1 — original creator, creator-only delete, audit coverage
 * (RaceAdmin entries in race_events). Runs against the isolated test database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { action, addMember, api, auth, newUser, publishRace, send, startServer, stopServer, type TestUser } from "./helpers";
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
