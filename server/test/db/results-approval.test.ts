/**
 * 1.2.1 — race-wide APPROVE RESULTS.
 *  - Only after Finish Race (an official version exists); only the owner or an admin; the exact
 *    word APPROVED; who/when stored + audited (RaceAdmin resultsApproved).
 *  - Guests: PROVISIONAL (no resultsApproval) until approved, then OFFICIAL (time only, no name).
 *  - A later change of the results (an amendment) withdraws it, audited, back to PROVISIONAL;
 *    approving again is allowed. Per-category podium approvals are untouched by the race row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/db/pool";
import { action, addMember, api, auth, newUser, publishRace, send, startServer, stopServer, type TestUser } from "./helpers";

let owner: TestUser, admin: TestUser, judge: TestUser;

beforeAll(async () => {
  await startServer();
  owner = await newUser("RaOwner");
  admin = await newUser("RaAdmin");
  judge = await newUser("RaJudge");
});
afterAll(stopServer);

const approve = (u: TestUser, r: string, confirm = "APPROVED") => api().post(`/api/v1/races/${r}/results-approval`).set(auth(u.token)).send({ confirm });
const status = async (u: TestUser, r: string) => (await api().get(`/api/v1/races/${r}/approvals`).set(auth(u.token))).body as {
  approvals: unknown[]; resultsApproval: Record<string, unknown> | null; finalized: boolean; canApproveResults: boolean;
};
const ops = async (r: string) =>
  (await db.query<{ op: string; userId: string }>(
    `SELECT payload->>'op' AS op, "userId" FROM race_events WHERE "raceUuid" = $1 AND type = 'RaceAdmin' AND payload->>'op' LIKE 'results%' ORDER BY seq`,
    [r],
  ));

describe("race-wide APPROVE RESULTS", () => {
  it("after Finish Race only; owner/admin only; guests PROVISIONAL → OFFICIAL; an amendment withdraws it; re-approve", async () => {
    const race = await publishRace(owner, 1, 2, 1);
    const r = race.raceUuid;
    await addMember(owner, r, admin, ["admin"]);
    await addMember(owner, r, judge, ["start", "counter", "checkin"]);
    expect((await api().put(`/api/v1/races/${r}/member-writes`).set(auth(owner.token)).send({ enabled: true })).status).toBe(200);
    const token = (await api().put(`/api/v1/races/${r}/publication`).set(auth(owner.token)).send({ published: true })).body.token as string;

    // Race runs and its wave finishes, but no Finish Race yet → refused, nothing offered.
    const riders = race.riders;
    expect((await send(owner, r, action(r, "WaveStarted", { heat: 1 })))[0].applied).toBe(true);
    await send(owner, r, ...riders.map((x, i) => action(r, "AddLap", { riderUuid: x.uuid }, { at: new Date(Date.now() + 61_000 + i * 1000).toISOString() })));
    expect((await send(owner, r, action(r, "WaveFinished", { heat: 1 })))[0].applied).toBe(true);
    expect((await approve(owner, r)).status).toBe(409);
    expect(await status(owner, r)).toMatchObject({ finalized: false, canApproveResults: false, resultsApproval: null });

    expect((await api().post(`/api/v1/races/${r}/finalize`).set(auth(owner.token))).status).toBe(201);
    const pending = await api().get(`/api/v1/public/races/${token}`);
    expect(pending.body.resultsApproval).toBeNull(); // PROVISIONAL

    // Who: judges (even with results.update) never; wrong word refused on the server.
    expect((await approve(judge, r)).status).toBe(403);
    expect((await status(judge, r)).canApproveResults).toBe(false);
    expect((await status(admin, r)).canApproveResults).toBe(true);
    expect((await approve(admin, r, "approved")).status).toBe(400);

    const ok = await approve(admin, r);
    expect(ok.status).toBe(201);
    expect(ok.body.resultsApproval).toMatchObject({ status: "approved", approvedByName: "RaAdmin" });
    expect(await status(owner, r)).toMatchObject({ finalized: true, canApproveResults: false, resultsApproval: { status: "approved" } });
    const guest = await api().get(`/api/v1/public/races/${token}`);
    expect(guest.body.resultsApproval).toEqual({ status: "approved", approvedAt: ok.body.resultsApproval.approvedAt }); // no judge identity
    expect(guest.body.approvals).toEqual([]); // the race row is not a category approval

    // A correction after Finish Race is held back until the owner's amendment applies it.
    const [corr] = await send(owner, r, action(r, "StatusCorrection", { riderUuid: riders[0].uuid, status: "DSQ" }));
    expect(corr).toMatchObject({ applied: false, reason: "race_official" });
    expect((await status(owner, r)).resultsApproval).toMatchObject({ status: "approved" }); // nothing changed yet
    const amend = await api().post(`/api/v1/races/${r}/amend`).set(auth(owner.token)).send({ reason: "DSQ after review", includeActionIds: [corr.actionId] });
    expect(amend.status).toBe(201);

    expect(await status(owner, r)).toMatchObject({ canApproveResults: true, resultsApproval: { status: "invalidated" } });
    expect((await api().get(`/api/v1/public/races/${token}`)).body.resultsApproval).toBeNull(); // back to PROVISIONAL

    expect((await approve(owner, r)).status).toBe(201);
    expect((await api().get(`/api/v1/public/races/${token}`)).body.resultsApproval).toMatchObject({ status: "approved" });
    expect(await ops(r)).toEqual([
      { op: "resultsApproved", userId: admin.id },
      { op: "resultsApprovalInvalidated", userId: owner.id },
      { op: "resultsApproved", userId: owner.id },
    ]);
    const rows = await db.query(`SELECT 1 FROM category_approvals WHERE "raceUuid" = $1`, [r]);
    expect(rows).toHaveLength(1); // one current row per race
  });

  it("guest seq (hotfix rc.5): lastSeq only; moves with an approval; published races only", async () => {
    const race = await publishRace(owner, 1, 1, 1);
    const r = race.raceUuid;
    const token = (await api().put(`/api/v1/races/${r}/publication`).set(auth(owner.token)).send({ published: true })).body.token as string;
    expect((await send(owner, r, action(r, "WaveStarted", { heat: 1 })))[0].applied).toBe(true);
    expect((await api().post(`/api/v1/races/${r}/finalize`).set(auth(owner.token))).status).toBe(201);
    const before = await api().get(`/api/v1/public/races/${token}/seq`);
    expect(before.status).toBe(200);
    expect(Object.keys(before.body)).toEqual(["lastSeq"]); // nothing else is exposed
    expect((await api().get(`/api/v1/public/races/${token}/changes?afterSeq=0`)).status).toBe(410); // polling closed
    expect((await approve(owner, r)).status).toBe(201);
    const after = await api().get(`/api/v1/public/races/${token}/seq`);
    expect(after.body.lastSeq).toBeGreaterThan(before.body.lastSeq);
    expect((await api().get(`/api/v1/public/races/${token}`)).body.lastSeq).toBe(after.body.lastSeq);
    await api().put(`/api/v1/races/${r}/publication`).set(auth(owner.token)).send({ published: false });
    expect((await api().get(`/api/v1/public/races/${token}/seq`)).status).toBe(404);
    expect((await api().get(`/api/v1/public/races/not-a-token/seq`)).status).toBe(404);
  });

  it("members' writes off: an admin can no longer approve, the owner still can", async () => {
    const race = await publishRace(owner, 1, 1, 1);
    const r = race.raceUuid;
    await addMember(owner, r, admin, ["admin"]);
    expect((await send(owner, r, action(r, "WaveStarted", { heat: 1 })))[0].applied).toBe(true);
    expect((await api().post(`/api/v1/races/${r}/finalize`).set(auth(owner.token))).status).toBe(201);
    expect((await approve(admin, r)).status).toBe(403);
    expect((await approve(owner, r)).status).toBe(201);
  });
});
