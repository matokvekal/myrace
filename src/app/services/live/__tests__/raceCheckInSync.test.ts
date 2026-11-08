/**
 * 0.3.3 — RACE / Check-In real-time sync and the shared Check-In change log (client side).
 * Server side: server/test/db/judge-checkin-sync.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const openLiveRace = vi.fn(async () => {});
let linked = true;
vi.mock("../liveClient", () => ({ openLiveRace }));
vi.mock("../liveBridge", () => ({ isLiveRace: () => linked }));
vi.mock("react-toastify", () => ({ toast: { warn: vi.fn(), info: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  openLiveRace.mockClear();
  vi.stubEnv("VITE_SERVER_URL", "/");
});
afterEach(() => vi.unstubAllEnvs());

describe("RACE joins the race's live room (the 0.3.2 bug: only LIVE did)", () => {
  it("a shared race on screen joins its room; a local race doesn't", async () => {
    linked = true;
    const { useLiveRaceRoom } = await import("../liveRaceRoom");
    renderHook(() => useLiveRaceRoom("race-1"));
    await vi.waitFor(() => expect(openLiveRace).toHaveBeenCalledWith("race-1"));

    openLiveRace.mockClear();
    linked = false;
    renderHook(() => useLiveRaceRoom("local-race"));
    await new Promise((r) => setTimeout(r, 20));
    expect(openLiveRace).not.toHaveBeenCalled();
  });

  it("joins as soon as the race becomes shared (upload / accepted invitation) without a remount", async () => {
    linked = false;
    const { useLiveRaceRoom } = await import("../liveRaceRoom");
    const { rerender } = renderHook(() => useLiveRaceRoom("race-2"));
    expect(openLiveRace).not.toHaveBeenCalled();
    linked = true;
    rerender();
    await vi.waitFor(() => expect(openLiveRace).toHaveBeenCalledWith("race-2"));
  });

  it("the race page uses it for every view (Race mode included)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/app/race/[id]/page.tsx"), "utf8");
    expect(src).toMatch(/useLiveRaceRoom\(raceUuid\);/);
  });
});

describe("shared Check-In change log", () => {
  it("maps the server's events to changes with author and time, previous values followed, newest first", async () => {
    const useRiderStore = (await import("@/stores/ridersStore")).default;
    useRiderStore.setState({
      riders: [
        { id: 1, uuid: "r1", raceUuid: "R", bibNumber: 555, firstName: "Fixed", lastName: "Name", heat: 1, category: "Elite" },
        { id: 2, uuid: "r2", raceUuid: "R", bibNumber: 777, firstName: "Late", lastName: "Entry", heat: 1, category: "Elite" },
      ] as never,
    });
    const { sharedCheckInChanges } = await import("@/stores/checkInChangesStore");
    const at = (m: number) => new Date(2026, 10, 8, 9, m).toISOString();
    const out = sharedCheckInChanges(
      [
        { seq: 1, type: "RiderAdded", heat: 1, eventAt: at(1), userName: "Judge A", riderUuid: "r2", bibNumber: 777, firstName: "Late", lastName: "Entry" },
        { seq: 2, type: "RiderEdited", heat: 1, eventAt: at(2), userName: "Judge B", riderUuid: "r1", bibNumber: 555 },
        { seq: 3, type: "RiderEdited", heat: 1, eventAt: at(3), userName: "Judge B", riderUuid: "r1", bibNumber: 556 },
        { seq: 4, type: "RiderEdited", heat: 1, eventAt: at(4), userName: "Organizer", riderUuid: "r1", bibNumber: null, firstName: "Fixed", lastName: "Name" },
        { seq: 5, type: "StatusCorrection", heat: 1, eventAt: at(5), userName: "Judge A", riderUuid: "r2", status: "DNS" },
        { seq: 6, type: "StatusCorrection", heat: 1, eventAt: at(6), userName: "Judge A", riderUuid: "r2", status: "running" },
        // Setup edit the day before the race: not a Check-In change.
        { seq: 7, type: "RiderEdited", heat: 1, eventAt: new Date(2026, 10, 7, 20, 0).toISOString(), userName: "Organizer", riderUuid: "r1", bibNumber: 1 },
      ],
      { uuid: "R", date: "2026-11-08" },
    );
    expect(out.map((c) => [c.kind, c.text, c.by, c.wave])).toEqual([
      ["status", "DNS → standing", "Judge A", 1],
      ["status", "standing → DNS", "Judge A", 1],
      ["name", "Name → Name Fixed", "Organizer", 1],
      ["bib", "Bib 555 → 556", "Judge B", 1],
      ["bib", "Bib → 555", "Judge B", 1],
      ["added", "Added to Elite", "Judge A", 1],
    ]);
    expect(out[0].timestamp).toBe(at(6));
  });
});

describe("LIVE Undo window on the device (server is the authority)", () => {
  it("shared race: a lap older than 30 s is not undone; local races are never limited", async () => {
    vi.doUnmock("../liveBridge");
    vi.doMock("@/services/live/liveBridge", () => ({ isLiveRace: (id: string) => id === "shared", liveAllows: () => true, liveDispatch: vi.fn(), newActionId: () => "x" }));
    const { lapUndoExpired } = await import("../../../race/[id]/heat/[heatId]/useLapRecording");
    const now = 1_000_000;
    expect(lapUndoExpired("shared", now - 30_000, now)).toBe(false);
    expect(lapUndoExpired("shared", now - 30_001, now)).toBe(true);
    expect(lapUndoExpired("local", now - 3_600_000, now)).toBe(false);
    expect(lapUndoExpired("shared", null, now)).toBe(false);
  });
});
