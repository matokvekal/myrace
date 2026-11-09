/**
 * Without foreign keys (006) the API keeps every relation: deleting a race,
 * contact or group removes its dependent rows in one transaction, and ids that
 * the database used to check (accounts, contacts) are checked by the API.
 * Riders are synthetic.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/db/pool";
import { RACE_TABLES } from "../../src/races/repo";
import { env } from "../../src/config/env";
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

describe("race delete keeps every row (no cascades, no hard delete)", () => {
  it("the list of race tables matches every table with a raceUuid column", async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'raceUuid' ORDER BY 1`,
    );
    // race_hidden (010) is per-user list bookkeeping, not race data: kept when a race is deleted.
    // audit_logs (012) is the non-race audit trail ("raceUuid" optional context): kept too.
    expect(tables.map((t) => t.table_name).sort()).toEqual([...RACE_TABLES, "race_hidden", "audit_logs"].sort());
  });

  it("deleting a finished race hides it for that user only and keeps every row", async () => {
    const a = await publishRace(owner, 2, 2, 2);
    const b = await publishRace(owner, 1, 2, 2);
    await addMember(owner, a.raceUuid, counter, ["counter"]);
    await addMember(owner, b.raceUuid, counter, ["counter"]);
    const pendingLink = await api().post(`/api/v1/races/${a.raceUuid}/invitations`).set(auth(owner.token)).send({ link: true, roles: ["viewer"], sendEmail: false });
    // A trial judge (014): its link and temporary user are race rows too.
    await db.query(`UPDATE user_identities SET "emailVerified" = true WHERE "userId" = $1`, [owner.id]);
    const issuers = env.TRIAL_LINK_ISSUERS;
    env.TRIAL_LINK_ISSUERS = [owner.email.toLowerCase()];
    try {
      const trialLink = await api().post(`/api/v1/races/${a.raceUuid}/trial-links`).set(auth(owner.token)).send({});
      expect((await api().post(`/api/v1/trial/${trialLink.body.url.split("/trial/")[1]}/start`).send({})).status).toBe(201);
    } finally {
      env.TRIAL_LINK_ISSUERS = issuers;
    }
    const r1 = a.riders.find((r) => r.heat === 1)!;
    await send(owner, a.raceUuid, action(a.raceUuid, "WaveStarted", { heat: 1 }));
    await send(owner, a.raceUuid, action(a.raceUuid, "AddLap", { riderUuid: r1.uuid }, { at: new Date(Date.now() + 90_000).toISOString() }));
    await api().post(`/api/v1/races/${a.raceUuid}/sync`).set(auth(counter.token)).send({ deviceId: "phone-1", lastSeq: 1, pendingCount: 0 });
    expect((await api().post(`/api/v1/races/${a.raceUuid}/finalize`).set(auth(owner.token))).status).toBe(201);
    // 0.3.5: an official podium approval (category_approvals) is race data too.
    expect((await api().post(`/api/v1/races/${a.raceUuid}/categories/${a.cats[0].uuid}/approval`).set(auth(owner.token)).send({ confirm: "APPROVED" })).status).toBe(201);

    const before = await rowsOf(a.raceUuid);
    for (const t of RACE_TABLES) expect(before[t], t).toBeGreaterThan(0); // every table really had rows
    const bBefore = await rowsOf(b.raceUuid);

    // Race deletion never removes rows (migration 010): a FINISHED race is only hidden
    // for the user who deletes it — every row stays, the counter still sees it.
    const del = await api().delete(`/api/v1/races/${a.raceUuid}`).set(auth(owner.token));
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe("hidden");
    // Every row stays; the only addition is the hide's own audit entry (0.2, RaceAdmin).
    expect(await rowsOf(a.raceUuid)).toEqual({ ...before, race_events: before.race_events + 1 });
    const last = await db.one<{ type: string; payload: { op: string }; userId: string }>(
      `SELECT type, payload, "userId" FROM race_events WHERE "raceUuid" = $1 ORDER BY seq DESC LIMIT 1`, [a.raceUuid]);
    expect(last).toMatchObject({ type: "RaceAdmin", payload: { op: "hidden" }, userId: owner.id });
    expect(await rowsOf(b.raceUuid)).toEqual(bBefore);
    const mine = await api().get("/api/v1/races").set(auth(owner.token));
    expect(mine.body.removed).toContain(a.raceUuid);
    expect(mine.body.races.map((x: any) => x.race.uuid)).not.toContain(a.raceUuid);
    const theirs = await api().get("/api/v1/races").set(auth(counter.token));
    expect(theirs.body.races.map((x: any) => x.race.uuid)).toContain(a.raceUuid);
    void pendingLink;
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
