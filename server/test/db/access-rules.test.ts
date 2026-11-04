/**
 * Race Access Rules (current phase) against the database: only the owner writes,
 * share links read ONLY published races, unpublish revokes, guests never reach
 * management routes, guest polling closes once the race is finished.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { action, addMember, api, auth, newUser, publishRace, send, startServer, stopServer, type TestUser } from "./helpers";

let owner: TestUser, counter: TestUser;
beforeAll(async () => {
  await startServer();
  [owner, counter] = await Promise.all([newUser("Owner"), newUser("Counter")]);
});
afterAll(() => stopServer());

describe("owner-only writes", () => {
  it("a member's actions are refused; the owner's apply", async () => {
    const race = await publishRace(owner, 1, 2, 2);
    await addMember(owner, race.raceUuid, counter, ["counter"]);
    const refused = await send(counter, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 }));
    expect(refused[0].applied).toBe(false);
    const ok = await send(owner, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 }));
    expect(ok[0].applied).toBe(true);
    const seen = await api().get(`/api/v1/races/${race.raceUuid}`).set(auth(counter.token));
    expect(seen.body.access.screens.live.update).toBe(false); // the app hides every write control
  });
});

describe("share links", () => {
  it("work only while published; unpublish revokes; a race id is never a link", async () => {
    const race = await publishRace(owner, 1, 2, 2);
    expect((await api().get(`/api/v1/races/${race.raceUuid}/share-link`).set(auth(counter.token))).status).toBe(404); // not a member
    const link = await api().get(`/api/v1/races/${race.raceUuid}/share-link`).set(auth(owner.token));
    expect(link.status).toBe(200);
    expect(link.body.published).toBe(false);
    const token = link.body.token as string;
    expect((await api().get(`/api/v1/public/races/${token}`)).status).toBe(404); // not published yet

    const pub = await api().put(`/api/v1/races/${race.raceUuid}/publication`).set(auth(owner.token)).send({ published: true });
    expect(pub.body).toMatchObject({ published: true, token });
    const guest = await api().get(`/api/v1/public/races/${token}`);
    expect(guest.status).toBe(200);
    for (const f of ["joinCode", "ownerUserId", "phone"]) expect(guest.body.race).not.toHaveProperty(f);
    for (const r of guest.body.riders) {
      expect(r).not.toHaveProperty("comment");
      expect(r).not.toHaveProperty("chipNumber");
    }
    expect((await api().get(`/api/v1/races/${race.raceUuid}/snapshot`)).status).toBe(401);
    expect((await api().get(`/api/v1/public/races/${race.raceUuid}`)).status).toBe(404);

    await api().put(`/api/v1/races/${race.raceUuid}/publication`).set(auth(owner.token)).send({ published: false });
    expect((await api().get(`/api/v1/public/races/${token}`)).status).toBe(404);
  });

  it("guest polling closes once the race is finished (410); the race stays readable; finalize runs once", async () => {
    const race = await publishRace(owner, 1, 1, 1);
    const { body } = await api().put(`/api/v1/races/${race.raceUuid}/publication`).set(auth(owner.token)).send({ published: true });
    await send(owner, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 }));
    expect((await api().post(`/api/v1/races/${race.raceUuid}/finalize`).set(auth(owner.token))).status).toBe(201);
    expect((await api().post(`/api/v1/races/${race.raceUuid}/finalize`).set(auth(owner.token))).status).toBe(409);
    const ch = await api().get(`/api/v1/public/races/${body.token}/changes?afterSeq=0`);
    expect(ch.status).toBe(410);
    expect(ch.body.error.code).toBe("polling_closed");
    const final = await api().get(`/api/v1/public/races/${body.token}`);
    expect(final.status).toBe(200);
    expect(final.body.polling.open).toBe(false);
  });
});
