/**
 * Public page 2.0 — components through the real SharePage with a mocked public API:
 * RACE active wave, LIVE (provisional, ranking, DNS/DNF bottom, position changes, stale,
 * wave transitions, 20 s refresh only on LIVE), Back/Forward, TV broadcast mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB";
const api = vi.hoisted(() => ({ fetchPublicRace: vi.fn(), fetchPublicChanges: vi.fn() }));
vi.mock("@/services/live/publicRace", async () => {
  class PublicApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
      super(message);
    }
  }
  return { ...api, PublicApiError };
});

import SharePage from "../SharePage";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
let T0 = 0; // wave 1 start, set per test (fake clock)
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const crossings = (mins: number[]) => mins.map((m, i) => ({ lap: i + 1, startTime: iso(i ? mins[i - 1] : 0), endTime: iso(m), lapTime: "" }));
const rider = (uuid: string, bib: number, category: string, mins: number[], over: Record<string, unknown> = {}) => ({
  uuid, bibNumber: bib, firstName: "Rider", lastName: `R${bib}`, category, subCategory: null, status: "standing",
  raceStatus: "running", lapsCounter: mins.length, lapsDetails: crossings(mins), timeArrive: mins.length ? iso(mins[mins.length - 1]) : null,
  elapsedTimeFromStart: null, position_category: 0, ...over,
});
const cats = (wave1 = "running", wave2 = "upcoming") => [
  { uuid: "c1", name: "Elite", subCategory: null, laps: 3, startTime: "09:00", heat: 1, status: wave1, startedAt: wave1 === "upcoming" ? null : T0, finishedAt: wave1 === "finished" ? T0 + 3_600_000 : null, color: "#e53935", importOrder: 1 },
  { uuid: "c2", name: "Kids", subCategory: null, laps: 1, startTime: "11:00", heat: 2, status: wave2, startedAt: wave2 === "upcoming" ? null : T0, finishedAt: null, color: "#1e88e5", importOrder: 2 },
];
const baseRiders = () => [
  rider("a", 11, "Elite", [10, 21]),
  rider("b", 12, "Elite", [10, 20]),
  rider("c", 13, "Elite", [11], { status: "DNF" }),
  rider("d", 14, "Elite", []),
  rider("k", 31, "Kids", [], { raceStatus: "upcoming" }),
];
const polling = (open = true) => ({ open, endsAt: open ? Date.now() + 3_600_000 : null, intervalMs: 10_000 });
const snapshot = (over: { cats?: unknown[]; riders?: unknown[]; race?: Record<string, unknown>; open?: boolean; approvals?: unknown[] } = {}) => ({
  lastSeq: 5, serverTime: Date.now(), polling: polling(over.open ?? true),
  race: { uuid: "R", name: "Guest Cup", date: today(), time: "00:00", location: "Ben Shemen", status: "running", ...over.race },
  categories: over.cats ?? cats(), riders: over.riders ?? baseRiders(), ...(over.approvals ? { approvals: over.approvals } : {}),
});

let where = "";
let nav: NavigateFunction;
function Where() {
  const l = useLocation();
  nav = useNavigate();
  where = l.pathname + l.search;
  return null;
}
const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/share/:token" element={<><SharePage /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
};
const tick = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await flush();
};
const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  document.dispatchEvent(new Event("visibilitychange"));
};
const rowLabels = () => screen.getAllByTestId("live-row").map((r) => r.getAttribute("aria-label") ?? "");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date());
  T0 = Date.now() - 2_527_000; // the wave started 42:07 ago
  api.fetchPublicRace.mockReset().mockImplementation(async () => snapshot());
  api.fetchPublicChanges.mockReset().mockImplementation(async () => ({ lastSeq: 5, serverTime: Date.now(), polling: polling(), unchanged: true }));
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RACE — active wave", () => {
  it("shows the running wave with actual start, categories, counts and the race clock", async () => {
    mount(`/share/${TOKEN}`);
    await flush();
    const strip = screen.getByTestId("share-active-wave");
    expect(strip.textContent).toMatch(/Wave 1/);
    expect(strip.textContent).toMatch(/RUNNING/);
    expect(strip.textContent).toMatch(/Elite/);
    expect(strip.textContent).toMatch(/3 on course/); // a, b, d (c is DNF)
    expect(strip.textContent).toMatch(/0 finished/);
    expect(screen.getByTestId("share-active-wave-clock").textContent).toBe("0:42:07");
    expect(screen.getAllByTestId("share-wave")).toHaveLength(2); // the existing schedule is still there
  });

  it("several running waves are all shown; none running → what is next, no LIVE marker", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ cats: cats("running", "running") }));
    mount(`/share/${TOKEN}`);
    await flush();
    expect(screen.getAllByTestId("share-active-wave")).toHaveLength(2);
    cleanup();
    api.fetchPublicRace.mockResolvedValue(snapshot({ cats: cats("upcoming", "upcoming") }));
    mount(`/share/${TOKEN}`);
    await flush();
    expect(screen.queryByTestId("share-active-wave")).toBeNull();
    expect(screen.getByTestId("share-no-active-wave").textContent).toMatch(/Next: Wave 1 · 09:00/);
  });
});

describe("LIVE", () => {
  it("provisional standings of the active wave only: ranked, waiting riders, DNF at the bottom", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    expect(screen.getByTestId("live-provisional").textContent).toMatch(/PROVISIONAL/);
    expect(rowLabels()).toEqual([
      expect.stringMatching(/^Position 1, bib 12, .*2\/3 laps, time 20:00, leader/),
      expect.stringMatching(/^Position 2, bib 11, .*gap \+1:00/),
      expect.stringMatching(/^No position yet, bib 14/),
      expect.stringMatching(/^DNF, bib 13/),
    ]);
    expect(screen.queryByText("R31")).toBeNull(); // Kids (wave 2, not running) never appears
    expect(screen.getByTestId("live-clock").textContent).toBe("0:42:07");
  });

  it("By category groups the wave's categories", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ cats: cats("running", "running") }));
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    const waves = screen.getAllByTestId("live-wave-option");
    expect(waves.map((w) => w.textContent)).toEqual(["Wave 1", "Wave 2"]);
    fireEvent.click(waves[1]);
    expect(screen.getAllByTestId("live-row")).toHaveLength(1);
    fireEvent.click(waves[0]);
    fireEvent.click(screen.getByTestId("live-mode-category"));
    expect(screen.getAllByTestId("live-board")).toHaveLength(1);
    expect(screen.getByTestId("live-board").textContent).toMatch(/Elite/);
  });

  it("no active wave → elegant empty state, never old standings", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ cats: cats("finished", "upcoming") }));
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    expect(screen.getByTestId("live-no-active-wave").textContent).toMatch(/No Active Wave.*Wave 2.*11:00/);
    expect(screen.queryAllByTestId("live-row")).toHaveLength(0);
  });

  it("refreshes every 20 s on LIVE only; RACE keeps 60 s; paused while hidden", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    await tick(20_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
    await tick(20_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(2);
    act(() => setVisibility("hidden"));
    await tick(120_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(2);
    act(() => setVisibility("visible"));
    await flush();
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByTestId("share-tab-race"));
    await flush();
    await tick(30_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(3); // 60 s rule again
    await tick(30_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(4);
  });

  it("position changes after new data: arrows on the riders who moved", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    // bib 11 laps a third time first → moves up past bib 12
    api.fetchPublicChanges.mockImplementationOnce(async () => ({
      lastSeq: 6, serverTime: Date.now(), polling: polling(), riders: [rider("a", 11, "Elite", [10, 21, 31])],
    }));
    await tick(20_000);
    expect(rowLabels()[0]).toMatch(/^Position 1, bib 11.*up 1 place$/);
    expect(rowLabels()[1]).toMatch(/^Position 2, bib 12.*down 1 place$/);
    // a later update with no movement clears the arrows
    api.fetchPublicChanges.mockImplementationOnce(async () => ({
      lastSeq: 7, serverTime: Date.now(), polling: polling(), riders: [rider("d", 14, "Elite", [12])],
    }));
    await tick(20_000);
    expect(rowLabels()[0]).not.toMatch(/place$/);
  });

  it("connection loss: the last standings stay, marked stale; a finished wave leaves LIVE", async () => {
    const { PublicApiError } = await import("@/services/live/publicRace");
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    api.fetchPublicChanges.mockRejectedValueOnce(new PublicApiError(0, "offline", "No connection"));
    await tick(20_000);
    expect(screen.getByTestId("live-stale").textContent).toMatch(/Connection lost/);
    expect(screen.getByTestId("live-tab").getAttribute("data-freshness")).toBe("stale");
    expect(screen.getAllByTestId("live-row").length).toBeGreaterThan(0);

    api.fetchPublicChanges.mockImplementationOnce(async () => ({ lastSeq: 9, serverTime: Date.now(), polling: polling(), categories: [cats("finished")[0]] }));
    await tick(20_000);
    expect(screen.queryByTestId("live-stale")).toBeNull();
    expect(screen.getByTestId("live-no-active-wave")).toBeTruthy();
  });
});

describe("navigation", () => {
  it("tab changes are history entries: Back / Forward move between tabs", async () => {
    mount(`/share/${TOKEN}`);
    await flush();
    fireEvent.click(screen.getByTestId("share-tab-results"));
    fireEvent.click(screen.getByTestId("share-tab-live"));
    act(() => nav(-1));
    expect(where).toBe(`/share/${TOKEN}?tab=results`);
    expect(screen.getByTestId("share-tab-results").getAttribute("aria-selected")).toBe("true");
    act(() => nav(-1));
    expect(screen.getByTestId("share-tab-race").getAttribute("aria-selected")).toBe("true");
    act(() => nav(1));
    expect(screen.getByTestId("share-tab-results").getAttribute("aria-selected")).toBe("true");
  });
});

describe("TV broadcast mode", () => {
  const field = () => [
    ...Array.from({ length: 28 }, (_, i) => rider(`r${i}`, 100 + i, "Elite", [10, 20 + i / 10])),
    rider("x", 90, "Elite", [], { status: "DNS" }),
    rider("y", 91, "Elite", []),
  ];

  it("enter from the page; header with title, LIVE, provisional tag and the race clock", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    fireEvent.click(screen.getByTestId("share-tv"));
    expect(where).toBe(`/share/${TOKEN}?tab=live&view=tv`);
    expect(screen.getByTestId("tv-title").textContent).toBe("Guest Cup");
    expect(screen.getByTestId("tv-status").textContent).toBe("LIVE");
    expect(screen.getByTestId("tv-tag").textContent).toMatch(/Provisional/);
    expect(screen.getByTestId("tv-clock").textContent).toBe("0:42:07");
    await tick(3_000);
    expect(screen.getByTestId("tv-clock").textContent).toBe("0:42:10");
  });

  it("large fields: leaders pinned, pages rotate automatically, title and clock stay", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ riders: field() }));
    mount(`/share/${TOKEN}?tab=live&view=tv`);
    await flush();
    // jsdom has no layout: 12 rows fit (fallback) → 11 per page, 3 pinned + 8 → 30 riders = 4 pages
    expect(screen.getByTestId("tv-pager").textContent).toMatch(/Page 1 \/ 4/);
    const firstPage = within(screen.getByTestId("tv-page-rows")).getAllByTestId("tv-row").map((r) => r.getAttribute("aria-label"));
    expect(screen.getAllByTestId("tv-row")[0].getAttribute("aria-label")).toMatch(/^Position 1, bib 100/);
    await tick(10_000);
    expect(screen.getByTestId("tv-pager").textContent).toMatch(/Page 2 \/ 4/);
    expect(screen.getAllByTestId("tv-row")[0].getAttribute("aria-label")).toMatch(/^Position 1, bib 100/); // pinned
    expect(within(screen.getByTestId("tv-page-rows")).getAllByTestId("tv-row").map((r) => r.getAttribute("aria-label"))).not.toEqual(firstPage);
    expect(screen.getByTestId("tv-title").textContent).toBe("Guest Cup");
    await tick(30_000);
    expect(screen.getByTestId("tv-pager").textContent).toMatch(/Page 1 \/ 4/); // wrapped
    // the last page ends with the waiting rider and the DNS
    await tick(30_000);
    const last = within(screen.getByTestId("tv-page-rows")).getAllByTestId("tv-row").map((r) => r.getAttribute("aria-label") ?? "");
    expect(last.slice(-2)).toEqual([expect.stringMatching(/bib 91/), expect.stringMatching(/^DNS, bib 90/)]);
  });

  it("stale data is flagged, never shown as current", async () => {
    const { PublicApiError } = await import("@/services/live/publicRace");
    mount(`/share/${TOKEN}?tab=live&view=tv`);
    await flush();
    api.fetchPublicChanges.mockRejectedValueOnce(new PublicApiError(0, "offline", "No connection"));
    await tick(20_000);
    expect(screen.getByTestId("tv-stale").textContent).toMatch(/Data delayed/);
    expect(screen.getByTestId("tv-status").textContent).toBe("DATA DELAYED");
    expect(screen.getByTestId("tv-freshness").getAttribute("data-freshness")).toBe("stale");
  });

  it("RESULTS on TV: nothing official before Finish Race; after it the approved podium + finishers", async () => {
    mount(`/share/${TOKEN}?tab=results&view=tv`);
    await flush();
    expect(screen.getByTestId("tv-results-pending").textContent).toMatch(/Race in progress/);
    expect(screen.queryAllByTestId("tv-result-row")).toHaveLength(0);
    cleanup();

    const finished = baseRiders().map((r) =>
      r.uuid === "b" ? { ...r, status: "finished", raceStatus: "finished", position_category: 1, elapsedTimeFromStart: "20:00" }
        : r.uuid === "a" ? { ...r, status: "finished", raceStatus: "finished", position_category: 2, elapsedTimeFromStart: "21:00" }
          : r);
    api.fetchPublicRace.mockResolvedValue(snapshot({
      cats: cats("finished", "finished"), riders: finished, open: false, race: { status: "finished" },
      approvals: [{ categoryUuid: "c1", status: "approved", approvedAt: new Date().toISOString() }],
    }));
    mount(`/share/${TOKEN}?tab=results&view=tv`);
    await flush();
    expect(screen.getByTestId("tv-tag").textContent).toMatch(/Official results/);
    expect(screen.getByTestId("tv-podium").textContent).toMatch(/R12.*R11|R11.*R12/);
    // Only finishers: the DNF and the not-crossed rider are not listed
    expect(screen.getAllByTestId("tv-result-row").map((r) => r.textContent)).toEqual([expect.stringMatching(/^112/), expect.stringMatching(/^211/)]);
  });

  it("RACE on TV and exit back to the page", async () => {
    mount(`/share/${TOKEN}?view=tv`);
    await flush();
    expect(screen.getByTestId("tv-active-wave").textContent).toMatch(/Wave 1/);
    expect(screen.getAllByTestId("tv-schedule-row")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("tv-exit"));
    expect(where).toBe(`/share/${TOKEN}`);
    expect(screen.getByTestId("share-page")).toBeTruthy();
  });
});
