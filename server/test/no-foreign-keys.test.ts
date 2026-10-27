/**
 * Without foreign keys (006) the API keeps every relation: deleting a race,
 * contact or group removes its dependent rows in one transaction, and ids that
 * the database used to check (accounts, contacts) are checked by the API.
 * Riders are synthetic.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/pool";
import { RACE_TABLES } from "../src/races/repo";
import { action, addMember, api, auth, newUser, publishRace, send, startServer, stopServer, type TestUser } from "./helpers";

let owner: TestUser, counter: TestUser, other: TestUser;

beforeAll(async () => {
  await startServer();
  [owner, counter, other] = await Promise.all(["Owner", "Counter", "Other"].map((n) => newUser(n)));
});
afterAll(() => stopServer());

const rowsOf = async (raceUuid: string) => {
  const out: Record<string, number> = {};
  for (const t of RACE_TABLES) out[t] = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE "raceUuid" = $1`, [raceUuid]))!.n;
  out.races = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM races WHERE uuid = $1`, [raceUuid]))!.n;
  return out;
};

describe("race delete without database cascades", () => {
  it("the list of race tables matches every table with a raceUuid column", async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'raceUuid' ORDER BY 1`,
    );
    expect(tables.map((t) => t.table_name).sort()).toEqual([...RACE_TABLES].sort());
  });

  it("removes every row of the race in every table, and nothing of another race", async () => {
    const a = await publishRace(owner, 2, 2, 2);
    const b = await publishRace(owner, 1, 2, 2);
    await addMember(owner, a.raceUuid, counter, ["counter"]);
    await addMember(owner, b.raceUuid, counter, ["counter"]);
    const pendingLink = await api().post(`/api/v1/races/${a.raceUuid}/invitations`).set(auth(owner.token)).send({ link: true, roles: ["viewer"], sendEmail: false });
    const r1 = a.riders.find((r) => r.heat === 1)!;
    await send(owner, a.raceUuid, action(a.raceUuid, "WaveStarted", { heat: 1 }));
    await send(counter, a.raceUuid, action(a.raceUuid, "AddLap", { riderUuid: r1.uuid }, { at: new Date(Date.now() + 90_000).toISOString() }));
    await api().post(`/api/v1/races/${a.raceUuid}/sync`).set(auth(counter.token)).send({ deviceId: "phone-1", lastSeq: 1, pendingCount: 0 });
    expect((await api().post(`/api/v1/races/${a.raceUuid}/finalize`).set(auth(owner.token))).status).toBe(201);

    const before = await rowsOf(a.raceUuid);
    for (const t of RACE_TABLES) expect(before[t], t).toBeGreaterThan(0); // every table really had rows
    const bBefore = await rowsOf(b.raceUuid);

    expect((await api().delete(`/api/v1/races/${a.raceUuid}`).set(auth(owner.token))).status).toBe(204);
    expect(Object.values(await rowsOf(a.raceUuid)).every((n) => n === 0)).toBe(true);
    expect(await rowsOf(b.raceUuid)).toEqual(bBefore);

    // An invitation link of the deleted race is gone with it.
    const token = pendingLink.body.invitations[0].url.split("/invite/")[1];
    expect((await api().post(`/api/v1/invitations/${token}/accept`).set(auth(other.token))).status).toBe(404);
    expect((await api().delete(`/api/v1/races/${a.raceUuid}`).set(auth(owner.token))).status).toBe(404);
  });
});

describe("directory without database cascades", () => {
  const contact = async (u: TestUser, email: string) =>
    (await api().post("/api/v1/me/contacts").set(auth(u.token)).send({ name: email, email })).body.contact.id as string;
  const group = async (u: TestUser, name: string) =>
    (await api().post("/api/v1/me/groups").set(auth(u.token)).send({ name })).body.group.id as string;
  const members = async (groupId: string) =>
    (await db.query<{ contactId: string }>(`SELECT "contactId" FROM contact_group_members WHERE "groupId" = $1`, [groupId])).map((r) => r.contactId).sort();

  it("deleting a contact removes it from its groups; deleting a group keeps its contacts", async () => {
    const c1 = await contact(owner, `c1.${Date.now()}@x.test`);
    const c2 = await contact(owner, `c2.${Date.now()}@x.test`);
    const g = await group(owner, `Federation ${Date.now()}`);
    expect((await api().put(`/api/v1/me/groups/${g}/contacts`).set(auth(owner.token)).send({ contactIds: [c1, c2] })).status).toBe(204);
    expect(await members(g)).toEqual([c1, c2].sort());

    expect((await api().delete(`/api/v1/me/contacts/${c1}`).set(auth(owner.token))).status).toBe(204);
    expect(await members(g)).toEqual([c2]);

    expect((await api().delete(`/api/v1/me/groups/${g}`).set(auth(owner.token))).status).toBe(204);
    expect(await db.query(`SELECT 1 FROM contact_group_members WHERE "groupId" = $1`, [g])).toEqual([]);
    expect(await db.query(`SELECT 1 FROM contacts WHERE id = $1`, [c2])).toHaveLength(1);
  });

  it("another user's contact or group cannot be changed or deleted", async () => {
    const c = await contact(owner, `mine.${Date.now()}@x.test`);
    const g = await group(owner, `Mine ${Date.now()}`);
    await api().put(`/api/v1/me/groups/${g}/contacts`).set(auth(owner.token)).send({ contactIds: [c] });
    expect((await api().put(`/api/v1/me/groups/${g}/contacts`).set(auth(other.token)).send({ contactIds: [] })).status).toBe(404);
    expect((await api().delete(`/api/v1/me/contacts/${c}`).set(auth(other.token))).status).toBe(204); // nothing to delete for them
    expect((await api().delete(`/api/v1/me/groups/${g}`).set(auth(other.token))).status).toBe(204);
    expect(await members(g)).toEqual([c]);
  });

  it("only the owner's own contacts can be put in a group", async () => {
    const mine = await contact(owner, `own.${Date.now()}@x.test`);
    const theirs = await contact(other, `theirs.${Date.now()}@x.test`);
    const g = await group(owner, `Mixed ${Date.now()}`);
    await api().put(`/api/v1/me/groups/${g}/contacts`).set(auth(owner.token)).send({ contactIds: [mine, theirs, randomUUID()] });
    expect(await members(g)).toEqual([mine]);
  });

  it("a contact linked to an account that does not exist is refused", async () => {
    const r = await api().post("/api/v1/me/contacts").set(auth(owner.token)).send({ name: "Ghost", userId: randomUUID() });
    expect(r.status).toBe(400);
    const ok = await api().post("/api/v1/me/contacts").set(auth(owner.token)).send({ name: "Real", userId: other.id });
    expect(ok.status).toBe(201);
  });
});
