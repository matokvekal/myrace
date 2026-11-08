/**
 * 0.3.3 — invited judges (start + counter + checkin, member writes on) on RACE / Check-In:
 * check-ins reach every joined device at once (both ways), judges manage riders before GO
 * (add, bib, name, check-in, DNS) and only statuses after GO, and every judge can read the
 * shared Check-In change history (who/when, nothing private). No configuration, no delete.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/db/pool";
import { action, addMember, api, auth, collect, newUser, publishRace, send, socketFor, startServer, stopServer, until, type TestUser } from "./helpers";

const JUDGE_ROLES = ["start", "counter", "checkin"];
let owner: TestUser, judge: TestUser, viewer: TestUser;

beforeAll(async () => {
  await startServer();
  owner = await newUser("CiOwner");
  judge = await newUser("CiJudge");
  viewer = await newUser("CiViewer");
});
afterAll(stopServer);

const history = (user: TestUser, raceUuid: string) => api().get(`/api/v1/races/${raceUuid}/history?scope=checkin`).set(auth(user.token));

describe("judge check-in sync and shared change history", () => {
  it("check-ins push both ways; judge rider management before GO, statuses only after; read-only history", async () => {
    const race = await publishRace(owner, 2, 2, 2);
    const r = race.raceUuid;
    await addMember(owner, r, judge, JUDGE_ROLES);
    await addMember(owner, r, viewer, ["viewer"]);
    expect((await api().put(`/api/v1/races/${r}/member-writes`).set(auth(owner.token)).send({ enabled: true })).status).toBe(200);

    // Both devices in the race room (what the RACE screen now does on open).
    const sOwner = await socketFor(owner);
    const sJudge = await socketFor(judge);
    try {
      expect((await sOwner.emitWithAck("join", { raceUuid: r })).ok).toBe(true);
      expect((await sJudge.emitWithAck("join", { raceUuid: r })).ok).toBe(true);
      const toJudge = collect(sJudge, "race:changes");
      const toOwner = collect(sOwner, "race:changes");
      const [w1a, w1b] = race.riders.filter((x) => x.heat === 1);

      // PC → mobile
      const [ci] = await send(owner, r, action(r, "RiderCheckedIn", { riderUuid: w1a.uuid, checked: true }));
      expect(ci.applied).toBe(true);
      await until(() => toJudge.some((m) => m.riders?.some((x: { uuid: string; checked: boolean }) => x.uuid === w1a.uuid && x.checked)));
      // mobile → PC
      const [ci2] = await send(judge, r, action(r, "RiderCheckedIn", { riderUuid: w1b.uuid, checked: true }));
      expect(ci2.applied).toBe(true);
      await until(() => toOwner.some((m) => m.riders?.some((x: { uuid: string; checked: boolean }) => x.uuid === w1b.uuid && x.checked)));

      // Before GO the judge manages riders: add a late entry, fix a bib and a name, DNS.
      const late = randomUUID();
      const pre = await send(
        judge, r,
        action(r, "RiderAdded", { rider: { uuid: late, firstName: "Late", lastName: "Entry", bibNumber: 777, category: race.cats[0].name, heat: 1 } }),
        action(r, "RiderEdited", { riderUuid: w1a.uuid, changes: { bibNumber: 555 } }),
        action(r, "RiderEdited", { riderUuid: w1a.uuid, changes: { firstName: "Fixed", lastName: "Name" } }),
        action(r, "StatusCorrection", { riderUuid: w1b.uuid, status: "DNS" }),
      );
      expect(pre.map((x) => [x.applied, x.reason])).toEqual([[true, null], [true, null], [true, null], [true, null]]);

      // Never configuration: category laps, race info, deleting riders.
      const config = await send(
        judge, r,
        action(r, "CategoryEdited", { categoryUuid: race.cats[0].uuid, changes: { laps: 9 } }),
        action(r, "RaceEdited", { changes: { name: "Hijacked" } }),
        action(r, "RiderDeleted", { riderUuid: late }),
      );
      expect(config.every((x) => !x.applied && x.reason === "forbidden")).toBe(true);
      expect((await api().post(`/api/v1/races/${r}/invitations`).set(auth(judge.token)).send({ link: true, roles: ["counter"], sendEmail: false })).status).toBe(403);
      expect((await api().put(`/api/v1/races/${r}/member-writes`).set(auth(judge.token)).send({ enabled: false })).status).toBe(403);

      // GO for wave 1: names/bibs locked, statuses still allowed.
      const [go] = await send(judge, r, action(r, "WaveStarted", { heat: 1 }));
      expect(go.applied).toBe(true);
      const post = await send(
        judge, r,
        action(r, "RiderEdited", { riderUuid: late, changes: { firstName: "TooLate" } }),
        action(r, "StatusCorrection", { riderUuid: late, status: "DNF" }),
      );
      expect(post.map((x) => [x.applied, x.reason])).toEqual([[false, "locked"], [true, null]]);

      // Shared, read-only history: every judge sees the same pre-GO changes with author and time.
      const h = await history(judge, r);
      expect(h.status).toBe(200);
      const events = h.body.events as Record<string, unknown>[];
      expect(events.map((e) => e.type)).toEqual(["RiderAdded", "RiderEdited", "RiderEdited", "StatusCorrection"]);
      expect(events[0]).toMatchObject({ riderUuid: late, bibNumber: 777, firstName: "Late", lastName: "Entry", userName: "CiJudge", heat: 1 });
      expect(events[1]).toMatchObject({ riderUuid: w1a.uuid, bibNumber: 555 });
      expect(events[2]).toMatchObject({ firstName: "Fixed", lastName: "Name" });
      expect(events[3]).toMatchObject({ riderUuid: w1b.uuid, status: "DNS" });
      for (const e of events) {
        expect(typeof e.eventAt).toBe("string");
        for (const k of ["deviceId", "userId", "actionId", "payload", "clockOffsetMs"]) expect(e).not.toHaveProperty(k);
      }
      // The organizer reads the same list; the DNF after GO is not a Check-In change.
      expect((await history(owner, r)).body.events).toEqual(events);
      // No Check-In screen (viewer) → no history; outsiders never.
      expect((await history(viewer, r)).status).toBe(403);

      // LIVE: the judge records and undoes a lap within 30 s; an older lap can't be undone (server time).
      const rider = race.riders.find((x) => x.heat === 1 && x.uuid !== w1b.uuid)!;
      const lap1 = action(r, "AddLap", { riderUuid: rider.uuid }, { at: new Date(Date.now() + 61_000).toISOString() });
      expect((await send(judge, r, lap1))[0].applied).toBe(true);
      expect((await send(judge, r, action(r, "Undo", { targetActionId: lap1.actionId })))[0].applied).toBe(true);
      const lap2 = action(r, "AddLap", { riderUuid: rider.uuid }, { at: new Date(Date.now() + 122_000).toISOString() });
      expect((await send(judge, r, lap2))[0].applied).toBe(true);
      await db.query(`UPDATE race_events SET "serverReceivedAt" = now() - interval '31 seconds' WHERE "actionId" = $1`, [lap2.actionId]);
      const tooLate = await send(judge, r, action(r, "Undo", { targetActionId: lap2.actionId }));
      expect([tooLate[0].applied, tooLate[0].reason]).toEqual([false, "locked"]);
    } finally {
      sOwner.close();
      sJudge.close();
    }
  });
});
