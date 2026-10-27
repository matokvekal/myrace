/**
 * Race lifecycle around the shared data: publish, My Races, join codes,
 * ownership transfer, delete, and verifying the signature on official results.
 * Riders are synthetic.
 */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, api, auth, newUser, publishRace, snapshot, startServer, stopServer, type TestUser } from "./helpers";

let owner: TestUser, admin: TestUser, counter: TestUser, outsider: TestUser;

beforeAll(async () => {
  await startServer();
  [owner, admin, counter, outsider] = await Promise.all(["Owner", "Admin", "Counter", "Outsider"].map((n) => newUser(n)));
});
afterAll(() => stopServer());

const cat = () => ({ uuid: randomUUID(), name: "Elite", heat: 1, laps: 2, startTime: "10:00" });
const rider = (c: { name: string }, bib: number, extra: Record<string, unknown> = {}) =>
  ({ uuid: randomUUID(), firstName: "Test", lastName: `R${bib}`, bibNumber: bib, category: c.name, heat: 1, ...extra });

describe("publish", () => {
  it("an ID number or unknown rider field is refused, and nothing is stored", async () => {
    const c = cat();
    for (const extra of [{ nationalId: "000000018" }, { passport: "X0000000" }, { birthDate: "2000-01-01" }]) {
      const r = await api().post("/api/v1/races/publish").set(auth(owner.token))
        .send({ race: { name: "Bad" }, categories: [c], riders: [rider(c, 1, extra)] });
      expect(r.status).toBe(400);
    }
    const mine = await api().get("/api/v1/races").set(auth(owner.token));
    expect(mine.body.races.map((x: any) => x.race.name)).not.toContain("Bad");
  });

  it("publishing the same local race twice is refused (409); duplicate bibs are reported", async () => {
    const c = cat();
    const body = { race: { name: "Twice" }, categories: [c], riders: [rider(c, 7), rider(c, 7)] };
    const first = await api().post("/api/v1/races/publish").set(auth(owner.token)).send(body);
    expect(first.status).toBe(201);
    expect(first.body.duplicateBibs).toBe(true);
    const again = await api().post("/api/v1/races/publish").set(auth(owner.token)).send(body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_published");
  });
});

describe("My Races and join codes", () => {
  it("lists owned and joined races with my access; a revoked member no longer sees the race", async () => {
    const race = await publishRace(owner, 2, 1, 2);
    await addMember(owner, race.raceUuid, counter, ["counter"], { waves: [2] });
    const listed = async (u: TestUser) => (await api().get("/api/v1/races").set(auth(u.token))).body.races.map((x: any) => x.race.uuid);
    expect(await listed(owner)).toContain(race.raceUuid);
    expect(await listed(counter)).toContain(race.raceUuid);
    expect(await listed(outsider)).not.toContain(race.raceUuid);
    const del = await api().delete(`/api/v1/races/${race.raceUuid}/members/${counter.id}`).set(auth(owner.token));
    expect(del.status).toBeLessThan(300);
    expect(await listed(counter)).not.toContain(race.raceUuid);
    expect((await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(counter.token))).status).toBe(404);
  });

  it("a join code finds the race for members only; a new code retires the old one", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    await addMember(owner, race.raceUuid, counter, ["counter"]);
    const code = (await snapshot(owner, race.raceUuid)).race.joinCode as string;
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    expect((await api().get(`/api/v1/races/join/${code.toLowerCase()}`).set(auth(counter.token))).body.raceUuid).toBe(race.raceUuid);
    expect((await api().get(`/api/v1/races/join/${code}`).set(auth(outsider.token))).status).toBe(404);
    expect((await api().post(`/api/v1/races/${race.raceUuid}/join-code`).set(auth(counter.token))).status).toBe(403);
    const fresh = await api().post(`/api/v1/races/${race.raceUuid}/join-code`).set(auth(owner.token));
    expect(fresh.body.joinCode).not.toBe(code);
    expect((await api().get(`/api/v1/races/join/${code}`).set(auth(counter.token))).status).toBe(404);
    expect((await api().get(`/api/v1/races/join/${fresh.body.joinCode}`).set(auth(counter.token))).status).toBe(200);
  });
});

describe("ownership and delete", () => {
  it("only the owner transfers, and only to an active member; the old owner stays as admin", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    const transfer = (by: TestUser, userId: string) => api().post(`/api/v1/races/${race.raceUuid}/transfer`).set(auth(by.token)).send({ userId });
    expect((await transfer(admin, admin.id)).status).toBe(403);
    expect((await transfer(owner, outsider.id)).status).toBe(400);
    const ok = await transfer(owner, admin.id);
    expect(ok.status).toBe(200);
    expect(ok.body.ownerUserId).toBe(admin.id);
    // The new owner can delete; the old owner (now admin) cannot.
    expect((await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(owner.token))).status).toBe(403);
    expect((await snapshot(owner, race.raceUuid)).race.uuid).toBe(race.raceUuid);
  });

  it("delete is owner-only and removes the race for every member", async () => {
    const race = await publishRace(owner, 1, 2, 2);
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    expect((await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(admin.token))).status).toBe(403);
    expect((await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(owner.token))).status).toBe(204);
    for (const u of [owner, admin]) expect((await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(u.token))).status).toBe(404);
  });
});

describe("official results can be verified", () => {
  it("the token is SHA-256 of the payload and the signature verifies with the published public key", async () => {
    const race = await publishRace(owner, 1, 2, 2);
    expect((await api().post(`/api/v1/races/${race.raceUuid}/finalize`).set(auth(owner.token))).status).toBe(201);
    const off = (await api().get(`/api/v1/races/${race.raceUuid}/official`).set(auth(owner.token))).body;
    const v = off.versions[0];
    expect(createHash("sha256").update(v.payload).digest("hex")).toBe(v.token);
    const pub = createPublicKey(off.publicKey);
    expect(verify(null, Buffer.from(v.token), pub, Buffer.from(v.signature, "base64"))).toBe(true);
    expect(verify(null, Buffer.from(v.token.replace(/.$/, (ch: string) => (ch === "0" ? "1" : "0"))), pub, Buffer.from(v.signature, "base64"))).toBe(false);
  });
});
