/**
 * Commissaire 0.2 Phase 2 (P2-T3, P2-T4) — organization judge-pool invitations and
 * organization races. Runs against the isolated test database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/pool";
import { orgRole } from "../../src/accounts/accounts";
import * as messaging from "../../src/lib/messaging";
import { api, auth, newUser, publishRace, startServer, stopServer, type TestUser } from "./helpers";

let admin: TestUser, manager: TestUser, judge: TestUser, invitee: TestUser, other: TestUser, adminB: TestUser;
let org: string, orgB: string;

let slugN = 0;
const requestOrg = async (u: TestUser, name: string) =>
  (await api().post("/api/v1/organizations").set(auth(u.token)).send({ name, slug: `pool-${Date.now()}-${++slugN}` })).body.organization.id as string;
const addOrgMember = (orgId: string, userId: string, role: string, status = "active") =>
  db.query(`INSERT INTO account_members ("accountId", "userId", role, status) VALUES ($1, $2, $3, $4)
            ON CONFLICT ("accountId", "userId") DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, "updatedAt" = now()`, [orgId, userId, role, status]);
const activate = async (orgId: string, adminId: string, role = "admin") => {
  await db.query(`UPDATE accounts SET status = 'active' WHERE id = $1`, [orgId]);
  await addOrgMember(orgId, adminId, role);
};
const verifyEmail = (u: TestUser) => db.query(`UPDATE user_identities SET "emailVerified" = true WHERE "userId" = $1`, [u.id]);
const auditOf = (accountId: string) =>
  db.query<{ actorUserId: string; action: string; entityId: string; raceUuid: string | null; data: Record<string, unknown> }>(
    `SELECT "actorUserId", action, "entityId", "raceUuid", data FROM audit_logs WHERE "accountId" = $1 ORDER BY "createdAt", id`, [accountId]);
const invite = (u: TestUser, orgId: string, body: Record<string, unknown>) =>
  api().post(`/api/v1/organizations/${orgId}/invitations`).set(auth(u.token)).send({ sendEmail: false, ...body });
const tokenOf = (url: string) => url.split("/org-invite/")[1];

beforeAll(async () => {
  await startServer();
  [admin, manager, judge, invitee, other, adminB] = await Promise.all(
    ["PoolAdmin", "PoolManager", "PoolJudge", "PoolInvitee", "PoolOther", "PoolAdminB"].map((n) => newUser(n)));
  org = await requestOrg(admin, "Pool Club");
  orgB = await requestOrg(adminB, "Other Club");
  await activate(org, admin.id);
  await activate(orgB, adminB.id);
  await addOrgMember(org, manager.id, "manager");
  await addOrgMember(org, judge.id, "judge");
});
afterAll(stopServer);

describe("org invitations: create / list / revoke", () => {
  it("admin invites by email, user and link; url + qrSvg; no secret stored or audited; email sent", async () => {
    const spy = vi.spyOn(messaging, "sendMail");
    const r = await api().post(`/api/v1/organizations/${org}/invitations`).set(auth(admin.token))
      .send({ emails: ["Someone@X.test"], userIds: [invitee.id], link: true, maxUses: 3, role: "member", message: "Welcome" });
    expect(r.status).toBe(201);
    expect(r.body.invitations).toHaveLength(3);
    for (const i of r.body.invitations) {
      expect(i.url).toContain("/org-invite/");
      expect(i.qrSvg).toContain("<svg");
      expect(i.role).toBe("member");
    }
    expect(spy.mock.calls.some((c) => c[0] === "someone@x.test" && String(c[2]).includes("/org-invite/"))).toBe(true);
    const secrets = r.body.invitations.map((i: { url: string }) => tokenOf(i.url));
    const stored = JSON.stringify(await db.query(`SELECT * FROM account_invitations WHERE "accountId" = $1`, [org]));
    const audit = await auditOf(org);
    for (const s of secrets) {
      expect(stored).not.toContain(s);
      expect(JSON.stringify(audit)).not.toContain(s);
    }
    expect(audit.filter((a) => a.action === "organization.invitation_created")).toHaveLength(3);
    expect(audit.at(-1)).toMatchObject({ actorUserId: admin.id });
    const link = await db.one<{ maxUses: number }>(`SELECT "maxUses" FROM account_invitations WHERE "accountId" = $1 AND email IS NULL AND "userId" IS NULL`, [org]);
    expect(link!.maxUses).toBe(3);
  });

  it("validation: role default judge, no admin/owner role, expiry 1–90, empty target, unknown fields", async () => {
    const d = await invite(admin, org, { link: true });
    expect(d.status).toBe(201);
    expect(d.body.invitations[0].role).toBe("judge");
    expect((await invite(admin, org, { link: true, role: "admin" })).status).toBe(400);
    expect((await invite(admin, org, { link: true, role: "owner" })).status).toBe(400);
    expect((await invite(admin, org, { link: true, expiresInDays: 0 })).status).toBe(400);
    expect((await invite(admin, org, { link: true, expiresInDays: 91 })).status).toBe(400);
    expect((await invite(admin, org, {})).status).toBe(400);
    expect((await invite(admin, org, { link: true, accountId: orgB })).status).toBe(400);
  });

  it("manager may invite judges only; judge/outsider/other org can't invite; pending org refused", async () => {
    expect((await invite(manager, org, { link: true, role: "judge" })).status).toBe(201);
    expect((await invite(manager, org, { link: true })).status).toBe(201);
    expect((await invite(manager, org, { link: true, role: "manager" })).status).toBe(403);
    expect((await invite(manager, org, { link: true, role: "member" })).status).toBe(403);
    expect((await invite(judge, org, { link: true })).status).toBe(403);
    expect((await invite(other, org, { link: true })).status).toBe(404);
    expect((await invite(adminB, org, { link: true })).status).toBe(404);
    const pending = await requestOrg(other, "Pending Pool");
    const r = await invite(other, pending, { link: true });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("organization_inactive");
  });

  it("list and revoke: owner/admin only; isolated; audited", async () => {
    const list = await api().get(`/api/v1/organizations/${org}/invitations`).set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.invitations.length).toBeGreaterThan(0);
    expect(JSON.stringify(list.body)).not.toContain("tokenHash");
    expect(list.body.invitations[0]).toHaveProperty("status", "valid");
    expect((await api().get(`/api/v1/organizations/${org}/invitations`).set(auth(manager.token))).status).toBe(403);
    expect((await api().get(`/api/v1/organizations/${org}/invitations`).set(auth(adminB.token))).status).toBe(404);

    const inv = (await invite(admin, org, { link: true })).body.invitations[0];
    expect((await api().delete(`/api/v1/organizations/${org}/invitations/${inv.id}`).set(auth(manager.token))).status).toBe(403);
    expect((await api().delete(`/api/v1/organizations/${orgB}/invitations/${inv.id}`).set(auth(adminB.token))).status).toBe(404);
    expect((await api().delete(`/api/v1/organizations/${org}/invitations/not-a-uuid`).set(auth(admin.token))).status).toBe(404);
    expect((await api().delete(`/api/v1/organizations/${org}/invitations/${randomUUID()}`).set(auth(admin.token))).status).toBe(404);
    expect((await api().delete(`/api/v1/organizations/${org}/invitations/${inv.id}`).set(auth(admin.token))).status).toBe(204);
    expect((await auditOf(org)).at(-1)).toMatchObject({ actorUserId: admin.id, action: "organization.invitation_revoked", entityId: inv.id });
    const prev = await api().get(`/api/v1/account-invitations/${tokenOf(inv.url)}`).set(auth(other.token));
    expect(prev.body).toMatchObject({ status: "revoked", canAccept: false });
    expect((await api().post(`/api/v1/account-invitations/${tokenOf(inv.url)}/accept`).set(auth(other.token))).status).toBe(410);
  });
});

describe("org invitations: invitee side", () => {
  it("preview + accept by link: active member with the role; one-time; audited by the invitee; no race access", async () => {
    const race = await publishRace(admin, 1, 1, 2);
    const inv = (await invite(admin, org, { link: true, role: "judge" })).body.invitations[0];
    const t = tokenOf(inv.url);
    const u = await newUser("PoolLinkUser");
    const prev = await api().get(`/api/v1/account-invitations/${t}`).set(auth(u.token));
    expect(prev.status).toBe(200);
    expect(prev.body).toMatchObject({ orgName: "Pool Club", role: "judge", status: "valid", canAccept: true, accountId: org });
    const acc = await api().post(`/api/v1/account-invitations/${t}/accept`).set(auth(u.token));
    expect(acc.status).toBe(200);
    expect(acc.body).toEqual({ accountId: org, role: "judge" });
    expect(await orgRole(db, org, u.id)).toMatchObject({ role: "judge", status: "active" });
    expect((await auditOf(org)).at(-1)).toMatchObject({ actorUserId: u.id, action: "organization.invitation_accepted", entityId: inv.id });
    // One-time.
    const u2 = await newUser("PoolLinkUser2");
    expect((await api().post(`/api/v1/account-invitations/${t}/accept`).set(auth(u2.token))).status).toBe(410);
    expect((await api().get(`/api/v1/account-invitations/${t}`).set(auth(u2.token))).body).toMatchObject({ status: "used", canAccept: false });
    // Joining the pool grants no race access.
    expect((await api().get(`/api/v1/races/${race.raceUuid}`).set(auth(u.token))).status).toBe(404);
    expect((await api().get(`/api/v1/races/${race.raceUuid}/snapshot`).set(auth(u.token))).status).toBe(404);
    expect((await api().get("/api/v1/races").set(auth(u.token))).body.races).toEqual([]);
    expect((await api().get(`/api/v1/account-invitations/not-a-token`).set(auth(u.token))).status).toBe(404);
  });

  it("email invitation needs that email verified; /me lists it; decline is audited and final", async () => {
    const u = await newUser("PoolEmail");
    const inv = (await invite(admin, org, { emails: [u.email] })).body.invitations[0];
    const t = tokenOf(inv.url);
    expect((await api().get(`/api/v1/account-invitations/${t}`).set(auth(u.token))).body.canAccept).toBe(false);
    expect((await api().get("/api/v1/me/account-invitations").set(auth(u.token))).body.invitations).toEqual([]);
    const wrong = await api().post(`/api/v1/account-invitations/${t}/accept`).set(auth(u.token));
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("wrong_account");
    // Another account can't accept or decline it either.
    expect((await api().post(`/api/v1/account-invitations/${t}/accept`).set(auth(other.token))).status).toBe(403);
    expect((await api().post(`/api/v1/me/account-invitations/${inv.id}/decline`).set(auth(other.token))).status).toBe(404);

    await verifyEmail(u);
    const mine = await api().get("/api/v1/me/account-invitations").set(auth(u.token));
    expect(mine.body.invitations).toEqual([expect.objectContaining({ id: inv.id, orgName: "Pool Club", role: "judge" })]);
    expect((await api().post(`/api/v1/me/account-invitations/${inv.id}/decline`).set(auth(u.token))).status).toBe(204);
    expect((await auditOf(org)).at(-1)).toMatchObject({ actorUserId: u.id, action: "organization.invitation_declined", entityId: inv.id });
    expect((await api().post(`/api/v1/me/account-invitations/${inv.id}/decline`).set(auth(u.token))).status).toBe(410);
    expect((await api().post(`/api/v1/account-invitations/${t}/accept`).set(auth(u.token))).status).toBe(410);
    expect((await api().get("/api/v1/me/account-invitations").set(auth(u.token))).body.invitations).toEqual([]);
    expect(await orgRole(db, org, u.id)).toBeNull();
  });

  it("user invitation: accept by id; open links can't be declined by id; expired is refused", async () => {
    const u = await newUser("PoolById");
    const inv = (await invite(admin, org, { userIds: [u.id], role: "member" })).body.invitations[0];
    expect((await api().post(`/api/v1/me/account-invitations/${inv.id}/accept`).set(auth(other.token))).status).toBe(404);
    expect((await api().post(`/api/v1/me/account-invitations/${inv.id}/accept`).set(auth(u.token))).body).toEqual({ accountId: org, role: "member" });
    const link = (await invite(admin, org, { link: true })).body.invitations[0];
    expect((await api().post(`/api/v1/me/account-invitations/${link.id}/decline`).set(auth(u.token))).status).toBe(404);
    const exp = (await invite(admin, org, { link: true })).body.invitations[0];
    await db.query(`UPDATE account_invitations SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [exp.id]);
    expect((await api().post(`/api/v1/account-invitations/${tokenOf(exp.url)}/accept`).set(auth(u.token))).status).toBe(410);
  });

  it("never lowers a role: manager/admin stay; member is raised to the invited role", async () => {
    const asJudge = (await invite(admin, org, { link: true, maxUses: 5, role: "judge" })).body.invitations[0];
    const t = tokenOf(asJudge.url);
    expect((await api().post(`/api/v1/account-invitations/${t}/accept`).set(auth(manager.token))).body.role).toBe("manager");
    expect((await orgRole(db, org, manager.id))!.role).toBe("manager");
    expect((await api().post(`/api/v1/account-invitations/${t}/accept`).set(auth(admin.token))).body.role).toBe("admin");
    expect((await orgRole(db, org, admin.id))).toMatchObject({ role: "admin", status: "active" });
    const m = await newUser("PoolMember");
    await addOrgMember(org, m.id, "member");
    expect((await api().post(`/api/v1/account-invitations/${t}/accept`).set(auth(m.token))).body.role).toBe("judge");
    expect((await orgRole(db, org, m.id))!.role).toBe("judge");
  });

  it("suspended member can't reactivate; removed member only via an invitation made after removal; inactive org refused", async () => {
    const s = await newUser("PoolSuspended");
    await addOrgMember(org, s.id, "judge", "suspended");
    const inv1 = (await invite(admin, org, { link: true, maxUses: 5 })).body.invitations[0];
    const r1 = await api().post(`/api/v1/account-invitations/${tokenOf(inv1.url)}/accept`).set(auth(s.token));
    expect(r1.status).toBe(403);
    expect(r1.body.error.code).toBe("member_suspended");
    expect((await orgRole(db, org, s.id))!.status).toBe("suspended");

    const rm = await newUser("PoolRemoved");
    await addOrgMember(org, rm.id, "judge");
    expect((await api().delete(`/api/v1/organizations/${org}/members/${rm.id}`).set(auth(admin.token))).status).toBe(204);
    // inv1 was created before the removal → refused.
    expect((await api().post(`/api/v1/account-invitations/${tokenOf(inv1.url)}/accept`).set(auth(rm.token))).status).toBe(410);
    const inv2 = (await invite(admin, org, { userIds: [rm.id] })).body.invitations[0];
    expect((await api().post(`/api/v1/account-invitations/${tokenOf(inv2.url)}/accept`).set(auth(rm.token))).status).toBe(200);
    expect(await orgRole(db, org, rm.id)).toMatchObject({ role: "judge", status: "active" });

    const inv3 = (await invite(adminB, orgB, { link: true })).body.invitations[0];
    await db.query(`UPDATE accounts SET status = 'suspended' WHERE id = $1`, [orgB]);
    const r3 = await api().post(`/api/v1/account-invitations/${tokenOf(inv3.url)}/accept`).set(auth(other.token));
    expect(r3.status).toBe(403);
    expect(r3.body.error.code).toBe("organization_inactive");
    expect((await api().get(`/api/v1/account-invitations/${tokenOf(inv3.url)}`).set(auth(other.token))).body.canAccept).toBe(false);
    await db.query(`UPDATE accounts SET status = 'active' WHERE id = $1`, [orgB]);
  });
});

describe("org races", () => {
  it("staff create/publish races for the org; creator/owner = me; audited; listed for staff only", async () => {
    const created = await api().post("/api/v1/races").set(auth(manager.token)).send({ name: "Org Race", accountId: org });
    expect(created.status).toBe(201);
    const uuid = created.body.race.uuid;
    const row = await db.one<{ accountId: string; ownerUserId: string; createdByUserId: string }>(
      `SELECT "accountId", "ownerUserId", "createdByUserId" FROM races WHERE uuid = $1`, [uuid]);
    expect(row).toEqual({ accountId: org, ownerUserId: manager.id, createdByUserId: manager.id });
    expect((await auditOf(org)).at(-1)).toMatchObject({ actorUserId: manager.id, action: "organization.race_created", raceUuid: uuid, entityId: uuid });

    const pub = await api().post("/api/v1/races/publish").set(auth(admin.token))
      .send({ race: { name: "Org Published", date: "2026-12-01" }, categories: [], riders: [], accountId: org });
    expect(pub.status).toBe(201);
    expect((await db.one<{ accountId: string }>(`SELECT "accountId" FROM races WHERE uuid = $1`, [pub.body.race.uuid]))!.accountId).toBe(org);

    // GET /races carries accountId (additive).
    const mine = await api().get("/api/v1/races").set(auth(manager.token));
    expect(mine.body.races.find((r: { race: { uuid: string } }) => r.race.uuid === uuid).accountId).toBe(org);

    const list = await api().get(`/api/v1/organizations/${org}/races`).set(auth(admin.token));
    expect(list.status).toBe(200);
    const item = list.body.races.find((r: { uuid: string }) => r.uuid === uuid);
    expect(Object.keys(item).sort()).toEqual(["createdAt", "date", "name", "ownerName", "status", "uuid"]);
    expect(item.ownerName).toBe("PoolManager");
    expect(list.body.races.map((r: { uuid: string }) => r.uuid)).toContain(pub.body.race.uuid);
    expect((await api().get(`/api/v1/organizations/${org}/races`).set(auth(manager.token))).status).toBe(200);
    expect((await api().get(`/api/v1/organizations/${org}/races`).set(auth(judge.token))).status).toBe(403);
    expect((await api().get(`/api/v1/organizations/${org}/races`).set(auth(adminB.token))).status).toBe(404);
    expect((await api().get(`/api/v1/organizations/${org}/races`).set(auth(other.token))).status).toBe(404);

    // The list grants no race access: the org admin isn't a member of the manager's race.
    expect((await api().get(`/api/v1/races/${uuid}/snapshot`).set(auth(admin.token))).status).toBe(404);
    expect((await api().get(`/api/v1/races/${uuid}`).set(auth(admin.token))).status).toBe(404);

    // Soft-deleted races leave the list.
    await db.query(`UPDATE races SET "deletedAt" = now() WHERE uuid = $1`, [pub.body.race.uuid]);
    expect((await api().get(`/api/v1/organizations/${org}/races`).set(auth(admin.token))).body.races.map((r: { uuid: string }) => r.uuid))
      .not.toContain(pub.body.race.uuid);
  });

  it("refuses non-staff, other orgs, pending/suspended orgs, other personal accounts → 403 not_org_staff; nothing created", async () => {
    const ours = [judge.id, other.id, adminB.id, admin.id];
    const count = async () => (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM races WHERE "createdByUserId" = ANY($1::uuid[])`, [ours]))!.n;
    const before = await count();
    const pending = await requestOrg(other, "Pending Races");
    const [othersPersonal] = await db.query<{ id: string }>(`SELECT id FROM accounts WHERE "personalUserId" = $1`, [other.id]);
    for (const [u, accountId] of [[judge, org], [other, org], [adminB, org], [other, pending], [admin, othersPersonal.id], [admin, randomUUID()]] as const) {
      const r = await api().post("/api/v1/races").set(auth(u.token)).send({ name: "Nope", accountId });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("not_org_staff");
    }
    await db.query(`UPDATE accounts SET status = 'suspended' WHERE id = $1`, [orgB]);
    const p = await api().post("/api/v1/races/publish").set(auth(adminB.token)).send({ race: { name: "Nope" }, categories: [], riders: [], accountId: orgB });
    expect(p.status).toBe(403);
    expect(p.body.error.code).toBe("not_org_staff");
    await db.query(`UPDATE accounts SET status = 'active' WHERE id = $1`, [orgB]);
    expect((await api().post("/api/v1/races").set(auth(admin.token)).send({ name: "Bad", accountId: "nope" })).status).toBe(400);
    expect(await count()).toBe(before);
    // My own personal account (explicit) works and isn't audited as an org race.
    const [mineP] = await db.query<{ id: string }>(`SELECT id FROM accounts WHERE "personalUserId" = $1`, [other.id]);
    const ok = await api().post("/api/v1/races").set(auth(other.token)).send({ name: "Personal", accountId: mineP.id });
    expect(ok.status).toBe(201);
    expect((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE "raceUuid" = $1`, [ok.body.race.uuid]))!.n).toBe(0);
  });
});
