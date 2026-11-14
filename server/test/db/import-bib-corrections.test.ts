/**
 * Phase 2 (Smart Rider Import) — duplicate bibs renumbered at import:
 *  - a shared race's RidersImported carries `bibCorrections`; the engine checks them and the
 *    server's Check-In history lists each one (original → corrected, reason, author, time);
 *  - a race created from a start list (publish) records its renumbering as a RaceAdmin entry;
 *  - server-side validation: a duplicate / taken bib (other wave too) is refused as a whole,
 *    a correction that doesn't match its rider is refused, and two concurrent imports of the
 *    same bib can't both land.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { action, api, auth, newUser, publishRace, send, snapshot, startServer, stopServer, type TestUser } from "./helpers";

let owner: TestUser;
beforeAll(async () => {
  await startServer();
  owner = await newUser("BibOwner");
});
afterAll(stopServer);

const history = (raceUuid: string) => api().get(`/api/v1/races/${raceUuid}/history?scope=checkin`).set(auth(owner.token));
const rider = (bibNumber: number, category: string, heat: number, lastName = `B${bibNumber}`) => ({ uuid: randomUUID(), firstName: "Imp", lastName, bibNumber, category, heat });

describe("bib corrections at import", () => {
  it("RidersImported with corrections: applied, and listed in the Check-In history with original, reason and author", async () => {
    const race = await publishRace(owner, 2, 2, 2); // bibs 101, 102 (wave 1), 201, 202 (wave 2)
    const r = race.raceUuid;
    const a = rider(55, race.cats[0].name, 1, "Keeps");
    const b = rider(1055, race.cats[1].name, 2, "Moved"); // was 55 in the file
    const c = rider(1101, race.cats[1].name, 2, "WasTaken"); // was 101 (taken in wave 1)
    const [res] = await send(owner, r, action(r, "RidersImported", {
      riders: [a, b, c], categories: [],
      bibCorrections: [
        { riderUuid: b.uuid, originalBib: 55, correctedBib: 1055, reason: "Duplicate bib at import: 55 was also on another row of the file" },
        { riderUuid: c.uuid, originalBib: 101, correctedBib: 1101, reason: "Duplicate bib at import: 101 already belonged to Test W1R1" },
      ],
    }));
    expect([res.applied, res.reason]).toEqual([true, null]);

    const h = await history(r);
    expect(h.status).toBe(200);
    const fixes = h.body.events.filter((e: { originalBib?: number }) => e.originalBib != null);
    expect(fixes.map((e: Record<string, unknown>) => [e.type, e.riderUuid, e.originalBib, e.bibNumber, e.userName])).toEqual([
      ["RidersImported", b.uuid, 55, 1055, "BibOwner"],
      ["RidersImported", c.uuid, 101, 1101, "BibOwner"],
    ]);
    expect(fixes[1].reason).toContain("Test W1R1");
  });

  it("refuses the whole import on a duplicate in the file or a bib taken in another wave", async () => {
    const race = await publishRace(owner, 2, 1, 2); // bibs 101 (wave 1), 201 (wave 2)
    const r = race.raceUuid;
    const dupInFile = await send(owner, r, action(r, "RidersImported", { riders: [rider(7, race.cats[0].name, 1), rider(7, race.cats[1].name, 2)], categories: [] }));
    expect([dupInFile[0].applied, dupInFile[0].reason]).toEqual([false, "invalid"]);
    const takenOtherWave = await send(owner, r, action(r, "RidersImported", { riders: [rider(8, race.cats[0].name, 1), rider(201, race.cats[0].name, 1)], categories: [] }));
    expect([takenOtherWave[0].applied, takenOtherWave[0].reason]).toEqual([false, "invalid"]);
    // Rollback: nothing of either import landed.
    const snap = await snapshot(owner, r);
    expect(snap.riders.map((x: { bibNumber: number }) => x.bibNumber).sort()).toEqual([101, 201]);
  });

  it("refuses a correction that doesn't match its rider (nothing lands)", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    const r = race.raceUuid;
    const x = rider(1009, race.cats[0].name, 1);
    const [res] = await send(owner, r, action(r, "RidersImported", {
      riders: [x], categories: [],
      bibCorrections: [{ riderUuid: x.uuid, originalBib: 9, correctedBib: 2009, reason: "Duplicate bib at import" }],
    }));
    expect([res.applied, res.reason]).toEqual([false, "invalid"]);
    expect((await snapshot(owner, r)).riders).toHaveLength(1);
  });

  it("two concurrent imports with the same bib: only one lands", async () => {
    const race = await publishRace(owner, 1, 1, 2);
    const r = race.raceUuid;
    const [p, q] = await Promise.all([
      send(owner, r, action(r, "RidersImported", { riders: [rider(500, race.cats[0].name, 1, "First")], categories: [] })),
      send(owner, r, action(r, "RidersImported", { riders: [rider(500, race.cats[0].name, 1, "Second")], categories: [] })),
    ]);
    expect([p[0].applied, q[0].applied].filter(Boolean)).toHaveLength(1);
    const bibs = (await snapshot(owner, r)).riders.map((x: { bibNumber: number }) => x.bibNumber);
    expect(bibs.filter((b: number) => b === 500)).toHaveLength(1);
  });

  it("a race published from a renumbered start list records the corrections (RaceAdmin) in the Check-In history", async () => {
    const cat = { uuid: randomUUID(), name: "Open", heat: 1, laps: 2, startTime: "10:00" };
    const keep = rider(21, "Open", 1, "Keep");
    const moved = rider(1021, "Open", 1, "Moved");
    const pub = await api().post("/api/v1/races/publish").set(auth(owner.token)).send({
      race: { name: "From file", date: "2026-11-20" }, categories: [cat], riders: [keep, moved],
      bibCorrections: [{ riderUuid: moved.uuid, originalBib: 21, correctedBib: 1021, reason: "Duplicate bib at import: 21 was also on another row of the file" }],
    });
    expect(pub.status).toBe(201);
    const h = await history(pub.body.race.uuid);
    expect(h.body.events.map((e: Record<string, unknown>) => [e.riderUuid, e.originalBib, e.bibNumber])).toEqual([[moved.uuid, 21, 1021]]);

    // A correction that doesn't describe its rider: the publish is refused, no race.
    const bad = await api().post("/api/v1/races/publish").set(auth(owner.token)).send({
      race: { name: "Bad", date: "2026-11-20" }, categories: [{ ...cat, uuid: randomUUID() }], riders: [{ ...keep, uuid: randomUUID() }],
      bibCorrections: [{ riderUuid: randomUUID(), originalBib: 21, correctedBib: 1021, reason: "Duplicate bib at import" }],
    });
    expect(bad.status).toBe(400);
  });
});
