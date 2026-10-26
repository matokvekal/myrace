/** Accounts, sessions, invitations and race isolation. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { action, addMember, api, auth, newUser, publishRace, send, snapshot, socketFor, startServer, stopServer, type TestUser } from "./helpers";
import * as messaging from "../src/lib/messaging";

beforeAll(startServer);
afterAll(stopServer);

describe("accounts and sessions", () => {
  it("password sign-in; wrong password and unknown email get the same answer", async () => {
    const u = await newUser("Pw");
    expect((await api().post("/api/v1/auth/login").send({ email: u.email, password: "password-123" })).status).toBe(200);
    const wrong = await api().post("/api/v1/auth/login").send({ email: u.email, password: "nope-nope-1" });
    const unknown = await api().post("/api/v1/auth/login").send({ email: "nobody@x.test", password: "nope-nope-1" });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("a second account with the same email is refused", async () => {
    const u = await newUser("Dup");
    expect((await api().post("/api/v1/auth/register").send({ email: u.email, password: "password-123", name: "X" })).status).toBe(409);
  });

  it("refresh tokens rotate; re-using an old one revokes every session", async () => {
    const u = await newUser("Rot");
    const r1 = await api().post("/api/v1/auth/refresh").send({ refreshToken: u.refreshToken });
    expect(r1.status).toBe(200);
    const reuse = await api().post("/api/v1/auth/refresh").send({ refreshToken: u.refreshToken });
    expect(reuse.status).toBe(401);
    expect((await api().get("/api/v1/me").set(auth(r1.body.accessToken))).status).toBe(401);
  });

  it("logout ends the session", async () => {
    const u = await newUser("Out");
    expect((await api().post("/api/v1/auth/logout").set(auth(u.token))).status).toBe(204);
    expect((await api().get("/api/v1/me").set(auth(u.token))).status).toBe(401);
  });

  it("email code: signs in, verifies the email, and is single-use", async () => {
    const spy = vi.spyOn(messaging, "sendMail");
    const email = `code.${Date.now()}@x.test`;
    expect((await api().post("/api/v1/auth/email-code").send({ email })).status).toBe(202);
    const code = /code is (\d{6})/.exec(String(spy.mock.calls.at(-1)?.[2]))?.[1];
    const ok = await api().post("/api/v1/auth/email-code/verify").send({ email, code });
    expect(ok.status).toBe(200);
    expect(ok.body.user.identities[0]).toMatchObject({ provider: "email_otp", emailVerified: true });
    expect((await api().post("/api/v1/auth/email-code/verify").send({ email, code })).status).toBe(400);
  });

  it("SMS sign-in stays off until enabled", async () => {
    expect((await api().get("/api/v1/auth/sms-code/enabled")).body).toEqual({ enabled: false });
    expect((await api().post("/api/v1/auth/sms-code").send({ phone: "+972501234567" })).status).toBe(404);
  });

  it("a Google token is verified against Commissaire's own client id (forged token refused)", async () => {
    expect((await api().post("/api/v1/auth/google").send({ idToken: "forged.token.value" })).status).toBe(401);
  });
});

describe("invitations", () => {
  let owner: TestUser;
  let raceUuid: string;
  beforeAll(async () => {
    owner = await newUser("InvOwner");
    raceUuid = (await publishRace(owner, 2, 2)).raceUuid;
  });

  it("an email invitation needs that email verified on the accepting account", async () => {
    const spy = vi.spyOn(messaging, "sendMail");
    const email = `invitee.${Date.now()}@x.test`;
    const inv = await api().post(`/api/v1/races/${raceUuid}/invitations`).set(auth(owner.token)).send({ emails: [email], roles: ["counter"] });
    expect(inv.status).toBe(201);
    expect(String(spy.mock.calls.at(-1)?.[2])).toContain("/invite/");
    const token = inv.body.invitations[0].url.split("/invite/")[1];
    // Registered with a password: email not verified → cannot accept.
    const pw = await api().post("/api/v1/auth/register").send({ email, password: "password-123", name: "Invitee" });
    expect((await api().post(`/api/v1/invitations/${token}/accept`).set(auth(pw.body.accessToken))).status).toBe(403);
    // Verifies the email with a code → the invitation shows up and can be accepted.
    await api().post("/api/v1/auth/email-code").send({ email });
    const code = /code is (\d{6})/.exec(String(spy.mock.calls.at(-1)?.[2]))?.[1];
    const ver = await api().post("/api/v1/auth/email-code/verify").send({ email, code });
    const mine = await api().get("/api/v1/me/invitations").set(auth(ver.body.accessToken));
    expect(mine.body.invitations.map((i: any) => i.raceUuid)).toContain(raceUuid);
    expect((await api().post(`/api/v1/invitations/${token}/accept`).set(auth(ver.body.accessToken))).status).toBe(200);
    expect((await snapshot({ token: ver.body.accessToken } as TestUser, raceUuid)).access.roles).toEqual(["counter"]);
    // Single-use.
    const other = await newUser("Other");
    expect((await api().post(`/api/v1/invitations/${token}/accept`).set(auth(other.token))).status).toBe(410);
  });

  it("directory: inviting a group invites its contacts; being in a directory grants nothing", async () => {
    const a = await newUser("DirA");
    const c = await api().post("/api/v1/me/contacts").set(auth(owner.token)).send({ name: "Dir A", email: a.email });
    expect(c.body.contact.userId).toBe(a.id);
    const g = await api().post("/api/v1/me/groups").set(auth(owner.token)).send({ name: `Federation ${Date.now()}` });
    await api().put(`/api/v1/me/groups/${g.body.group.id}/contacts`).set(auth(owner.token)).send({ contactIds: [c.body.contact.id] });
    expect((await api().get(`/api/v1/races/${raceUuid}/snapshot`).set(auth(a.token))).status).toBe(404);
    const inv = await api().post(`/api/v1/races/${raceUuid}/invitations`).set(auth(owner.token)).send({ groupIds: [g.body.group.id], roles: ["start"], sendEmail: false });
    expect(inv.body.invitations[0].userId).toBe(a.id);
    const mine = await api().get("/api/v1/me/invitations").set(auth(a.token));
    const accept = await api().post(`/api/v1/me/invitations/${mine.body.invitations[0].id}/accept`).set(auth(a.token));
    expect(accept.status).toBe(200);
  });

  it("an expired, revoked or used-up link cannot be used", async () => {
    const inv = await api().post(`/api/v1/races/${raceUuid}/invitations`).set(auth(owner.token)).send({ link: true, maxUses: 1, roles: [] });
    const token = inv.body.invitations[0].url.split("/invite/")[1];
    await api().delete(`/api/v1/races/${raceUuid}/invitations/${inv.body.invitations[0].id}`).set(auth(owner.token));
    const u = await newUser("Late");
    expect((await api().get(`/api/v1/invitations/${token}`).set(auth(u.token))).body.status).toBe("revoked");
    expect((await api().post(`/api/v1/invitations/${token}/accept`).set(auth(u.token))).status).toBe(410);
  });
});

describe("race isolation", () => {
  it("a member of race A gets 404 for race B — same as an unknown race — on every route and the socket", async () => {
    const ownerA = await newUser("A");
    const ownerB = await newUser("B");
    const a = await publishRace(ownerA, 1, 2);
    const b = await publishRace(ownerB, 1, 2);
    for (const path of ["", "/snapshot", "/changes?afterSeq=0", "/history", "/results", "/members", "/invitations", "/official"]) {
      const r = await api().get(`/api/v1/races/${b.raceUuid}${path}`).set(auth(ownerA.token));
      const unknown = await api().get(`/api/v1/races/00000000-0000-4000-8000-000000000000${path}`).set(auth(ownerA.token));
      expect([path, r.status]).toEqual([path, 404]);
      expect(r.body).toEqual(unknown.body);
    }
    const s = await socketFor(ownerA);
    expect(await s.emitWithAck("join", { raceUuid: b.raceUuid })).toEqual({ ok: false, error: "not_member" });
    s.close();
  });

  it("an Action addressed to race B, or naming race B's rider, cannot change race B through race A", async () => {
    const ownerA = await newUser("A2");
    const ownerB = await newUser("B2");
    const a = await publishRace(ownerA, 1, 2);
    const b = await publishRace(ownerB, 1, 2);
    const res = await send(ownerA, a.raceUuid,
      action(b.raceUuid, "CommentSet", { riderUuid: b.riders[0].uuid, comment: "hijack" }),
      action(a.raceUuid, "CommentSet", { riderUuid: b.riders[0].uuid, comment: "hijack" }));
    expect(res.map((r) => r.reason)).toEqual(["invalid", "invalid"]);
    expect((await snapshot(ownerB, b.raceUuid)).riders[0].comment).not.toBe("hijack");
    expect((await api().post(`/api/v1/races/${b.raceUuid}/actions`).set(auth(ownerA.token)).send({ actions: [action(b.raceUuid, "CommentSet", { riderUuid: b.riders[0].uuid, comment: "x" })] })).status).toBe(404);
  });

  it("one user in two races with different roles; each race's sequence is its own", async () => {
    const u = await newUser("Both");
    const o1 = await newUser("O1");
    const o2 = await newUser("O2");
    const r1 = await publishRace(o1, 2, 1);
    const r2 = await publishRace(o2, 2, 1);
    await addMember(o1, r1.raceUuid, u, ["counter"], { waves: [1] });
    await addMember(o2, r2.raceUuid, u, ["admin"]);
    expect((await snapshot(u, r1.raceUuid)).access.roles).toEqual(["counter"]);
    expect((await snapshot(u, r2.raceUuid)).access.roles).toEqual(["admin"]);
    const races = await api().get("/api/v1/races").set(auth(u.token));
    expect(races.body.races).toHaveLength(2);
    // Admin rights in race 2 give nothing in race 1.
    const res = await send(u, r1.raceUuid, action(r1.raceUuid, "RaceEdited", { changes: { name: "renamed" } }));
    expect(res[0].reason).toBe("forbidden");
  });
});
