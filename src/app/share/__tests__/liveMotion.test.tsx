/**
 * LIVE ranking motion (Eurovision-style transitions): the pure classifier (rankMotion.ts)
 * and the real LIVE tab / TV board through SharePage with a mocked public API. jsdom has no
 * layout, so row offsets are stubbed (sibling index × 50 px) and Element.animate records
 * what would play.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { rankLive, type LiveEntry } from "../live/liveRanking";
import { classifyMotion } from "../live/rankMotion";
import { MOTION_MS, STAGGER_MS } from "../live/useRankFlip";
import type { PublicRider } from "../usePublicRaceFeed";

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

// ---------------------------------------------------------------------------- fixtures
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
let T0 = Date.now() - 2_527_000;
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const crossings = (mins: number[]) => mins.map((m, i) => ({ lap: i + 1, startTime: iso(i ? mins[i - 1] : 0), endTime: iso(m), lapTime: "" }));
const rider = (uuid: string, bib: number, mins: number[], over: Record<string, unknown> = {}) => ({
  uuid, bibNumber: bib, firstName: "Rider", lastName: `R${bib}`, category: "Elite", subCategory: null, status: "standing",
  raceStatus: "running", lapsCounter: mins.length, lapsDetails: crossings(mins), timeArrive: mins.length ? iso(mins[mins.length - 1]) : null,
  elapsedTimeFromStart: null, position_category: 0, ...over,
});
const cats = () => [
  { uuid: "c1", name: "Elite", subCategory: null, laps: 5, startTime: "09:00", heat: 1, status: "running", startedAt: T0, finishedAt: null, color: "#e53935", importOrder: 1 },
];
const polling = () => ({ open: true, endsAt: Date.now() + 3_600_000, intervalMs: 10_000 });
const snapshot = (riders: unknown[]) => ({
  lastSeq: 5, serverTime: Date.now(), polling: polling(),
  race: { uuid: "R", name: "Guest Cup", date: today(), time: "00:00", location: "Ben Shemen", status: "running" },
  categories: cats(), riders,
});
let seq = 5;
const update = (riders: unknown[]) => api.fetchPublicChanges.mockImplementationOnce(async () => ({ lastSeq: ++seq, serverTime: Date.now(), polling: polling(), riders }));

/** b leads (2 laps, 20'), a second (21'), c on course without a crossing (waiting), d too. */
const base = () => [rider("a", 11, [10, 21]), rider("b", 12, [10, 20]), rider("c", 13, []), rider("d", 14, [])];

// ---------------------------------------------------------------------------- pure classifier
const cat = new Map([["Elite::", cats()[0] as never]]);
const rank = (rs: ReturnType<typeof rider>[]): LiveEntry[] => rankLive(rs as unknown as PublicRider[], cat, "overall");

describe("classifyMotion (pure)", () => {
  it("upward: the rider with a new crossing gains; the rider passed is displaced (no motion)", () => {
    const m = classifyMotion(rank(base()), rank([rider("a", 11, [10, 21, 31]), ...base().slice(1)]));
    expect(m.get("a")).toMatchObject({ kind: "gain", delta: 1, cause: "data" });
    expect(m.has("b")).toBe(false);
  });

  it("downward: a rider whose own data puts it behind loses; the one it fell behind is displaced", () => {
    const m = classifyMotion(rank(base()), rank([rider("a", 11, [10, 21]), rider("b", 12, [10, 22]), ...base().slice(2)]));
    expect(m.get("b")).toMatchObject({ kind: "loss", delta: -1, cause: "data" });
    expect(m.has("a")).toBe(false);
  });

  it("a move nothing in the data explains is shown, but its cause is 'unknown' (never claimed)", () => {
    const prev = rank(base());
    const next = rank(base()).map((e) => ({ ...e })); // same data …
    [next[0], next[1]] = [next[1], next[0]]; // … re-ordered (e.g. a server correction)
    next[0].position = 1;
    next[1].position = 2;
    const m = classifyMotion(prev, next);
    expect(m.get("a")).toMatchObject({ kind: "gain", cause: "unknown" });
    expect(m.get("b")).toMatchObject({ kind: "loss", cause: "unknown" });
  });

  it("multiple independent movers, staggered in their new order", () => {
    const field = [10, 11, 12, 13, 14].map((t, i) => rider(`p${i + 1}`, 20 + i, [5, 10 + t]));
    const after = field.map((r) => (r.uuid === "p5" ? rider("p5", 24, [5, 24, 30]) : r.uuid === "p4" ? rider("p4", 23, [5, 23, 31]) : r));
    const m = classifyMotion(rank(field), rank(after));
    expect(m.get("p5")).toMatchObject({ kind: "gain", delta: 4, order: 0 });
    expect(m.get("p4")).toMatchObject({ kind: "gain", delta: 2, order: 1 });
    for (const u of ["p1", "p2", "p3"]) expect(m.has(u)).toBe(false); // displaced by two places, silently
  });

  it("DNF / DSQ / DNS → out; riders closing the gap are displaced", () => {
    for (const status of ["DNF", "DSQ"]) {
      const m = classifyMotion(rank(base()), rank([rider("a", 11, [10, 21]), rider("b", 12, [10, 20], { status }), ...base().slice(2)]));
      expect(m.get("b")).toMatchObject({ kind: "out", delta: 0 });
      expect(m.has("a")).toBe(false);
    }
    const dns = classifyMotion(rank(base()), rank([...base().slice(0, 3), rider("d", 14, [], { status: "DNS" })]));
    expect(dns.get("d")).toMatchObject({ kind: "out" });
  });

  it("riders compared only within their own context (one wave on TV)", () => {
    const prev = rank([rider("a", 11, [10, 21]), rider("b", 12, [10, 20])]);
    const next = rank([rider("a", 11, [10, 21, 31]), rider("b", 12, [10, 20])]);
    // pretend b is in another wave: a's crossing can't explain b's move → unknown cause
    const m = classifyMotion(prev, next, (e) => (e.uuid === "b" ? "2" : "1"));
    expect(m.get("b")).toMatchObject({ kind: "loss", cause: "unknown" });
  });

  it("no baseline → nothing; a first crossing (no previous position) never gets an arrow", () => {
    expect(classifyMotion([], rank(base())).size).toBe(0);
    const m = classifyMotion(rank(base()), rank([...base().slice(0, 2), rider("c", 13, [9])]));
    expect(m.has("c")).toBe(false);
  });
});

// ---------------------------------------------------------------------------- components
type Call = { el: HTMLElement; frames: Keyframe[]; opts: KeyframeAnimationOptions };
let calls: Call[] = [];
const callsFor = (uuid: string) => calls.filter((c) => c.el.dataset.uuid === uuid);
const restore: (() => void)[] = [];
function stubLayout() {
  const proto = HTMLElement.prototype;
  const idx = (el: Element) => (el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0);
  const define = (name: string, get: (this: HTMLElement) => unknown) => {
    const before = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, get });
    restore.push(() => (before ? Object.defineProperty(proto, name, before) : delete (proto as unknown as Record<string, unknown>)[name]));
  };
  define("offsetTop", function () { return idx(this) * 50; });
  define("offsetLeft", () => 0);
  define("offsetWidth", () => 600);
  define("offsetHeight", () => 50);
  define("offsetParent", function () { return this.parentElement; });
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (this: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, opts });
    return { cancel() {}, onfinish: null, oncancel: null } as unknown as Animation;
  } as typeof Element.prototype.animate;
  restore.push(() => (Element.prototype.animate = animate));
}

const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/share/:token" element={<SharePage />} />
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
const row = (bib: number, testId = "live-row") => screen.getAllByTestId(testId).find((r) => r.getAttribute("aria-label")?.includes(`bib ${bib}`))!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date());
  T0 = Date.now() - 2_527_000;
  seq = 5;
  calls = [];
  stubLayout();
  api.fetchPublicRace.mockReset().mockImplementation(async () => snapshot(base()));
  api.fetchPublicChanges.mockReset().mockImplementation(async () => ({ lastSeq: seq, serverTime: Date.now(), polling: polling(), unchanged: true }));
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => {
  cleanup();
  while (restore.length) restore.pop()!();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LIVE tab motion", () => {
  it("initial load never animates", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    await tick(20_000); // an update with no new data
    expect(calls).toHaveLength(0);
    expect(document.querySelector("[data-motion]")).toBeNull();
  });

  it("upward: green arrow + glide up + arrival border; the displaced rider glides silently", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    update([rider("a", 11, [10, 21, 31])]);
    await tick(20_000);

    const a = row(11);
    expect(a.getAttribute("aria-label")).toMatch(/^Position 1, bib 11/); // the number is already the new ranking
    expect(a.getAttribute("data-motion")).toBe("gain");
    expect(a.getAttribute("data-moved")).toBe("up");
    expect(a.querySelector('[data-trend="up"]')?.textContent).toBe("▲1");
    expect(a.querySelector('[data-kind="gain"]')).not.toBeNull(); // the fading border
    const [up] = callsFor("a");
    expect(up.frames[0].transform).toBe("translateY(50px)"); // from row 2 to row 1
    expect(up.opts.duration).toBe(MOTION_MS.primary);

    const b = row(12);
    expect(b.getAttribute("aria-label")).toMatch(/^Position 2, bib 12.*down 1 place$/); // still spoken
    expect(b.getAttribute("data-motion")).toBeNull();
    expect(b.querySelector('[data-trend="down"]')).toBeNull(); // no dramatic arrow
    expect(b.querySelector('[data-kind]')).toBeNull();
    const [down] = callsFor("b");
    expect(down.frames[0].transform).toBe("translateY(-50px)");
    expect(down.opts).toMatchObject({ duration: MOTION_MS.displaced, delay: 0 });
  });

  it("downward: red arrow + glide down for the rider whose own data dropped it", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    update([rider("b", 12, [10, 22])]); // a corrected crossing puts b behind a
    await tick(20_000);
    const b = row(12);
    expect(b.getAttribute("data-motion")).toBe("loss");
    expect(b.querySelector('[data-trend="down"]')?.textContent).toBe("▼1");
    expect(b.querySelector('[data-kind="loss"]')).not.toBeNull();
    expect(callsFor("b")[0].frames[0].transform).toBe("translateY(-50px)");
    expect(row(11).getAttribute("data-motion")).toBeNull(); // a is only displaced
  });

  it("multiple movers animate independently with a restrained stagger", async () => {
    const field = [10, 11, 12, 13, 14].map((t, i) => rider(`p${i + 1}`, 20 + i, [5, 10 + t]));
    api.fetchPublicRace.mockImplementation(async () => snapshot(field));
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    update([rider("p5", 24, [5, 24, 30]), rider("p4", 23, [5, 23, 31])]);
    await tick(20_000);
    expect(row(24).getAttribute("data-motion")).toBe("gain");
    expect(row(23).getAttribute("data-motion")).toBe("gain");
    expect(callsFor("p5")[0].opts.delay).toBe(0);
    expect(callsFor("p4")[0].opts.delay).toBe(STAGGER_MS);
    for (const u of ["p1", "p2", "p3"]) {
      expect(callsFor(u)[0].opts).toMatchObject({ duration: MOTION_MS.displaced, delay: 0 });
      expect(callsFor(u)[0].frames[0].transform).toBe("translateY(-100px)"); // two rows down
    }
  });

  it("DNF: slides sideways out of the ranking, stays in the DNF · DSQ · DNS section; others close the gap", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    update([rider("b", 12, [10, 20], { status: "DNF" })]);
    await tick(20_000);
    const b = row(12);
    expect(b.getAttribute("aria-label")).toMatch(/^DNF, bib 12/);
    expect(b.getAttribute("data-motion")).toBe("out");
    expect(screen.getByText("DNF · DSQ · DNS")).toBeTruthy();
    const out = callsFor("b")[0];
    expect(out.opts.duration).toBe(MOTION_MS.out);
    expect(out.frames.some((f) => String(f.transform).startsWith("translate(55%"))).toBe(true);
    expect(callsFor("a")[0].opts.duration).toBe(MOTION_MS.displaced); // a moves up, silently
    expect(row(11).getAttribute("data-motion")).toBeNull();
  });

  it("DNS of a rider who never crossed: out as well", async () => {
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    update([rider("d", 14, [], { status: "DNS" })]);
    await tick(20_000);
    expect(row(14).getAttribute("data-motion")).toBe("out");
    expect(callsFor("d")[0].opts.duration).toBe(MOTION_MS.out);
  });

  it("no replay on view changes, tab switches or the first update after a connection loss", async () => {
    const { PublicApiError } = await import("@/services/live/publicRace");
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    fireEvent.click(screen.getByTestId("live-mode-category"));
    fireEvent.click(screen.getByTestId("live-mode-overall"));
    fireEvent.click(screen.getByTestId("share-tab-race"));
    fireEvent.click(screen.getByTestId("share-tab-live"));
    await flush();
    expect(calls).toHaveLength(0);

    api.fetchPublicChanges.mockRejectedValueOnce(new PublicApiError(0, "offline", "No connection"));
    await tick(20_000);
    expect(screen.getByTestId("live-tab").getAttribute("data-freshness")).toBe("stale");
    update([rider("a", 11, [10, 21, 31])]); // reconnect: the result is shown, not replayed
    await tick(20_000);
    expect(row(11).getAttribute("aria-label")).toMatch(/^Position 1, bib 11/);
    expect(calls).toHaveLength(0);

    update([rider("b", 12, [10, 20, 30])]); // the next live update animates again (b back in front)
    await tick(20_000);
    expect(callsFor("b").length).toBeGreaterThan(0);
  });

  it("prefers-reduced-motion: no movement, the arrow and position still show", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    mount(`/share/${TOKEN}?tab=live`);
    await flush();
    update([rider("a", 11, [10, 21, 31])]);
    await tick(20_000);
    expect(calls).toHaveLength(0);
    expect(row(11).querySelector('[data-trend="up"]')?.textContent).toBe("▲1");
  });
});

describe("TV broadcast motion across pages", () => {
  // 30 riders: jsdom fallback = 12 rows → 3 pinned + 8 per page.
  const field = () => Array.from({ length: 30 }, (_, i) => rider(`r${i}`, 100 + i, [10, 20 + i / 10]));

  it("a rider from a later page enters the pinned leaders; the row pushed off the page fades out as an inert ghost", async () => {
    api.fetchPublicRace.mockImplementation(async () => snapshot(field()));
    mount(`/share/${TOKEN}?tab=live&view=tv`);
    await flush();
    const before = screen.getAllByTestId("tv-row").length;
    update([rider("r27", 127, [10, 22.7, 30])]); // leads now
    await tick(20_000);
    expect(screen.getByTestId("tv-pager").textContent).toMatch(/Page 3 \/ 4/); // the pager kept rotating meanwhile
    const leader = screen.getAllByTestId("tv-row")[0];
    expect(leader.getAttribute("aria-label")).toMatch(/^Position 1, bib 127/);
    expect(leader.getAttribute("data-motion")).toBe("gain");
    const enter = callsFor("r27")[0];
    expect(enter.frames[0]).toMatchObject({ opacity: 0 }); // arrives from below, fading in
    expect(String(enter.frames[0].transform)).toMatch(/^translateY\(\d/);
    expect(screen.getAllByTestId("tv-row")).toHaveLength(before); // ghosts are not rows
    const ghosts = Array.from(document.querySelectorAll<HTMLElement>("[data-ghost]"));
    for (const g of ghosts) {
      expect(g.getAttribute("aria-hidden")).toBe("true");
      expect(g.getAttribute("data-testid")).toBeNull();
    }
  });

  it("a mover glides from the page up into the pinned leaders; displaced rows glide; a row pushed off screen leaves as a ghost", async () => {
    api.fetchPublicRace.mockImplementation(async () => snapshot(field()));
    mount(`/share/${TOKEN}?tab=live&view=tv`);
    await flush();
    await tick(16_000); // page 2 (indices 11–18) since 10 s
    expect(screen.getByTestId("tv-pager").textContent).toMatch(/Page 2 \/ 4/);
    // r15 (page 2) → 1st; r2 (3rd, pinned) → 4th, off screen; r10 (page 1) → 12th, onto this page
    update([rider("r15", 115, [10, 21.5, 30])]);
    setVisibility("hidden");
    setVisibility("visible"); // returning with ≥ 15 s old data revalidates now, between page flips
    await flush();
    expect(screen.getByTestId("tv-pager").textContent).toMatch(/Page 2 \/ 4/);

    const leader = screen.getAllByTestId("tv-row")[0];
    expect(leader.getAttribute("aria-label")).toMatch(/^Position 1, bib 115/);
    const glide = callsFor("r15")[0]; // measured in the page list before, in the pinned list now
    expect(glide.opts.duration).toBe(MOTION_MS.primary);
    expect(glide.frames[0].transform).toBe("translateY(300px)");

    const enter = callsFor("r10")[0]; // came onto this page from the one before: enters from above, faded
    expect(enter.frames[0]).toMatchObject({ opacity: 0 });
    expect(String(enter.frames[0].transform)).toMatch(/^translateY\(-/);

    for (const u of ["r0", "r1", "r11", "r14"]) {
      expect(callsFor(u)[0].opts).toMatchObject({ duration: MOTION_MS.displaced, delay: 0 });
      expect(screen.getAllByTestId("tv-row").find((r) => r.dataset.uuid === u)?.getAttribute("data-motion")).toBeNull();
    }

    const ghosts = Array.from(document.querySelectorAll<HTMLElement>("[data-ghost]"));
    expect(ghosts.length).toBeGreaterThan(0); // r2 fades out instead of vanishing
    expect(ghosts.some((g) => g.textContent?.includes("102"))).toBe(true);
    for (const g of ghosts) {
      expect(g.getAttribute("aria-hidden")).toBe("true");
      expect(g.getAttribute("data-testid")).toBeNull();
      expect(g.getAttribute("data-uuid")).toBeNull();
    }
  });
});
