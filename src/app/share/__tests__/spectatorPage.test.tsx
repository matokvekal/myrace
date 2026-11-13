/**
 * 0.3.4 — public spectator page; 2.0: three tabs (RACE default, RESULTS only once the race is
 * officially finished, LIVE), ?tab links with history entries,
 * read-only, rider details, refresh rule (≈60 s while running, paused when hidden,
 * revalidate on return, no overlapping requests, throttled manual refresh), and
 * Other Bike Races (browser-local).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB";
const OTHER = "CCCCCCCCCCCCCCCCCCCCCC.DDDDDDDDDDDDDDDDDDDDDD";

const api = vi.hoisted(() => ({
  fetchPublicRace: vi.fn(),
  fetchPublicChanges: vi.fn(),
}));
vi.mock("@/services/live/publicRace", async () => {
  class PublicApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
      super(message);
    }
  }
  return { ...api, PublicApiError };
});

import SharePage from "../SharePage";
import { publicRefreshDelay, shareTabFromParam, PUBLIC_REFRESH_IDLE_MS, PUBLIC_REFRESH_RUNNING_MS } from "../publicRefresh";
import { forgetOtherRace, listOtherRaces, rememberOtherRace } from "../otherRaces";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const race = (over: Record<string, unknown> = {}) => ({ uuid: "R", name: "Guest Cup", date: today(), time: "00:00", location: "Ben Shemen", status: "running", ...over });
const cats = (elite = "running") => [
  { uuid: "c1", name: "Elite", subCategory: null, laps: 3, startTime: "00:00", heat: 1, status: elite, startedAt: elite === "upcoming" ? null : 1, color: "#e53935", importOrder: 1 },
  { uuid: "c2", name: "Kids", subCategory: null, laps: 1, startTime: "11:00", heat: 2, status: "upcoming", startedAt: null, color: "#1e88e5", importOrder: 2 },
];
const t0 = Date.parse("2026-11-08T09:00:00Z");
const lap = (n: number, min: number) => ({ lap: n, startTime: new Date(t0 + (min - 10) * 60_000).toISOString(), endTime: new Date(t0 + min * 60_000).toISOString() });
const riders = [
  { uuid: "r1", bibNumber: 11, firstName: "Test", lastName: "Alpha", category: "Elite", subCategory: null, team: "Team A", status: "finished", raceStatus: "finished", lapsCounter: 2, position_category: 1, elapsedTimeFromStart: "20:00", timeStartRace: "09:00:00", lapsDetails: [lap(1, 10), lap(2, 20)] },
  { uuid: "r2", bibNumber: 12, firstName: "Test", lastName: "Beta", category: "Elite", subCategory: null, status: "standing", raceStatus: "running", lapsCounter: 1, position_category: 2, elapsedTimeFromStart: "11:00", lapsDetails: [lap(1, 11)] },
  { uuid: "r4", bibNumber: 14, firstName: "Test", lastName: "Delta", category: "Elite", subCategory: null, status: "DNF", raceStatus: "finished", lapsCounter: 1 },
  { uuid: "r3", bibNumber: 31, firstName: "Test", lastName: "Gamma", category: "Kids", subCategory: null, status: "standing", raceStatus: "upcoming", lapsCounter: 0 },
];
const polling = (open = true) => ({ open, endsAt: open ? Date.now() + 3_600_000 : null, intervalMs: 10_000 });
const snapshot = (over: { elite?: string; open?: boolean; race?: Record<string, unknown>; approvals?: unknown[] } = {}) => ({
  lastSeq: 5, serverTime: Date.now(), polling: polling(over.open ?? true), race: race(over.race), categories: cats(over.elite), riders,
  ...(over.approvals ? { approvals: over.approvals } : {}),
});

let where = "";
function Where() {
  const l = useLocation();
  where = l.pathname + l.search;
  return null;
}
const mount = (path = `/share/${TOKEN}`) =>
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
const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date());
  api.fetchPublicRace.mockReset().mockResolvedValue(snapshot());
  api.fetchPublicChanges.mockReset().mockResolvedValue({ lastSeq: 5, serverTime: Date.now(), polling: polling(), unchanged: true });
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("public navigation", () => {
  it("2.0: three tabs, RACE by default; ?tab=results / ?tab=live open them and the choice stays in the URL", async () => {
    mount();
    await flush();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Race", "Results", "Live"]);
    expect(screen.getByTestId("share-tab-race").getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("share-wave").map((w) => w.getAttribute("data-wave-state"))).toEqual(["running", "upcoming"]);
    expect(screen.getAllByText("RUNNING").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NOT STARTED").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("share-tab-results"));
    expect(where).toBe(`/share/${TOKEN}?tab=results`);
    fireEvent.click(screen.getByTestId("share-tab-live"));
    expect(where).toBe(`/share/${TOKEN}?tab=live`);
    cleanup();

    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    expect(screen.getByTestId("share-tab-results").getAttribute("aria-selected")).toBe("true");
  });

  it("link params: race (default) / results / live; an old Board link opens RACE; anything else RACE", () => {
    expect(shareTabFromParam(null)).toBe("race");
    expect(shareTabFromParam("results")).toBe("results");
    expect(shareTabFromParam("live")).toBe("live");
    expect(shareTabFromParam("race")).toBe("race");
    expect(shareTabFromParam("board")).toBe("race");
    expect(shareTabFromParam("info")).toBe("race");
  });

  it("read-only: no judge or management controls, no text inputs, only public GETs", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ elite: "finished", open: false, race: { status: "finished" } }));
    mount(`/share/${TOKEN}?tab=results`);
    await flush();
    // Buttons other than the rider rows (which only expand details) and the tabs: Refresh, TV mode, Podium.
    const controls = screen.getAllByRole("button").filter((b) => b.getAttribute("data-testid") !== "share-rider-row");
    expect(controls.map((b) => b.getAttribute("data-testid"))).toEqual(["share-refresh", "share-tv", "share-podium-toggle"]);
    // 2.0: the only inputs are the two presentation filters (checkboxes) — no text inputs.
    expect([...document.querySelectorAll("input")].map((i) => i.type)).toEqual(["checkbox", "checkbox"]);
    fireEvent.click(screen.getByTestId("share-tab-race"));
    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("data-testid"))).toEqual(["share-refresh", "share-tv"]);
    expect(api.fetchPublicChanges).not.toHaveBeenCalled();
  });
});

/** RESULTS shows the official results only once the race is finished (Finish Race). */
const finishedSnapshot = (over: { elite?: string; approvals?: unknown[] } = {}) => snapshot({ ...over, open: false, race: { status: "finished" } });
const mountResults = async () => {
  mount(`/share/${TOKEN}?tab=results`);
  await flush();
};

describe("RESULTS", () => {
  it("2.0: nothing before the race is officially finished — a pointer to LIVE instead", async () => {
    await mountResults(); // race running
    expect(screen.getByTestId("share-results-pending").textContent).toMatch(/Race in progress/);
    expect(screen.queryAllByTestId("share-rider-row")).toHaveLength(0);
    expect(screen.queryByTestId("share-results-filters")).toBeNull();
    fireEvent.click(screen.getByTestId("share-follow-live"));
    expect(where).toBe(`/share/${TOKEN}?tab=live`);
  });

  it("ranked list with place, bib, name, time and statuses; provisional; tap a rider for lap details", async () => {
    api.fetchPublicRace.mockResolvedValue(finishedSnapshot());
    await mountResults();
    const rows = screen.getAllByTestId("share-rider-row");
    expect(rows.slice(0, 3).map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^111Test Alpha.*20:00/),
      expect.stringMatching(/^212Test Beta.*11:00/),
      expect.stringMatching(/–14Test Delta.*DNF/),
    ]);
    expect(rows[3].textContent).toMatch(/Test Gamma.*NOT STARTED/);
    expect(screen.getAllByTestId("share-provisional")).toHaveLength(1); // only the started category

    fireEvent.click(rows[0]);
    const details = screen.getByTestId("share-rider-details");
    expect(details.textContent).toMatch(/FINISHED/);
    expect(details.querySelectorAll("[data-testid='lap-row']")).toHaveLength(2);
    expect(screen.getByTestId("perf-laps").textContent).toMatch(/2/);
    fireEvent.click(rows[0]);
    expect(screen.queryByTestId("share-rider-details")).toBeNull();
  });

  it("category filter; the podium stays hidden while results are PROVISIONAL (0.3.5)", async () => {
    api.fetchPublicRace.mockResolvedValue(finishedSnapshot());
    await mountResults();
    fireEvent.change(screen.getByTestId("share-category-filter"), { target: { value: "c2" } });
    expect(screen.getAllByTestId("share-results-category")).toHaveLength(1);
    expect(screen.getByText("Test Gamma")).toBeTruthy();
    fireEvent.change(screen.getByTestId("share-category-filter"), { target: { value: "c1" } });
    expect(screen.getByTestId("share-provisional")).toBeTruthy();
    fireEvent.click(screen.getByTestId("share-podium-toggle"));
    expect(screen.queryAllByTestId("share-rider-row")).toHaveLength(0);
    expect(screen.getByTestId("share-podium-pending")).toBeTruthy();
    expect(screen.queryByTestId("share-approved")).toBeNull();
  });

  it("APPROVED (from the server) shows the podium, top 3 ⇄ top 5; a reload without it withdraws it", async () => {
    api.fetchPublicRace.mockResolvedValue(finishedSnapshot({ elite: "finished", approvals: [{ categoryUuid: "c1", status: "approved", approvedAt: new Date().toISOString() }] }));
    await mountResults();
    expect(screen.getAllByTestId("share-approved")).toHaveLength(1);
    expect(screen.queryAllByTestId("share-provisional")).toHaveLength(0); // Kids never started: no chip
    fireEvent.click(screen.getByTestId("share-podium-toggle"));
    expect(screen.getAllByTestId("share-rider-row").map((r) => r.textContent)).toEqual([expect.stringMatching(/Alpha/), expect.stringMatching(/Beta/)]);
    fireEvent.click(screen.getAllByTestId("share-podium-size")[0]);
    expect(screen.getByText("Top 5")).toBeTruthy();
    expect(screen.getByTestId("share-podium-pending")).toBeTruthy(); // Kids: not approved

    // A correction voided it on the server (a finished race no longer polls): the next load has no approval for c1.
    cleanup();
    api.fetchPublicRace.mockResolvedValue(finishedSnapshot({ elite: "finished" }));
    await mountResults();
    fireEvent.click(screen.getByTestId("share-podium-toggle"));
    expect(screen.queryByTestId("share-approved")).toBeNull();
    expect(screen.queryAllByTestId("share-rider-row")).toHaveLength(0);
  });
});

describe("refresh", () => {
  it("rule: 60 s while a wave runs, 5 min between waves, never once closed or finished", () => {
    const r = race();
    expect(publicRefreshDelay(true, r, cats("running"))).toBe(PUBLIC_REFRESH_RUNNING_MS);
    expect(publicRefreshDelay(true, r, cats("upcoming"))).toBe(PUBLIC_REFRESH_IDLE_MS);
    expect(publicRefreshDelay(false, r, cats("running"))).toBeNull();
    expect(publicRefreshDelay(true, race({ status: "finished" }), cats("finished"))).toBeNull();
    expect(publicRefreshDelay(true, race({ date: "2020-01-01" }), cats("running"))).toBeNull();
  });

  it("polls about every 60 s (not 10 s), pauses while hidden and revalidates on return", async () => {
    mount();
    await flush();
    expect(api.fetchPublicRace).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
    expect(api.fetchPublicChanges).toHaveBeenLastCalledWith(TOKEN, 5);

    act(() => setVisibility("hidden"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    await flush();
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(2);
  });

  it("never overlaps requests; manual refresh is throttled", async () => {
    mount();
    await flush();
    let release!: () => void;
    api.fetchPublicChanges.mockImplementation(() => new Promise((res) => { release = () => res({ lastSeq: 6, serverTime: Date.now(), polling: polling(), riders: [{ ...riders[1], position_category: 1 }] }); }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    fireEvent.click(screen.getByTestId("share-refresh"));
    await flush();
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("share-refresh")); // in flight: ignored (button disabled too)
    act(() => setVisibility("visible"));
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); }); // timer fires while in flight: joins it
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await flush();
    fireEvent.click(screen.getByTestId("share-refresh")); // < 10 s after the last request
    await flush();
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
  });

  it("finished race: one load, no polling, no socket", async () => {
    api.fetchPublicRace.mockResolvedValue(snapshot({ elite: "finished", open: false, race: { status: "finished" } }));
    mount();
    await flush();
    expect(screen.getByTestId("share-live-state").getAttribute("data-live")).toBe("off");
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(api.fetchPublicChanges).not.toHaveBeenCalled();
    expect(api.fetchPublicRace).toHaveBeenCalledTimes(1);
  });

  it("410 from updates: the race loads one last time, then polling stops", async () => {
    const { PublicApiError } = await import("@/services/live/publicRace");
    api.fetchPublicChanges.mockRejectedValue(new PublicApiError(410, "polling_closed", "ended"));
    mount();
    await flush();
    api.fetchPublicRace.mockResolvedValue(snapshot({ open: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flush();
    expect(api.fetchPublicRace).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(api.fetchPublicChanges).toHaveBeenCalledTimes(1);
  });
});

describe("Other Bike Races (browser-local)", () => {
  it("remembers opened public races, newest first, lists the others on the page", async () => {
    rememberOtherRace({ token: OTHER, name: "Spring Cup", date: "2026-04-01" }, 1);
    mount();
    await flush();
    expect(listOtherRaces().map((r) => r.token)).toEqual([TOKEN, OTHER]);
    const other = screen.getByTestId("share-other-races");
    expect(other.textContent).toMatch(/Spring Cup/);
    expect(other.textContent).not.toMatch(/Guest Cup/);
    expect(other.querySelector("a")?.getAttribute("href")).toBe(`/share/${OTHER}`);
  });

  it("ignores junk and can forget a race", () => {
    rememberOtherRace({ token: "../../evil", name: "x" });
    localStorage.setItem("commissaire.otherRaces.v1", JSON.stringify([{ token: OTHER, name: "A", openedAt: 1 }, { token: 5 }, null]));
    expect(listOtherRaces().map((r) => r.token)).toEqual([OTHER]);
    forgetOtherRace(OTHER);
    expect(listOtherRaces()).toEqual([]);
  });
});
