/**
 * 0.3.5 — official podium approval per category + audited name correction after GO.
 *  - Only a judge allowed to approve (live.update / results.update, category in scope) can,
 *    only for a FINISHED category, only with the exact word APPROVED; who/when stored + audited.
 *  - Guests see only valid approvals, without judge identity.
 *  - Any change to that category's result voids the approval (audited); other categories don't.
 *  - After GO a normal rider edit stays "locked"; RiderNameCorrected (reason required,
 *    results.update) is the audited way, and it invalidates the approval.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/db/pool";
import { action, addMember, api, auth, newUser, publishRace, send, snapshot, riderOf, startServer, stopServer, type TestUser } from "./helpers";

let owner: TestUser, judge: TestUser, checkin: TestUser, resultsJudge: TestUser, viewer: TestUser;

beforeAll(async () => {
  await startServer();
  owner = await newUser("ApOwner");
  judge = await newUser("ApJudge");
  checkin = await newUser("ApCheckin");
  resultsJudge = await newUser("ApResults");
  viewer = await newUser("ApViewer");
});
afterAll(stopServer);

const approve = (u: TestUser, r: string, c: string, confirm = "APPROVED") =>
  api().post(`/api/v1/races/${r}/categories/${c}/approval`).set(auth(u.token)).send({ confirm });
const approvals = async (u: TestUser, r: string) => (await api().get(`/api/v1/races/${r}/approvals`).set(auth(u.token))).body as { approvals: Record<string, unknown>[]; canApprove: string[] };
const adminOps = async (r: string) =>
  (await db.query<{ op: string; userId: string; categoryUuid: string; cause: string | null }>(
    `SELECT payload->>'op' AS op, "userId", payload->>'categoryUuid' AS "categoryUuid", payload->>'cause' AS cause
     FROM race_events WHERE "raceUuid" = $1 AND type = 'RaceAdmin' AND payload->>'op' IN ('categoryApproved', 'approvalInvalidated') ORDER BY seq`,
    [r],
  ));

describe("official podium approval", () => {
  it("judge approves a finished category with APPROVED; guests see it; a result change voids it; name fix is audited", async () => {
    const race = await publishRace(owner, 2, 2, 1);
    const r = race.raceUuid;
    const [cat1, cat2] = race.cats;
    await addMember(owner, r, judge, ["start", "counter", "checkin"]);
    await addMember(owner, r, checkin, ["checkin"]);
    await addMember(owner, r, resultsJudge, ["results"]);
    await addMember(owner, r, viewer, ["viewer"]);
    expect((await api().put(`/api/v1/races/${r}/member-writes`).set(auth(owner.token)).send({ enabled: true })).status).toBe(200);

    // Not finished yet → refused.
    expect((await approve(judge, r, cat1.uuid)).status).toBe(409);

    // Wave 1 runs one lap each and finishes.
    const w1 = race.riders.filter((x) => x.heat === 1);
    expect((await send(judge, r, action(r, "WaveStarted", { heat: 1 })))[0].applied).toBe(true);
    const laps = await send(judge, r, ...w1.map((x, i) => action(r, "AddLap", { riderUuid: x.uuid }, { at: new Date(Date.now() + 61_000 + i * 1000).toISOString() })));
    expect(laps.every((x) => x.applied)).toBe(true);
    expect((await send(judge, r, action(r, "WaveFinished", { heat: 1 })))[0].applied).toBe(true);

    // The word is checked on the server; viewers and check-in-only judges can't approve.
    expect((await approve(judge, r, cat1.uuid, "approved")).status).toBe(400);
    expect((await approve(judge, r, cat1.uuid, "APPROVED ")).status).toBe(400);
    expect((await approve(viewer, r, cat1.uuid)).status).toBe(403);
    expect((await approve(checkin, r, cat1.uuid)).status).toBe(403);
    expect((await approvals(checkin, r)).canApprove).toEqual([]);
    expect((await approvals(judge, r)).canApprove).toEqual([cat1.uuid]);
    expect((await approve(judge, r, cat2.uuid)).status).toBe(409); // wave 2 never ran

    const ok = await approve(judge, r, cat1.uuid);
    expect(ok.status).toBe(201);
    expect(ok.body.approval).toMatchObject({ categoryUuid: cat1.uuid, status: "approved", approvedByName: "ApJudge" });
    expect(typeof ok.body.approval.approvedAt).toBe("string");
    const row = await db.one<{ approvedBy: string; status: string }>(`SELECT "approvedBy", status FROM category_approvals WHERE "raceUuid" = $1 AND "categoryUuid" = $2`, [r, cat1.uuid]);
    expect(row).toMatchObject({ approvedBy: judge.id, status: "approved" });
    expect((await approvals(viewer, r)).approvals).toEqual([expect.objectContaining({ categoryUuid: cat1.uuid, status: "approved" })]);

    // Guests: valid approvals only, no judge identity.
    const pub = await api().put(`/api/v1/races/${r}/publication`).set(auth(owner.token)).send({ published: true });
    const token = pub.body.token as string;
    const guest = await api().get(`/api/v1/public/races/${token}`);
    expect(guest.body.approvals).toEqual([{ categoryUuid: cat1.uuid, status: "approved", approvedAt: ok.body.approval.approvedAt }]);

    // Another category racing doesn't touch it.
    const w2 = race.riders.filter((x) => x.heat === 2);
    await send(owner, r, action(r, "WaveStarted", { heat: 2 }), action(r, "AddLap", { riderUuid: w2[0].uuid }, { at: new Date(Date.now() + 61_000).toISOString() }));
    expect((await approvals(owner, r)).approvals[0]).toMatchObject({ status: "approved" });

    // After GO: the normal edit stays locked; the audited correction needs results.update and a reason.
    const fix = (changes: Record<string, unknown>, reason?: string) => action(r, "RiderNameCorrected", { riderUuid: w1[0].uuid, changes, ...(reason === undefined ? {} : { reason }) });
    expect((await send(owner, r, action(r, "RiderEdited", { riderUuid: w1[0].uuid, changes: { lastName: "Typo" } })))[0].reason).toBe("locked");
    expect((await send(judge, r, fix({ lastName: "Fixed" }, "Spelling on the start list")))[0].reason).toBe("forbidden");
    expect((await send(owner, r, fix({ lastName: "Fixed" })))[0].reason).toBe("invalid");
    expect((await send(owner, r, fix({}, "Nothing")))[0].reason).toBe("invalid");
    expect((await send(owner, r, fix({ bibNumber: 9 }, "Not a name")))[0].reason).toBe("invalid");
    const done = await send(resultsJudge, r, fix({ lastName: "Fixed" }, "Spelling on the start list"));
    expect(done[0]).toMatchObject({ applied: true, reason: null });
    expect(riderOf(await snapshot(owner, r), w1[0].uuid)?.lastName).toBe("Fixed");
    const ev = await db.one<{ userId: string; payload: { reason: string } }>(`SELECT "userId", payload FROM race_events WHERE "actionId" = $1`, [done[0].actionId]);
    expect(ev).toMatchObject({ userId: resultsJudge.id, payload: { reason: "Spelling on the start list" } });

    // …which voids the approval (audited), and guests no longer see it.
    const after = (await approvals(owner, r)).approvals[0];
    expect(after).toMatchObject({ status: "invalidated" });
    expect(String(after.invalidatedReason)).toMatch(/RiderNameCorrected/);
    expect((await api().get(`/api/v1/public/races/${token}`)).body.approvals).toEqual([]);

    // Re-approval, then a status correction voids it again.
    expect((await approve(resultsJudge, r, cat1.uuid)).status).toBe(201);
    expect((await send(owner, r, action(r, "StatusCorrection", { riderUuid: w1[1].uuid, status: "DSQ" })))[0].applied).toBe(true);
    expect((await approvals(owner, r)).approvals[0]).toMatchObject({ status: "invalidated" });

    expect((await adminOps(r)).map((e) => [e.op, e.userId, e.categoryUuid])).toEqual([
      ["categoryApproved", judge.id, cat1.uuid],
      ["approvalInvalidated", resultsJudge.id, cat1.uuid],
      ["categoryApproved", resultsJudge.id, cat1.uuid],
      ["approvalInvalidated", owner.id, cat1.uuid],
    ]);
  });

  it("members' writes off: only the owner approves", async () => {
    const race = await publishRace(owner, 1, 1, 1);
    const r = race.raceUuid;
    await addMember(owner, r, judge, ["start", "counter", "checkin"]);
    await send(owner, r, action(r, "WaveStarted", { heat: 1 }), action(r, "AddLap", { riderUuid: race.riders[0].uuid }, { at: new Date(Date.now() + 61_000).toISOString() }), action(r, "WaveFinished", { heat: 1 }));
    expect((await approve(judge, r, race.cats[0].uuid)).status).toBe(403);
    expect((await approve(owner, r, race.cats[0].uuid)).status).toBe(201);
  });
});
