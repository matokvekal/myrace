/**
 * Commissaire 0.2 Phase 2 (P2-T1, P2-T2) — accounts & organizations: migration 012 backfill,
 * personal accounts, organization requests (pending, no rights), activation in the DB,
 * cross-org isolation, member role rules, audit_logs. Runs against the isolated test database.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/db/pool";
import { ensurePersonalAccount, orgRole } from "../../src/accounts/accounts";
import { api, auth, newUser, publishRace, startServer, stopServer, type TestUser } from "./helpers";

let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser, outsider: TestUser;

beforeAll(async () => {
  await startServer();
  [alice, bob, carol, dave, outsider] = await Promise.all(["OrgAlice", "OrgBob", "OrgCarol", "OrgDave", "OrgOutsider"].map((n) => newUser(n)));
});
afterAll(stopServer);

const personalOf = async (userId: string) =>
  db.query<{ id: string; status: string; type: string }>(`SELECT id, status, type FROM accounts WHERE "personalUserId" = $1`, [userId]);
const accountOfRace = async (raceUuid: string) =>
  (await db.one<{ accountId: string | null }>(`SELECT "accountId" FROM races WHERE uuid = $1`, [raceUuid]))!.accountId;
const auditOf = (accountId: string) =>
  db.query<{ actorUserId: string; action: string; entityType: string; entityId: string; data: Record<string, unknown> }>(
    `SELECT "actorUserId", action, "entityType", "entityId", data FROM audit_logs WHERE "accountId" = $1 ORDER BY "createdAt", id`,
    [accountId],
  );

let slugN = 0;
const requestOrg = (u: TestUser, name = "Test Club") =>
  api().post("/api/v1/organizations").set(auth(u.token)).send({ name, slug: `club-${Date.now()}-${++slugN}` });

/** What the platform does by hand (later: Super Admin app): activate + give an admin/owner. */
async function activate(orgId: string, adminId: string, role: "owner" | "admin" = "admin") {
  await db.query(`UPDATE accounts SET status = 'active' WHERE id = $1`, [orgId]);
  await db.query(`INSERT INTO account_members ("accountId", "userId", role, status) VALUES ($1, $2, $3, 'active')`, [orgId, adminId, role]);
}
const addOrgMember = (orgId: string, userId: string, role: string, status = "active") =>
  db.query(`INSERT INTO account_members ("accountId", "userId", role, status) VALUES ($1, $2, $3, $4)`, [orgId, userId, role, status]);

describe("migration 012 backfill", () => {
  it("gives every existing user a personal account and every race its creator's account (re-runnable)", async () => {
    const race = await publishRace(alice, 1, 1, 2);
    // Simulate rows from before 012: no personal account, no race account.
    await db.query(`DELETE FROM accounts WHERE "personalUserId" = $1`, [alice.id]);
    await db.query(`UPDATE races SET "accountId" = NULL WHERE uuid = $1`, [race.raceUuid]);
    // A race whose creator has no users row any more (no FKs): still gets an account.
    const ghost = randomUUID();
    const ghostRace = randomUUID();
    await db.query(`INSERT INTO races (uuid, "ownerUserId", "createdByUserId", name) VALUES ($1, $2, $2, 'Ghost race')`, [ghostRace, ghost]);

    await db.query(readFileSync(new URL("../../sql/012-organizations.sql", import.meta.url), "utf8"));
    await db.query(readFileSync(new URL("../../sql/012-organizations.sql", import.meta.url), "utf8")); // twice: idempotent

    const mine = await personalOf(alice.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: "personal", status: "active" });
    expect(await accountOfRace(race.raceUuid)).toBe(mine[0].id);
    expect(await accountOfRace(ghostRace)).toBe((await personalOf(ghost))[0].id);
    expect(await db.one(`SELECT count(*)::int AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a."personalUserId" = u.id)`)).toEqual({ n: 0 });
    expect(await db.one(`SELECT count(*)::int AS n FROM races WHERE "accountId" IS NULL`)).toEqual({ n: 0 });
  });

  it("new races (create and publish) belong to the creator's personal account; creator unchanged", async () => {
    const published = await publishRace(bob, 1, 1, 2);
    const created = await api().post("/api/v1/races").set(auth(bob.token)).send({ name: "Empty" });
    expect(created.status).toBe(201);
    const [personal] = await personalOf(bob.id);
    expect(await accountOfRace(published.raceUuid)).toBe(personal.id);
    expect(await accountOfRace(created.body.race.uuid)).toBe(personal.id);
    const row = await db.one<{ createdByUserId: string }>(`SELECT "createdByUserId" FROM races WHERE uuid = $1`, [created.body.race.uuid]);
    expect(row!.createdByUserId).toBe(bob.id);
  });

  it("organization tables have no foreign keys and personal ⇔ personalUserId is enforced", async () => {
    await expect(db.query(`INSERT INTO accounts (type, status) VALUES ('personal', 'active')`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO accounts (type, status, "personalUserId") VALUES ('organization', 'pending', $1)`, [randomUUID()])).rejects.toThrow();
    await expect(db.query(`INSERT INTO accounts (type, status, slug) VALUES ('organization', 'pending', 'Bad Slug')`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO account_invitations ("accountId", "tokenHash", role, "createdBy", "expiresAt") VALUES ($1, $2, 'admin', $3, now())`,
      [randomUUID(), randomUUID(), randomUUID()])).rejects.toThrow();
  });
});

describe("ensurePersonalAccount", () => {
  it("is idempotent under concurrency: one row, one id", async () => {
    const u = await newUser("Concurrent");
    await db.query(`DELETE FROM accounts WHERE "personalUserId" = $1`, [u.id]);
    const ids = await Promise.all(Array.from({ length: 12 }, () => ensurePersonalAccount(db, u.id)));
    expect(new Set(ids).size).toBe(1);
    expect(await personalOf(u.id)).toHaveLength(1);
    expect(await ensurePersonalAccount(db, u.id)).toBe(ids[0]);
  });

  it("GET /accounts returns my personal account", async () => {
    const r = await api().get("/api/v1/accounts").set(auth(carol.token));
    expect(r.status).toBe(200);
    expect(r.body.personal).toMatchObject({ type: "personal", status: "active", id: (await personalOf(carol.id))[0].id });
    expect(r.body.organizations).toEqual([]);
  });
});

describe("organization requests", () => {
  it("creates a pending org with no rights for its creator; audit organization.requested", async () => {
    const r = await requestOrg(alice, "Alice Club");
    expect(r.status).toBe(201);
    const org = r.body.organization;
    expect(org).toMatchObject({ type: "organization", status: "pending", name: "Alice Club" });
    expect(org.requestedBy).toBeUndefined();
    // No membership at all for the requester.
    expect(await db.query(`SELECT 1 FROM account_members WHERE "accountId" = $1`, [org.id])).toEqual([]);
    expect(await orgRole(db, org.id, alice.id)).toBeNull();
    // The requester sees the pending org; nobody else does.
    const mine = await api().get(`/api/v1/organizations/${org.id}`).set(auth(alice.token));
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ myRole: null, requestedByMe: true, organization: { status: "pending" } });
    expect((await api().get(`/api/v1/organizations/${org.id}`).set(auth(outsider.token))).status).toBe(404);
    // Every write is refused while pending, for the requester too.
    const patch = await api().patch(`/api/v1/organizations/${org.id}`).set(auth(alice.token)).send({ name: "Renamed" });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe("organization_inactive");
    expect((await api().get(`/api/v1/organizations/${org.id}/members`).set(auth(alice.token))).body.error.code).toBe("organization_inactive");
    // Listed as a request, not as an organization I belong to.
    const list = await api().get("/api/v1/accounts").set(auth(alice.token));
    expect(list.body.organizations.map((o: { id: string }) => o.id)).not.toContain(org.id);
    expect(list.body.requests.map((o: { id: string }) => o.id)).toContain(org.id);

    const audit = await auditOf(org.id);
    expect(audit).toEqual([expect.objectContaining({ actorUserId: alice.id, action: "organization.requested", entityType: "organization", entityId: org.id })]);
  });

  it("validates name/slug, refuses a taken slug and more than 5 pending requests", async () => {
    expect((await api().post("/api/v1/organizations").set(auth(dave.token)).send({ name: "x" })).status).toBe(400);
    expect((await api().post("/api/v1/organizations").set(auth(dave.token)).send({ name: "Okay", slug: "NO SPACES!" })).status).toBe(400);
    const slug = `taken-${Date.now()}`;
    expect((await api().post("/api/v1/organizations").set(auth(dave.token)).send({ name: "First", slug })).status).toBe(201);
    const dup = await api().post("/api/v1/organizations").set(auth(outsider.token)).send({ name: "Second", slug });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("slug_taken");
    // dave has 1 pending; 4 more are allowed, the 6th is refused.
    for (let i = 0; i < 4; i++) expect((await requestOrg(dave)).status).toBe(201);
    const sixth = await requestOrg(dave);
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.code).toBe("too_many_requests");
  });
});

describe("active organization: admin rights, isolation, member rules", () => {
  let orgA: string, orgB: string;

  beforeAll(async () => {
    orgA = (await requestOrg(alice, "Club A")).body.organization.id;
    orgB = (await requestOrg(bob, "Club B")).body.organization.id;
    await activate(orgA, alice.id, "admin");
    await activate(orgB, bob.id, "owner");
  });

  it("after activation in the DB the admin can edit the profile; audit lists the changed fields", async () => {
    const r = await api().patch(`/api/v1/organizations/${orgA}`).set(auth(alice.token)).send({ name: "Club A Renamed", contact: "office@club-a.test" });
    expect(r.status).toBe(200);
    expect(r.body.organization).toMatchObject({ name: "Club A Renamed", contact: "office@club-a.test", status: "active" });
    const last = (await auditOf(orgA)).at(-1)!;
    expect(last).toMatchObject({ actorUserId: alice.id, action: "organization.updated", entityId: orgA });
    expect(last.data.fields).toEqual(["name", "contact"]);

    const list = await api().get("/api/v1/accounts").set(auth(alice.token));
    expect(list.body.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ id: orgA, myRole: "admin", myStatus: "active", status: "active" })]));
  });

  it("cross-org isolation: A's admin gets 404 for everything of B", async () => {
    await addOrgMember(orgB, carol.id, "judge");
    expect((await api().get(`/api/v1/organizations/${orgB}`).set(auth(alice.token))).status).toBe(404);
    expect((await api().patch(`/api/v1/organizations/${orgB}`).set(auth(alice.token)).send({ name: "Hacked" })).status).toBe(404);
    expect((await api().get(`/api/v1/organizations/${orgB}/members`).set(auth(alice.token))).status).toBe(404);
    expect((await api().patch(`/api/v1/organizations/${orgB}/members/${carol.id}`).set(auth(alice.token)).send({ role: "member" })).status).toBe(404);
    expect((await api().delete(`/api/v1/organizations/${orgB}/members/${carol.id}`).set(auth(alice.token))).status).toBe(404);
    // Unknown and malformed ids look the same.
    expect((await api().get(`/api/v1/organizations/${randomUUID()}`).set(auth(alice.token))).status).toBe(404);
    expect((await api().get(`/api/v1/organizations/not-a-uuid`).set(auth(alice.token))).status).toBe(404);
    // A personal account is never an organization.
    const [personal] = await personalOf(bob.id);
    expect((await api().get(`/api/v1/organizations/${personal.id}`).set(auth(bob.token))).status).toBe(404);
    expect((await db.one<{ name: string }>(`SELECT name FROM accounts WHERE id = $1`, [orgB]))!.name).toBe("Club B");
  });

  it("member list for owner/admin/manager only; judges and members are refused", async () => {
    await addOrgMember(orgA, dave.id, "manager");
    await addOrgMember(orgA, carol.id, "judge");
    const asManager = await api().get(`/api/v1/organizations/${orgA}/members`).set(auth(dave.token));
    expect(asManager.status).toBe(200);
    expect(asManager.body.members.map((m: { userId: string; role: string }) => [m.userId, m.role])).toEqual([
      [alice.id, "admin"], [dave.id, "manager"], [carol.id, "judge"],
    ]);
    const asJudge = await api().get(`/api/v1/organizations/${orgA}/members`).set(auth(carol.token));
    expect(asJudge.status).toBe(403);
    // A judge sees the profile, but can't edit it, and the manager can't manage members.
    expect((await api().get(`/api/v1/organizations/${orgA}`).set(auth(carol.token))).body.myRole).toBe("judge");
    expect((await api().patch(`/api/v1/organizations/${orgA}`).set(auth(carol.token)).send({ name: "Judge Club" })).status).toBe(403);
    expect((await api().patch(`/api/v1/organizations/${orgA}/members/${carol.id}`).set(auth(dave.token)).send({ role: "member" })).status).toBe(403);
    // Org membership never grants race access.
    const race = await publishRace(alice, 1, 1, 2);
    expect((await api().get(`/api/v1/races/${race.raceUuid}`).set(auth(carol.token))).status).toBe(404);
  });

  it("role changes: manager|judge|member only; owner/admin rows are DB-only; owner protected; audited", async () => {
    const ok = await api().patch(`/api/v1/organizations/${orgA}/members/${carol.id}`).set(auth(alice.token)).send({ role: "member" });
    expect(ok.status).toBe(200);
    expect((await orgRole(db, orgA, carol.id))!.role).toBe("member");
    expect((await auditOf(orgA)).at(-1)).toMatchObject({
      actorUserId: alice.id, action: "organization.member_role_changed", entityType: "account_member", entityId: carol.id,
      data: { userId: carol.id, from: "judge", to: "member" },
    });
    // Promoting to admin/owner through the API is impossible.
    expect((await api().patch(`/api/v1/organizations/${orgA}/members/${carol.id}`).set(auth(alice.token)).send({ role: "admin" })).status).toBe(400);
    // An admin row (here: alice's own) can't be changed or removed through the API.
    const self = await api().patch(`/api/v1/organizations/${orgA}/members/${alice.id}`).set(auth(alice.token)).send({ role: "member" });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("owner_only");
    // Owner protected.
    await addOrgMember(orgA, bob.id, "owner");
    const delOwner = await api().delete(`/api/v1/organizations/${orgA}/members/${bob.id}`).set(auth(alice.token));
    expect(delOwner.status).toBe(403);
    expect(delOwner.body.error.code).toBe("owner_protected");
    expect((await api().patch(`/api/v1/organizations/${orgA}/members/${bob.id}`).set(auth(alice.token)).send({ role: "judge" })).body.error.code).toBe("owner_only");
    // Unknown member → 404.
    expect((await api().patch(`/api/v1/organizations/${orgA}/members/${outsider.id}`).set(auth(alice.token)).send({ role: "judge" })).status).toBe(404);
  });

  it("remove sets status removed (row kept), hides the org from the member, and is audited", async () => {
    const r = await api().delete(`/api/v1/organizations/${orgA}/members/${carol.id}`).set(auth(alice.token));
    expect(r.status).toBe(204);
    expect(await orgRole(db, orgA, carol.id)).toMatchObject({ status: "removed" });
    expect((await api().get(`/api/v1/organizations/${orgA}`).set(auth(carol.token))).status).toBe(404);
    const list = await api().get("/api/v1/accounts").set(auth(carol.token));
    expect(list.body.organizations.map((o: { id: string }) => o.id)).not.toContain(orgA);
    expect((await auditOf(orgA)).at(-1)).toMatchObject({ actorUserId: alice.id, action: "organization.member_removed", entityId: carol.id, data: { role: "member" } });
    // Removed twice → 404.
    expect((await api().delete(`/api/v1/organizations/${orgA}/members/${carol.id}`).set(auth(alice.token))).status).toBe(404);
  });

  it("a suspended org blocks every write but stays visible to its members", async () => {
    await db.query(`UPDATE accounts SET status = 'suspended' WHERE id = $1`, [orgB]);
    await addOrgMember(orgB, dave.id, "member");
    expect((await api().get(`/api/v1/organizations/${orgB}`).set(auth(bob.token))).status).toBe(200);
    for (const r of [
      await api().patch(`/api/v1/organizations/${orgB}`).set(auth(bob.token)).send({ name: "While suspended" }),
      await api().patch(`/api/v1/organizations/${orgB}/members/${dave.id}`).set(auth(bob.token)).send({ role: "judge" }),
      await api().delete(`/api/v1/organizations/${orgB}/members/${dave.id}`).set(auth(bob.token)),
    ]) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("organization_inactive");
    }
    expect((await orgRole(db, orgB, dave.id))!.role).toBe("member");
  });

  it("audit rows never carry secrets", async () => {
    const rows = await db.query<{ data: unknown }>(`SELECT data FROM audit_logs WHERE "accountId" = ANY($1::uuid[])`, [[orgA, orgB]]);
    expect(rows.length).toBeGreaterThan(0);
    const text = JSON.stringify(rows);
    for (const secret of [alice.token, bob.token, "password", "tokenHash", "joinCode"]) expect(text).not.toContain(secret);
  });
});

describe("QA fixes: visibility, member list, audit, validation", () => {
  let admin: TestUser, manager: TestUser, req: TestUser, other: TestUser, invitedU: TestUser, suspendedU: TestUser, judge: TestUser;
  let org: string;

  beforeAll(async () => {
    [admin, manager, req, other, invitedU, suspendedU, judge] = await Promise.all(
      ["QaAdmin", "QaManager", "QaReq", "QaOther", "QaInvited", "QaSuspended", "QaJudge"].map((n) => newUser(n)));
    org = (await requestOrg(admin, "QA Club")).body.organization.id;
    await activate(org, admin.id, "admin");
    await addOrgMember(org, manager.id, "manager");
    await addOrgMember(org, judge.id, "judge");
  });

  it("requester view: only while pending and only without any member row; requests list follows", async () => {
    const pending = (await requestOrg(req, "Req Pending")).body.organization.id;
    expect((await api().get(`/api/v1/organizations/${pending}`).set(auth(req.token))).status).toBe(200);
    // A removed member row (any status) ends the requester view, also for the list.
    await addOrgMember(pending, req.id, "member", "removed");
    expect((await api().get(`/api/v1/organizations/${pending}`).set(auth(req.token))).status).toBe(404);
    expect((await api().get("/api/v1/accounts").set(auth(req.token))).body.requests.map((o: { id: string }) => o.id)).not.toContain(pending);
    // Activated without making the requester a member: no view, no request entry.
    const activated = (await requestOrg(req, "Req Activated")).body.organization.id;
    await db.query(`UPDATE accounts SET status = 'active' WHERE id = $1`, [activated]);
    expect((await api().get(`/api/v1/organizations/${activated}`).set(auth(req.token))).status).toBe(404);
    expect((await api().get("/api/v1/accounts").set(auth(req.token))).body.requests.map((o: { id: string }) => o.id)).not.toContain(activated);
  });

  it("GET /accounts never shows another user's pending request", async () => {
    const theirs = (await requestOrg(req, "Not Yours")).body.organization.id;
    const list = await api().get("/api/v1/accounts").set(auth(other.token));
    expect(JSON.stringify(list.body)).not.toContain(theirs);
    expect(list.body.requests).toEqual([]);
  });

  it("members with status invited or suspended can't see or act", async () => {
    await addOrgMember(org, invitedU.id, "admin", "invited");
    await addOrgMember(org, suspendedU.id, "admin", "suspended");
    for (const u of [invitedU, suspendedU]) {
      expect((await api().get(`/api/v1/organizations/${org}`).set(auth(u.token))).status).toBe(404);
      expect((await api().get(`/api/v1/organizations/${org}/members`).set(auth(u.token))).status).toBe(404);
      expect((await api().patch(`/api/v1/organizations/${org}`).set(auth(u.token)).send({ name: "Nope" })).status).toBe(404);
      expect((await api().patch(`/api/v1/organizations/${org}/members/${judge.id}`).set(auth(u.token)).send({ role: "member" })).status).toBe(404);
      expect((await api().delete(`/api/v1/organizations/${org}/members/${judge.id}`).set(auth(u.token))).status).toBe(404);
    }
    expect((await orgRole(db, org, judge.id))).toMatchObject({ role: "judge", status: "active" });
  });

  it("member emails only for owner/admin; a manager gets name/role/status", async () => {
    const asAdmin = await api().get(`/api/v1/organizations/${org}/members`).set(auth(admin.token));
    expect(asAdmin.body.members.find((m: { userId: string }) => m.userId === judge.id).email).toBe(judge.email);
    const asManager = await api().get(`/api/v1/organizations/${org}/members`).set(auth(manager.token));
    expect(asManager.status).toBe(200);
    for (const m of asManager.body.members) expect(m).not.toHaveProperty("email");
    expect(JSON.stringify(asManager.body)).not.toContain(judge.email);
  });

  it("admin changing their own role → 403; PATCH/DELETE on a removed member → 404; non-uuid ids → 404", async () => {
    const self = await api().patch(`/api/v1/organizations/${org}/members/${admin.id}`).set(auth(admin.token)).send({ role: "manager" });
    expect(self.status).toBe(403);
    expect((await orgRole(db, org, admin.id))!.role).toBe("admin");
    const gone = await newUser("QaGone");
    await addOrgMember(org, gone.id, "member", "removed");
    expect((await api().patch(`/api/v1/organizations/${org}/members/${gone.id}`).set(auth(admin.token)).send({ role: "judge" })).status).toBe(404);
    expect((await api().delete(`/api/v1/organizations/${org}/members/${gone.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await orgRole(db, org, gone.id))).toMatchObject({ role: "member", status: "removed" });
    expect((await api().patch(`/api/v1/organizations/${org}/members/not-a-uuid`).set(auth(admin.token)).send({ role: "judge" })).status).toBe(404);
    expect((await api().delete(`/api/v1/organizations/${org}/members/123`).set(auth(admin.token))).status).toBe(404);
    expect((await api().patch(`/api/v1/organizations/not-a-uuid`).set(auth(admin.token)).send({ name: "Xx" })).status).toBe(404);
    expect((await api().get(`/api/v1/organizations/not-a-uuid/members`).set(auth(admin.token))).status).toBe(404);
  });

  it("PATCH with unknown fields → 400 and nothing changes", async () => {
    for (const body of [{ status: "active" }, { slug: "new-slug" }, { name: "Ok Name", requestedBy: admin.id }]) {
      expect((await api().patch(`/api/v1/organizations/${org}`).set(auth(admin.token)).send(body)).status).toBe(400);
    }
    expect((await db.one<{ name: string }>(`SELECT name FROM accounts WHERE id = $1`, [org]))!.name).toBe("QA Club");
    expect((await api().patch(`/api/v1/organizations/${org}/members/${judge.id}`).set(auth(admin.token)).send({ role: "member", status: "removed" })).status).toBe(400);
  });

  it("organization.updated audit: field names always, values for name/description only, never contact", async () => {
    const r = await api().patch(`/api/v1/organizations/${org}`).set(auth(admin.token))
      .send({ name: "QA Club 2", description: "About us", contact: "secret-phone-0501234567" });
    expect(r.status).toBe(200);
    const last = (await auditOf(org)).at(-1)!;
    expect(last.data.fields).toEqual(["name", "description", "contact"]);
    expect(last.data.name).toEqual({ from: "QA Club", to: "QA Club 2" });
    expect(last.data.description).toEqual({ from: "", to: "About us" });
    expect(last.data).not.toHaveProperty("contact");
    expect(JSON.stringify(last.data)).not.toContain("0501234567");
  });

  it("the personal account name is read live from users.name", async () => {
    await db.query(`UPDATE users SET name = 'Renamed Other' WHERE id = $1`, [other.id]);
    const r = await api().get("/api/v1/accounts").set(auth(other.token));
    expect(r.body.personal.name).toBe("Renamed Other");
  });
});
