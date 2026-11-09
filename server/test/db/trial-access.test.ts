/**
 * Quick Trial Access (014): a race owner's link creates a temporary user + ordinary
 * membership + session. Existing authorization decides what the trial judge may do;
 * the trial is bound to one race, can't touch account-level APIs, and ends on expiry
 * or revocation without losing its history. Runs against the isolated test database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { action, addMember, api, auth, collect, newUser, publishRace, send, socketFor, startServer, stopServer, until, type TestUser } from "./helpers";
import { db } from "../../src/db/pool";
import { env } from "../../src/config/env";

let owner: TestUser, judge: TestUser, outsider: TestUser;

/** The trial-link issuer (TRIAL_LINK_ISSUERS) with a VERIFIED email, as production's account. */
async function makeIssuer(u: TestUser) {
  await db.query(`UPDATE user_identities SET "emailVerified" = true WHERE "userId" = $1`, [u.id]);
  env.TRIAL_LINK_ISSUERS = [u.email.toLowerCase()];
}

beforeAll(async () => {
  await startServer();
  owner = await newUser("TrOwner");
  judge = await newUser("TrJudge");
  outsider = await newUser("TrOutsider");
  await makeIssuer(owner);
});
afterAll(stopServer);

const createLink = (raceUuid: string, as: { token: string } = owner, body: Record<string, unknown> = {}) =>
  api().post(`/api/v1/races/${raceUuid}/trial-links`).set(auth(as.token)).send(body);
const tokenOf = (url: string) => url.split("/trial/")[1];
const start = (token: string, body: Record<string, unknown> = {}) => api().post(`/api/v1/trial/${token}/start`).send(body);

async function trialUser(raceUuid: string, linkBody: Record<string, unknown> = {}) {
  const link = await createLink(raceUuid, owner, linkBody);
  expect(link.status).toBe(201);
  const r = await start(tokenOf(link.body.url));
  expect(r.status).toBe(201);
  const user: TestUser = { id: r.body.user.id, email: "", token: r.body.accessToken, refreshToken: r.body.refreshToken };
  return { ...user, linkId: link.body.id as string, url: link.body.url as string, body: r.body };
}
const memberWrites = (raceUuid: string, enabled: boolean) =>
  api().put(`/api/v1/races/${raceUuid}/member-writes`).set(auth(owner.token)).send({ enabled });

describe("only the trial-link issuer, only for races it owns", () => {
  it("another race owner, an unverified issuer email and a race the issuer doesn't own are refused", async () => {
    const otherOwner = await newUser("TrOtherOwner");
    await db.query(`UPDATE user_identities SET "emailVerified" = true WHERE "userId" = $1`, [otherOwner.id]);
    const theirs = await publishRace(otherOwner, 1, 1, 3);
    expect((await createLink(theirs.raceUuid, otherOwner)).status).toBe(403); // owner, verified, not the issuer
    expect((await api().get(`/api/v1/races/${theirs.raceUuid}/trial-links`).set(auth(otherOwner.token))).status).toBe(403);
    expect((await createLink(theirs.raceUuid, owner)).status).toBe(404); // issuer, not a member of that race
    await addMember(otherOwner, theirs.raceUuid, owner, ["admin"]);
    expect((await createLink(theirs.raceUuid, owner)).status).toBe(403); // issuer, admin there, not the owner
    // The issuer address on an account that never verified it doesn't qualify.
    const unverified = await newUser("TrUnverified");
    env.TRIAL_LINK_ISSUERS = [unverified.email.toLowerCase()];
    try {
      const r = await publishRace(unverified, 1, 1, 3);
      expect((await createLink(r.raceUuid, unverified)).status).toBe(403);
    } finally {
      env.TRIAL_LINK_ISSUERS = [owner.email.toLowerCase()];
    }
  });

  it("a link stops working if its creator is no longer an issuer", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    const link = await createLink(race.raceUuid);
    env.TRIAL_LINK_ISSUERS = [];
    try {
      expect((await start(tokenOf(link.body.url))).status).toBe(410);
    } finally {
      env.TRIAL_LINK_ISSUERS = [owner.email.toLowerCase()];
    }
  });
});

describe("creating links", () => {
  it("only the race owner creates, lists and revokes; the secret is stored hashed", async () => {
    const race = await publishRace(owner, 1, 2, 3);
    await addMember(owner, race.raceUuid, judge, ["admin"]);
    expect((await createLink(race.raceUuid, judge)).status).toBe(403); // even an admin judge
    expect((await createLink(race.raceUuid, outsider)).status).toBe(404);
    const r = await createLink(race.raceUuid);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ roles: ["start", "counter", "checkin", "results"], maxUses: 10, status: "valid" });
    const secret = tokenOf(r.body.url);
    expect(secret.length).toBeGreaterThanOrEqual(43); // 32 random bytes
    const row = await db.one<{ tokenHash: string }>(`SELECT "tokenHash" FROM trial_links WHERE id = $1`, [r.body.id]);
    expect(row!.tokenHash).not.toContain(secret);
    expect(JSON.stringify(await db.query(`SELECT payload FROM race_events WHERE "raceUuid" = $1`, [race.raceUuid]))).not.toContain(secret);
    const list = await api().get(`/api/v1/races/${race.raceUuid}/trial-links`).set(auth(owner.token));
    expect(list.body.links).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect((await api().get(`/api/v1/races/${race.raceUuid}/trial-links`).set(auth(judge.token))).status).toBe(403);
    expect((await createLink(race.raceUuid, owner, { roles: ["admin"] })).status).toBe(400); // never admin
  });

  it("each trial judge gets 24 h from their own activation, whatever the race date; the link's own expiry is separate", async () => {
    for (const date of ["2030-06-01", "2020-01-01", ""]) {
      const race = await publishRace(owner, 1, 1, 3);
      await db.query(`UPDATE races SET date = $2 WHERE uuid = $1`, [race.raceUuid, date]);
      const link = await createLink(race.raceUuid);
      const before = Date.now();
      const r = await start(tokenOf(link.body.url));
      expect(r.status).toBe(201);
      const until = Date.parse(r.body.user.trial.expiresAt);
      expect(until - before).toBeGreaterThanOrEqual(24 * 3_600_000 - 1000);
      expect(until - Date.now()).toBeLessThanOrEqual(24 * 3_600_000 + 1000);
      const row = await db.one<{ expiresAt: Date }>(`SELECT "expiresAt" FROM temporary_users WHERE "userId" = $1`, [r.body.user.id]);
      expect(row!.expiresAt.getTime()).toBe(until);
      // The link stays open for its own 7 days.
      expect(Date.parse(link.body.expiresAt) - before).toBeGreaterThan(6.9 * 24 * 3_600_000);
    }
  });
});

describe("opening a link", () => {
  it("creates a temporary user that is an ordinary member with the link's roles, no account needed", async () => {
    const race = await publishRace(owner, 1, 2, 3);
    const t = await trialUser(race.raceUuid);
    expect(t.body.raceUuid).toBe(race.raceUuid);
    expect(t.body.user).toMatchObject({ email: null, name: "Trial judge 1", identities: [] });
    expect(t.body.user.trial.raceUuid).toBe(race.raceUuid);
    const me = await api().get(`/api/v1/races/${race.raceUuid}`).set(auth(t.token));
    expect(me.status).toBe(200);
    expect(me.body.access).toMatchObject({ isOwner: false, roles: ["start", "counter", "checkin", "results"] });
    expect(me.body.access.trialUntil).toBeTruthy();
    // My Races lists only the trial race.
    const mine = await api().get("/api/v1/races").set(auth(t.token));
    expect(mine.body.races.map((r: { race: { uuid: string } }) => r.race.uuid)).toEqual([race.raceUuid]);
    // Audit: MemberChanged + trialUserStarted, under the trial user.
    const ev = await db.query<{ type: string }>(`SELECT type FROM race_events WHERE "raceUuid" = $1 AND "userId" = $2 ORDER BY seq`, [race.raceUuid, t.id]);
    expect(ev.map((e) => e.type)).toEqual(["MemberChanged", "RaceAdmin"]);
  });

  it("judges exactly like an invited judge: writes follow the owner's 'Judges can record' switch", async () => {
    const race = await publishRace(owner, 1, 2, 3);
    const t = await trialUser(race.raceUuid);
    expect((await send(t, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 })))[0].reason).toBe("forbidden");
    expect((await memberWrites(race.raceUuid, true)).status).toBe(200);
    expect((await send(t, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 })))[0].applied).toBe(true);
    const lap = await send(t, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: race.riders[0].uuid }));
    expect(lap[0].applied).toBe(true);
    const e = await db.one<{ userId: string }>(`SELECT "userId" FROM race_events WHERE "raceUuid" = $1 AND seq = $2`, [race.raceUuid, lap[0].seq]);
    expect(e!.userId).toBe(t.id); // never attributed to the owner
    // Finalize stays the owner's — the existing rule for every judge.
    expect((await api().post(`/api/v1/races/${race.raceUuid}/finalize`).set(auth(t.token)).send({})).status).toBe(403);
  });

  it("approves a finished category's results, as the existing role rule allows", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    await memberWrites(race.raceUuid, true);
    const t = await trialUser(race.raceUuid);
    await send(t, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 }));
    await send(t, race.raceUuid, action(race.raceUuid, "AddLap", { riderUuid: race.riders[0].uuid }, { at: new Date(Date.now() + 61_000).toISOString() }));
    expect((await send(t, race.raceUuid, action(race.raceUuid, "WaveFinished", { heat: 1 })))[0].applied).toBe(true);
    const r = await api().post(`/api/v1/races/${race.raceUuid}/categories/${race.cats[0].uuid}/approval`).set(auth(t.token)).send({ confirm: "APPROVED" });
    expect(r.status).toBeLessThan(300);
  });

  it("many judges opening one link at the same moment never stall the server", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    const link = await createLink(race.raceUuid, owner, { maxUses: 20 });
    const results = await Promise.all(Array.from({ length: 14 }, () => start(tokenOf(link.body.url))));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.user.id)).size).toBe(14);
    expect((await api().get("/api/v1/health")).status).toBe(200);
  }, 30_000);

  it("each use is a separate user; a used-up, revoked or unknown link can't be opened", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    const link = await createLink(race.raceUuid, owner, { maxUses: 2 });
    const a = await start(tokenOf(link.body.url));
    const b = await start(tokenOf(link.body.url), { name: "Dana" });
    expect(a.status).toBe(201);
    expect(a.body.user.id).not.toBe(b.body.user.id);
    expect(b.body.user.name).toBe("Dana");
    expect((await start(tokenOf(link.body.url))).status).toBe(410);
    expect((await start("x".repeat(43))).status).toBe(404);
    const other = await createLink(race.raceUuid);
    await api().delete(`/api/v1/races/${race.raceUuid}/trial-links/${other.body.id}`).set(auth(owner.token));
    expect((await start(tokenOf(other.body.url))).status).toBe(410);
  });

  it("a deleted race's link answers the same 410 as any unusable link", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    const link = await createLink(race.raceUuid);
    expect((await api().delete(`/api/v1/races/${race.raceUuid}`).set(auth(owner.token))).status).toBe(200);
    const r = await start(tokenOf(link.body.url));
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe("trial_link_unavailable");
  });
});

describe("restricted to the race, never a permanent account", () => {
  it("refuses account-level APIs and other races", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    const other = await publishRace(owner, 1, 1, 3);
    const t = await trialUser(race.raceUuid);
    const h = auth(t.token);
    expect((await api().post("/api/v1/races").set(h).send({ name: "Mine" })).status).toBe(403);
    expect((await api().post("/api/v1/races/publish").set(h).send({ race: { name: "x" }, categories: [], riders: [] })).status).toBe(403);
    expect((await api().patch("/api/v1/me").set(h).send({ name: "Me" })).status).toBe(403);
    expect((await api().put("/api/v1/me/identities/password").set(h).send({ email: "t@x.test", password: "password-123" })).status).toBe(403);
    expect((await api().post(`/api/v1/races/${race.raceUuid}/invitations`).set(h).send({ link: true, roles: ["viewer"] })).status).toBe(403);
    expect((await createLink(race.raceUuid, t)).status).toBe(403);
    expect((await api().get("/api/v1/accounts").set(h)).status).toBe(403);
    expect((await api().get("/api/v1/Accounts").set(h)).status).toBe(403); // any letter case
    expect((await api().get(`/api/v1/races/${other.raceUuid}`).set(h)).status).toBe(404);
    expect((await api().delete(`/api/v1/races/${race.raceUuid}`).set(h)).status).toBe(403);
    // Another race's invitation can't pull a trial user in.
    const inv = await api().post(`/api/v1/races/${other.raceUuid}/invitations`).set(auth(owner.token)).send({ link: true, roles: ["counter"], sendEmail: false });
    const invToken = inv.body.invitations[0].url.split("/invite/")[1];
    expect((await api().post(`/api/v1/invitations/${invToken}/accept`).set(h)).status).toBe(403);
    // Allowed: reading itself and signing out.
    expect((await api().get("/api/v1/me").set(h)).status).toBe(200);
  });

  it("the owner can't hand the race to a trial user", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    const t = await trialUser(race.raceUuid);
    expect((await api().post(`/api/v1/races/${race.raceUuid}/transfer`).set(auth(owner.token)).send({ userId: t.id })).status).toBe(400);
  });
});

describe("ending a trial", () => {
  it("expiry ends reads, writes, refresh and late offline replay; history stays", async () => {
    const race = await publishRace(owner, 1, 2, 3);
    await memberWrites(race.raceUuid, true);
    const t = await trialUser(race.raceUuid);
    await send(t, race.raceUuid, action(race.raceUuid, "WaveStarted", { heat: 1 }));
    const queued = action(race.raceUuid, "AddLap", { riderUuid: race.riders[0].uuid }); // recorded offline before expiry
    await db.query(`UPDATE temporary_users SET "expiresAt" = now() - interval '1 second' WHERE "userId" = $1`, [t.id]);
    const snap = await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(t.token));
    expect(snap.status).toBe(403);
    expect(snap.body.error.code).toBe("trial_ended");
    expect((await api().post(`/api/v1/races/${race.raceUuid}/actions`).set(auth(t.token)).send({ actions: [queued] })).status).toBe(403);
    expect((await api().post("/api/v1/auth/refresh").send({ refreshToken: t.refreshToken })).status).toBe(403);
    // Its earlier work and membership stay in the race's history.
    expect(await db.one(`SELECT 1 FROM race_events WHERE "raceUuid" = $1 AND "userId" = $2 AND type = 'WaveStarted' AND applied`, [race.raceUuid, t.id])).toBeTruthy();
    expect(await db.one(`SELECT 1 FROM race_members WHERE "raceUuid" = $1 AND "userId" = $2`, [race.raceUuid, t.id])).toBeTruthy();
  });

  it("an expired LINK doesn't end an active trial", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    const t = await trialUser(race.raceUuid);
    await db.query(`UPDATE trial_links SET "expiresAt" = now() - interval '1 second' WHERE id = $1`, [t.linkId]);
    expect((await start(tokenOf(t.url))).status).toBe(410);
    expect((await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(t.token))).status).toBe(200);
  });

  it("revoking the link ends its trials at once, including the open socket", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    const t = await trialUser(race.raceUuid);
    const s = await socketFor(t);
    const revoked = collect(s, "race:revoked");
    const joined = await new Promise<{ ok: boolean }>((r) => s.emit("join", { raceUuid: race.raceUuid }, r));
    expect(joined.ok).toBe(true);
    const r = await api().delete(`/api/v1/races/${race.raceUuid}/trial-links/${t.linkId}`).set(auth(owner.token));
    expect(r.body.endedUsers).toBe(1);
    await until(() => revoked.length > 0);
    s.disconnect();
    const after = await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(t.token));
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe("trial_ended"); // the device learns why, not a bare 401
    expect((await api().post("/api/v1/auth/refresh").send({ refreshToken: t.refreshToken })).body.error.code).toBe("trial_ended");
  });

  it("switching the feature off stops new links, opening and every trial session", async () => {
    const race = await publishRace(owner, 1, 1, 3);
    const t = await trialUser(race.raceUuid);
    const link = await createLink(race.raceUuid);
    env.TRIAL_ACCESS_ENABLED = false;
    try {
      expect((await createLink(race.raceUuid)).status).toBe(404);
      expect((await start(tokenOf(link.body.url))).status).toBe(404);
      expect((await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(t.token))).body.error.code).toBe("trial_ended");
      // Everyone else is unaffected.
      expect((await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(owner.token))).status).toBe(200);
    } finally {
      env.TRIAL_ACCESS_ENABLED = true;
    }
  });
});
