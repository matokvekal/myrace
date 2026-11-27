import { describe, expect, it } from "vitest";
import { GUEST_POLL_WINDOW_MS, guestPollingEndsAt, guestPollingOpen, liveWindowEndsAt, liveWindowExpired, scheduledStartMs, unfinishedAfterWindow } from "../guestPolling";

// Race 8 on commissaire.us: 2026-11-13 08:00, wave 4 left "running" since 2026-11-14.
const race = { date: "2026-11-13", time: "08:00", status: "running" };
const cats = [
  { startTime: "08:20", heat: 1, status: "finished" },
  { startTime: "09:30", heat: 4, status: "running" },
  { startTime: "09:30", heat: 4, status: "running" },
  { startTime: "11:00", heat: 5, status: "upcoming" },
];
const start = scheduledStartMs(race, cats)!;

describe("LIVE window = 24 h from the race start (read-time rule)", () => {
  it("a wave still running does NOT keep the race live past the window", () => {
    expect(guestPollingOpen(race, cats, start + GUEST_POLL_WINDOW_MS - 1)).toBe(true);
    expect(guestPollingOpen(race, cats, start + GUEST_POLL_WINDOW_MS)).toBe(false);
    expect(guestPollingOpen(race, cats, start + 13 * GUEST_POLL_WINDOW_MS)).toBe(false); // Race 8 today
  });

  it("the end of the window does not move with the clock", () => {
    expect(guestPollingEndsAt(race, cats)).toBe(start + GUEST_POLL_WINDOW_MS);
    expect(liveWindowEndsAt(race, cats)).toBe(guestPollingEndsAt(race, cats));
  });

  it("a finished race is closed, and never reported as an expired live window", () => {
    expect(guestPollingEndsAt({ ...race, status: "finished" }, cats)).toBe(0);
    expect(liveWindowExpired({ ...race, status: "finished" }, cats, start + 99 * GUEST_POLL_WINDOW_MS)).toBe(false);
  });

  it("expired only after the window, and only for an unfinished race", () => {
    expect(liveWindowExpired(race, cats, start + 1000)).toBe(false);
    expect(liveWindowExpired(race, cats, start + GUEST_POLL_WINDOW_MS + 1)).toBe(true);
    expect(liveWindowExpired({ status: "running" }, cats, Date.now())).toBe(false); // no date / creation time: unknown
  });

  it("lists the waves still running after the window (organizer warning), nothing before it", () => {
    expect(unfinishedAfterWindow(race, cats, start + 1000)).toEqual([]);
    expect(unfinishedAfterWindow(race, cats, start + GUEST_POLL_WINDOW_MS + 1)).toEqual([4]);
    expect(unfinishedAfterWindow(race, cats.map((c) => ({ ...c, status: "finished" })), start + 5 * GUEST_POLL_WINDOW_MS)).toEqual([]);
  });

  it("multi-day (future): endDate extends the window to the end of that day, never shortens it", () => {
    const multi = { ...race, endDate: "2026-11-15" };
    const day3End = Date.UTC(2026, 10, 14, 22, 0) + GUEST_POLL_WINDOW_MS; // 00:00 Israel on the 15th + 24 h
    expect(liveWindowEndsAt(multi, cats)).toBe(day3End);
    expect(guestPollingOpen(multi, cats, start + 2 * GUEST_POLL_WINDOW_MS)).toBe(true);
    expect(guestPollingOpen(multi, cats, day3End)).toBe(false);
    expect(liveWindowEndsAt({ ...race, endDate: "2026-11-01" }, cats)).toBe(start + GUEST_POLL_WINDOW_MS);
    expect(liveWindowEndsAt({ ...race, endDate: "not a date" }, cats)).toBe(start + GUEST_POLL_WINDOW_MS);
  });
});
