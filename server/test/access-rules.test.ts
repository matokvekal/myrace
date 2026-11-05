/** Race Access Rules, no database: share tokens, the guest projection, the guest polling window. */
import { describe, expect, it } from "vitest";
import { raceUuidFromShareToken, shareTokenFor } from "../src/public/shareToken";
import { projectPublicState } from "../../src/shared/race/access";
import { GUEST_POLL_WINDOW_MS, guestPollingEndsAt, guestPollingOpen, scheduledStartMs } from "../../src/shared/race/guestPolling";

const UUID = "472d3fa0-d2cd-47bf-8d79-7cba480fd0fc";
const OTHER = "11111111-2222-4333-8444-555555555555";

describe("share tokens", () => {
  it("are stable, reversible and signed", () => {
    const t = shareTokenFor(UUID);
    expect(shareTokenFor(UUID)).toBe(t);
    expect(raceUuidFromShareToken(t)).toBe(UUID);
    expect(shareTokenFor(OTHER)).not.toBe(t);
  });
  it("a forged, altered or malformed token opens nothing", () => {
    const [id, mac] = shareTokenFor(UUID).split(".");
    const flipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
    expect(raceUuidFromShareToken(`${id}.${flipped}`)).toBeNull();
    const otherId = shareTokenFor(OTHER).split(".")[0];
    expect(raceUuidFromShareToken(`${otherId}.${mac}`)).toBeNull(); // another race's id with this signature
    for (const bad of ["", UUID, "x.y", id, `${id}.${mac}.x`]) expect(raceUuidFromShareToken(bad)).toBeNull();
  });
});

describe("guest projection", () => {
  it("race info, categories and riders' public + result fields only; ignored waves hidden", () => {
    const state = {
      race: { uuid: UUID, name: "R", date: "2026-11-04", joinCode: "SECRET", ownerUserId: "u1", phone: "050", manager: "M", lastSeq: 3 },
      categories: {
        c1: { uuid: "c1", name: "Elite", subCategory: null, ignored: false },
        c2: { uuid: "c2", name: "Kids", subCategory: null, ignored: true },
      },
      riders: {
        r1: { uuid: "r1", category: "Elite", subCategory: null, firstName: "A", bibNumber: 1, comment: "private", checked: true, chipNumber: "x", lapsCounter: 2, position_category: 1 },
        r2: { uuid: "r2", category: "Kids", subCategory: null, firstName: "B", bibNumber: 2 },
      },
    } as unknown as Parameters<typeof projectPublicState>[0];
    const p = projectPublicState(state);
    expect(p.race).toMatchObject({ uuid: UUID, name: "R" });
    for (const f of ["joinCode", "ownerUserId", "phone", "manager"]) expect(p.race).not.toHaveProperty(f);
    expect(p.categories.map((c) => c.uuid)).toEqual(["c1"]);
    expect(p.riders).toHaveLength(1);
    expect(p.riders[0]).toMatchObject({ bibNumber: 1, lapsCounter: 2, position_category: 1 });
    for (const f of ["comment", "checked", "chipNumber"]) expect(p.riders[0]).not.toHaveProperty(f);
  });
});

describe("guest polling window", () => {
  const race = { date: "2026-11-04", time: "09:00", status: "running" };
  const start = Date.UTC(2026, 10, 4, 7, 0); // 09:00 in Israel (UTC+2 in November)
  it("starts at the race's scheduled start (Israel time); the earliest category start wins", () => {
    expect(scheduledStartMs(race)).toBe(start);
    expect(scheduledStartMs({ ...race, date: "04/11/2026" })).toBe(start);
    expect(scheduledStartMs(race, [{ startTime: "08:30" }, { startTime: "10:00" }])).toBe(start - 30 * 60_000);
  });
  it("closes 24 h after the start, or at once when the race is finished", () => {
    expect(guestPollingEndsAt(race)).toBe(start + GUEST_POLL_WINDOW_MS);
    expect(guestPollingOpen(race, [], start + GUEST_POLL_WINDOW_MS - 1)).toBe(true);
    expect(guestPollingOpen(race, [], start + GUEST_POLL_WINDOW_MS)).toBe(false);
    expect(guestPollingOpen({ ...race, status: "finished" }, [], start)).toBe(false);
    expect(guestPollingOpen({ status: "running" }, [], Date.now())).toBe(false); // no date or creation time: closed
  });
});
