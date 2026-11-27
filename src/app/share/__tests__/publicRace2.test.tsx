/**
 * Public page 2.0 — components through the real SharePage with a mocked public API:
 * RACE active wave, LIVE (provisional, ranking, DNS/DNF bottom, position changes, stale,
 * wave transitions, 10 s refresh only on LIVE), Back/Forward, TV broadcast mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB";
const api = vi.hoisted(() => ({ fetchPublicRace: vi.fn(), fetchPublicChanges: vi.fn(), fetchPublicSeq: vi.fn() }));
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
const snapshot = (over: { cats?: unknown[]; riders?: unknown[]; race?: Record<string, unknown>; open?: boolean; approvals?: unknown[]; resultsApproval?: unknown } = {}) => ({
  lastSeq: 5, serverTime: Date.now(), polling: polling(over.open ?? true),
  race: { uuid: "R", name: "Guest Cup", date: today(), time: "00:00", location: "Ben Shemen", status: "running", ...over.race },
  categories: over.cats ?? cats(), riders: over.riders ?? baseRiders(), ...(over.approvals ? { approvals: over.approvals } : {}),
  ...(over.resultsApproval !== undefined ? { resultsApproval: over.resultsApproval } : {}),
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
  api.fetchPublicSeq.mockReset().mockImplementation(async () => ({ lastSeq: 5 }));
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

  it("no wave started yet → elegant empty state", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ cats: cats("upcoming", "upcoming") }));
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    expect(screen.getByTestId("live-no-active-wave").textContent).toMatch(/No Active Wave.*Wave 1/);
    expect(screen.queryAllByTestId("live-row")).toHaveLength(0);
  });

  it("refreshes every 10 s on LIVE only; RACE keeps 30 s; paused while hidden", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    await tick(10_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
    await tick(10_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(2);
    act(() => setVisibility("hidden"));
    await tick(120_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(2);
    act(() => setVisibility("visible"));
    await flush();
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByTestId("share-tab-race"));
    await flush();
    await tick(15_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(3); // 30 s rule again
    await tick(15_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(4);
  });

  it("position changes after new data: arrows on the riders who moved", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    // bib 11 laps a third time first → moves up past bib 12
    api.fetchPublicChanges.mockImplementationOnce(async () => ({
      lastSeq: 6, serverTime: Date.now(), polling: polling(), riders: [rider("a", 11, "Elite", [10, 21, 31])],
    }));
    await tick(10_000);
    expect(rowLabels()[0]).toMatch(/^Position 1, bib 11.*up 1 place$/);
    expect(rowLabels()[1]).toMatch(/^Position 2, bib 12.*down 1 place$/);
    // a later update with no movement clears the arrows
    api.fetchPublicChanges.mockImplementationOnce(async () => ({
      lastSeq: 7, serverTime: Date.now(), polling: polling(), riders: [rider("d", 14, "Elite", [12])],
    }));
    await tick(10_000);
    expect(rowLabels()[0]).not.toMatch(/place$/);
  });

  it("connection loss: the last standings stay, marked stale; a finished wave leaves LIVE", async () => {
    const { PublicApiError } = await import("@/services/live/publicRace");
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    api.fetchPublicChanges.mockRejectedValueOnce(new PublicApiError(0, "offline", "No connection"));
    await tick(10_000);
    expect(screen.getByTestId("live-stale").textContent).toMatch(/Connection lost/);
    expect(screen.getByTestId("live-tab").getAttribute("data-freshness")).toBe("stale");
    expect(screen.getAllByTestId("live-row").length).toBeGreaterThan(0);

    api.fetchPublicChanges.mockImplementationOnce(async () => ({ lastSeq: 9, serverTime: Date.now(), polling: polling(), categories: [cats("finished")[0]] }));
    await tick(10_000);
    expect(screen.queryByTestId("live-stale")).toBeNull();
    expect(screen.getByTestId("live-wave-finished").textContent).toMatch(/Wave 1 has finished/);
  });
});

describe("LIVE lifecycle until official RESULTS (hotfix 1.2.1-rc.3)", () => {
  /** Both waves with an actual start; each finished one has its own finish time. */
  const lifecycleCats = (w1: string, w2: string) => [
    { ...cats(w1, w2)[0], finishedAt: w1 === "finished" ? T0 + 3_000_000 : null },
    { ...cats(w1, w2)[1], startedAt: w2 === "upcoming" ? null : T0 + 2_000_000, finishedAt: w2 === "finished" ? T0 + 2_400_000 : null },
  ];
  const kidsDone = () => [...baseRiders().filter((r) => r.uuid !== "k"), rider("k", 31, "Kids", [36], { raceStatus: "finished" })];
  const remount = async (path: string) => {
    cleanup();
    mount(path);
    await flush();
  };

  it("active wave → LIVE; finish it and start the next → LIVE switches to the new wave by itself (also after a reload)", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    expect(screen.getByTestId("live-wave-head").textContent).toMatch(/RUNNING.*Wave 1/);
    expect(rowLabels().some((l) => /bib 11/.test(l))).toBe(true);

    const next = { cats: lifecycleCats("finished", "running"), riders: [...baseRiders().filter((r) => r.uuid !== "k"), rider("k", 31, "Kids", [], { raceStatus: "running" })] };
    api.fetchPublicChanges.mockImplementationOnce(async () => ({ lastSeq: 8, serverTime: Date.now(), polling: polling(), categories: next.cats, riders: next.riders }));
    await tick(10_000);
    expect(screen.getByTestId("live-wave-head").textContent).toMatch(/RUNNING.*Wave 2/);
    expect(rowLabels().every((l) => /bib 31/.test(l))).toBe(true); // only the new wave, wave 1's laps untouched in the feed
    expect(screen.getByTestId("live-clock").getAttribute("data-running")).toBe("true");

    api.fetchPublicRace.mockResolvedValue(snapshot(next));
    await remount(`/share/${TOKEN}?tab=live`);
    expect(screen.getByTestId("live-wave-head").textContent).toMatch(/RUNNING.*Wave 2/);
  });

  it("every wave finished, RESULTS not published → LIVE keeps the last wave's final standings, provisional; reload the same", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ cats: lifecycleCats("finished", "finished"), riders: kidsDone() }));
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    expect(screen.queryByTestId("live-no-active-wave")).toBeNull();
    const head = screen.getByTestId("live-wave-head");
    expect(head.getAttribute("data-state")).toBe("finished");
    expect(head.textContent).toMatch(/FINISHED.*Wave 1/); // the wave that finished last
    expect(screen.getByTestId("live-clock").getAttribute("data-running")).toBe("false");
    expect(screen.getByTestId("live-provisional").textContent).toMatch(/PROVISIONAL.*not.*|official results are published after/);
    expect(rowLabels().length).toBe(4); // laps, statuses (DNF) and waiting riders as last known
    expect(rowLabels().some((l) => /bib 13/.test(l))).toBe(true);

    fireEvent.click(screen.getByTestId("share-tab-results"));
    await flush();
    expect(screen.getByTestId("share-follow-live")).toBeTruthy(); // RESULTS still unpublished

    await remount(`/share/${TOKEN}?tab=live`);
    expect(screen.getByTestId("live-wave-head").getAttribute("data-state")).toBe("finished");
  });

  it("RESULTS published (Finish Race) → RESULTS as before; LIVE back to its finished state, never shown as results", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ cats: lifecycleCats("finished", "finished"), riders: kidsDone(), race: { status: "finished" }, open: false }));
    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    expect(screen.queryByTestId("share-follow-live")).toBeNull();
    expect(screen.getAllByTestId("share-results-category").length).toBeGreaterThan(0);

    await remount(`/share/${TOKEN}?tab=live`);
    expect(screen.getByTestId("live-no-active-wave").textContent).toMatch(/race is finished/);
    expect(screen.getByTestId("live-open-results")).toBeTruthy();
    expect(screen.queryAllByTestId("live-row")).toHaveLength(0);
  });

  it("between waves: 'Wave N has finished' message, never the old standings; the next wave's start brings LIVE back", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ cats: lifecycleCats("finished", "upcoming") }));
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    const msg = screen.getByTestId("live-wave-finished");
    expect(msg.querySelector("h2")?.textContent).toBe("Wave 1 has finished");
    expect(msg.textContent).toMatch(/Waiting for the next wave to start\./);
    expect(msg.textContent).toMatch(/Official results will be available after the race is completed\./);
    expect(screen.queryAllByTestId("live-row")).toHaveLength(0);
    expect(screen.queryByTestId("live-wave-head")).toBeNull();

    const next = { cats: lifecycleCats("finished", "running"), riders: [...baseRiders().filter((r) => r.uuid !== "k"), rider("k", 31, "Kids", [], { raceStatus: "running" })] };
    api.fetchPublicChanges.mockImplementationOnce(async () => ({ lastSeq: 8, serverTime: Date.now(), polling: polling(), categories: next.cats, riders: next.riders }));
    await tick(5 * 60_000); // between waves the page refreshes every 5 min
    expect(screen.queryByTestId("live-wave-finished")).toBeNull();
    expect(screen.getByTestId("live-wave-head").textContent).toMatch(/RUNNING.*Wave 2/);
  });

  it("TV between waves: the same finished-wave message", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ cats: lifecycleCats("finished", "upcoming") }));
    mount(`/share/${TOKEN}?tab=live&view=tv`);
    await flush();
    expect(screen.getByTestId("tv-wave-finished").textContent).toMatch(/Wave 1 has finished.*Waiting for the next wave to start/);
  });
});

describe("RESULTS status after Finish Race (1.2.1 race-wide approval)", () => {
  const finishedRace = { cats: cats("finished", "finished"), open: false, race: { status: "finished" } };

  it("PROVISIONAL until approved; OFFICIAL once approved; a withdrawn approval is PROVISIONAL again", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ ...finishedRace, resultsApproval: null }));
    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    const pending = screen.getByTestId("share-results-status");
    expect(pending.getAttribute("data-status")).toBe("provisional");
    expect(pending.textContent).toMatch(/Provisional.*Awaiting approval/);
    expect(screen.getAllByTestId("share-results-category").length).toBeGreaterThan(0); // visible, as provisional
    cleanup();

    api.fetchPublicRace.mockResolvedValue(snapshot({ ...finishedRace, resultsApproval: { status: "approved", approvedAt: new Date().toISOString() } }));
    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    const official = screen.getByTestId("share-results-status");
    expect(official.getAttribute("data-status")).toBe("official");
    expect(official.textContent).toMatch(/Official.*Approved/);
    cleanup();

    // The server sends only a VALID approval; anything else counts as provisional.
    api.fetchPublicRace.mockResolvedValue(snapshot({ ...finishedRace, resultsApproval: { status: "invalidated", approvedAt: new Date().toISOString() } }));
    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    expect(screen.getByTestId("share-results-status").getAttribute("data-status")).toBe("provisional");
  });

  it("an OPEN finished page follows approval and withdrawal by checking only lastSeq (hotfix 1.2.1-rc.5)", async () => {
    const at = new Date().toISOString();
    api.fetchPublicRace.mockResolvedValue(snapshot({ ...finishedRace, resultsApproval: null }));
    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    expect(screen.getByTestId("share-results-status").getAttribute("data-status")).toBe("provisional");
    const loads = api.fetchPublicRace.mock.calls.length;

    // Nothing changed: one tiny seq check a minute, no race reload, no /changes (polling closed).
    await tick(60_000);
    expect(api.fetchPublicSeq).toHaveBeenCalledTimes(1);
    expect(api.fetchPublicRace).toHaveBeenCalledTimes(loads);
    expect(api.fetchPublicChanges).not.toHaveBeenCalled();

    // Approved on the server → seq moved → the race is reloaded once → OFFICIAL.
    api.fetchPublicSeq.mockImplementation(async () => ({ lastSeq: 6 }));
    api.fetchPublicRace.mockResolvedValue({ ...snapshot({ ...finishedRace, resultsApproval: { status: "approved", approvedAt: at } }), lastSeq: 6 });
    await tick(60_000);
    expect(api.fetchPublicRace).toHaveBeenCalledTimes(loads + 1);
    expect(screen.getByTestId("share-results-status").getAttribute("data-status")).toBe("official");

    // Withdrawn (an amendment) → PROVISIONAL again.
    api.fetchPublicSeq.mockImplementation(async () => ({ lastSeq: 8 }));
    api.fetchPublicRace.mockResolvedValue({ ...snapshot({ ...finishedRace, resultsApproval: null }), lastSeq: 8 });
    await tick(60_000);
    expect(screen.getByTestId("share-results-status").getAttribute("data-status")).toBe("provisional");
  });

  it("TV results follow the approval too; a hidden page does not check", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ ...finishedRace, resultsApproval: null }));
    mount(`/share/${TOKEN}?tab=results&view=tv`);
    await flush();
    expect(screen.getByTestId("tv-tag").textContent).toMatch(/Provisional/);

    setVisibility("hidden");
    await tick(3 * 60_000);
    expect(api.fetchPublicSeq).not.toHaveBeenCalled();

    api.fetchPublicSeq.mockImplementation(async () => ({ lastSeq: 6 }));
    api.fetchPublicRace.mockResolvedValue({ ...snapshot({ ...finishedRace, resultsApproval: { status: "approved", approvedAt: new Date().toISOString() } }), lastSeq: 6 });
    setVisibility("visible"); // back on screen: checked at once
    await flush();
    expect(screen.getByTestId("tv-tag").textContent).toMatch(/Official results/);
  });

  it("LIVE / RACE tabs of a finished race never check", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ ...finishedRace, resultsApproval: null }));
    mount(`/share/${TOKEN}?tab=race`);
    await flush();
    await tick(3 * 60_000);
    expect(api.fetchPublicSeq).not.toHaveBeenCalled();
  });

  it("before Finish Race an APPROVED category already shows on RESULTS", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ approvals: [{ categoryUuid: "c1", status: "approved", approvedAt: new Date().toISOString() }] }));
    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    expect(screen.queryByTestId("share-results-pending")).toBeNull();
    expect(screen.getAllByTestId("share-results-category").length).toBe(1);
    expect(screen.getByTestId("share-approved")).toBeTruthy();
  });

  it("before Finish Race RESULTS stay unavailable (no status shown)", async () => {
    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    expect(screen.getByTestId("share-results-pending")).toBeTruthy();
    expect(screen.queryByTestId("share-results-status")).toBeNull();
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
    await tick(10_000);
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
    const finishedRace = {
      cats: cats("finished", "finished"), riders: finished, open: false, race: { status: "finished" },
      approvals: [{ categoryUuid: "c1", status: "approved", approvedAt: new Date().toISOString() }],
    };
    // 1.2.1: finished but not approved yet -> PROVISIONAL.
    api.fetchPublicRace.mockResolvedValue(snapshot(finishedRace));
    mount(`/share/${TOKEN}?tab=results&view=tv`);
    await flush();
    expect(screen.getByTestId("tv-tag").textContent).toMatch(/Provisional/);
    cleanup();

    api.fetchPublicRace.mockResolvedValue(snapshot({ ...finishedRace, resultsApproval: { status: "approved", approvedAt: new Date().toISOString() } }));
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

describe("tracking star (hotfix 2026-11-23)", () => {
  const order = () => screen.getAllByTestId("live-row").map((r) => r.getAttribute("data-uuid"));

  it("LIVE: ☆ → ★ with a subtle highlight; ranking unchanged; kept per link across a reload", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    const before = order();
    const rowOf = (uuid: string) => screen.getAllByTestId("live-row").find((r) => r.getAttribute("data-uuid") === uuid)!;
    for (const u of ["a", "b", "d"]) fireEvent.click(within(rowOf(u)).getByTestId("share-star"));
    expect(order()).toEqual(before);
    expect(screen.getAllByTestId("live-row").filter((r) => r.getAttribute("data-fav") === "true").map((r) => r.getAttribute("data-uuid")).sort()).toEqual(["a", "b", "d"]);
    expect(within(rowOf("a")).getByTestId("share-star").getAttribute("aria-pressed")).toBe("true");
    expect(within(rowOf("c")).getByTestId("share-star").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("my-riders")).toBeNull(); // no strip / panel

    // The stars follow the riders when the ranking changes.
    api.fetchPublicChanges.mockImplementationOnce(async () => ({
      lastSeq: 6, serverTime: Date.now(), polling: polling(), riders: [rider("d", 14, "Elite", [9, 19, 28])],
    }));
    await tick(10_000);
    expect(order()[0]).toBe("d");
    expect(rowOf("d").getAttribute("data-fav")).toBe("true");
    expect(rowOf("c").getAttribute("data-fav")).toBeNull();

    // Reload: same link keeps them; another link has its own (none).
    cleanup();
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    expect(screen.getAllByTestId("live-row").filter((r) => r.getAttribute("data-fav") === "true")).toHaveLength(3);
    cleanup();
    mount(`/share/OTHERTOKENOTHERTOKEN00.CCCCCCCCCCCCCCCCCCCCCC?tab=live`);
    await flush();
    expect(screen.getAllByTestId("live-row").filter((r) => r.getAttribute("data-fav") === "true")).toHaveLength(0);
  });

  it("RESULTS and TV have no stars", async () => {
    localStorage.setItem(`commissaire.myRiders.v1.${TOKEN}`, JSON.stringify(["a"]));
    mount(`/share/${TOKEN}?tab=live&view=tv`);
    await flush();
    expect(screen.queryByTestId("share-star")).toBeNull();
    cleanup();
    api.fetchPublicRace.mockResolvedValue(snapshot({ race: { status: "finished" }, cats: cats("finished", "finished"), open: false }));
    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    expect(screen.queryByTestId("share-star")).toBeNull();
  });
});

describe("rate limit (hotfix 2026-11-23)", () => {
  it("after a 429 the next poll waits a full minute, then 10 s again", async () => {
    const { PublicApiError } = await import("@/services/live/publicRace");
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    api.fetchPublicChanges.mockRejectedValueOnce(new PublicApiError(429, "rate_limited", "Too many requests"));
    await tick(10_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
    await tick(50_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
    await tick(10_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(2);
    await tick(10_000);
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(3);
  });
});
