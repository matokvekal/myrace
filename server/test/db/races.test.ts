/**
 * Race lifecycle around the shared data: publish, My Races, join codes,
 * ownership transfer, delete, and verifying the signature on official results.
 * Riders are synthetic.
 */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { action, addMember, api, auth, newUser, publishRace, send, snapshot, startServer, stopServer, type TestUser } from "./helpers";

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

  it("a race just created on a phone (no start list yet) is stored and can be opened from another browser", async () => {
    // What Create Race sends for a race with no categories/riders yet.
    const info = {
      raceId: "20261102-mobile", owner: "1", name: "Mobile Race", location: "TBD", time: "08:00", date: "2026-11-02",
      image: "images/bike.jpg", heat: "1", type: "Competition", raceType: "MTB", level: "1", orgenizer: "Race Org",
      manager: "John Doe", phone: "000-000-0000", takanon: "", site: "", map: "", distance: 0, isActive: true,
      autoColor: true, leaderFinishAll: null, minLapSeconds: 180,
    };
    const created = await api().post("/api/v1/races/publish").set(auth(owner.token)).send({ race: info, categories: [], riders: [] });
    expect(created.status).toBe(201);
    const raceUuid = created.body.race.uuid as string;

    // Same account, second browser: a fresh sign-in sees the race and its (empty) start list.
    const login = await api().post("/api/v1/auth/login").send({ email: owner.email, password: "password-123", deviceId: "browser-2" });
    expect(login.status).toBe(200);
    const other = { ...owner, token: login.body.accessToken as string };
    const mine = await api().get("/api/v1/races").set(auth(other.token));
    expect(mine.body.races.find((x: any) => x.race.uuid === raceUuid)?.race.name).toBe("Mobile Race");

    // The start list arrives later as Actions and is visible there too.
    const c = cat();
    const [res] = await send(owner, raceUuid, action(raceUuid, "CategoryAdded", { category: c }));
    expect(res.applied).toBe(true);
    const snap = await snapshot(other, raceUuid);
    expect(snap.categories.map((x: any) => x.name)).toEqual(["Elite"]);
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
    // The old owner (now a member) can no longer delete it for everyone, only hide it for themselves.
    const r = await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(owner.token));
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe('hidden');
    expect((await snapshot(owner, race.raceUuid)).race.uuid).toBe(race.raceUuid);
  });

  it("the owner deleting an active race soft-deletes it for every member (410), keeping its rows; a member only hides it", async () => {
    const race = await publishRace(owner, 1, 2, 2);
    await addMember(owner, race.raceUuid, admin, ["admin"]);
    const hide = await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(admin.token));
    expect(hide.status).toBe(200);
    expect(hide.body.deleted).toBe("hidden"); // a member's delete hides it for them only
    expect((await snapshot(owner, race.raceUuid)).race.uuid).toBe(race.raceUuid);
    const del = await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(owner.token));
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe("race");
    for (const u of [owner, admin]) {
      const r = await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(u.token));
      expect(r.status).toBe(410);
      expect(r.body.error.code).toBe("race_deleted");
    }
    // An offline device delivering queued actions can't bring it back.
    const late = await api().post(`/api/v1/races/${race.raceUuid}/actions`).set(auth(owner.token)).send({ actions: [action(race.raceUuid, "WaveStarted", { heat: 1 })] });
    expect(late.status).toBe(410);
    expect((await api().get("/api/v1/races").set(auth(owner.token))).body.removed).toContain(race.raceUuid);
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
