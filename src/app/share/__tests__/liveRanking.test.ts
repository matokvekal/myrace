/**
 * Public page 2.0 — pure rules: active waves, LIVE provisional ranking, position changes,
 * RESULTS filters, TV paging, race clock, feed freshness, LIVE refresh rule.
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { SharedCategory } from "../../../shared/race/state";
import type { PublicRider } from "../usePublicRaceFeed";
import { activeWaves, categoryKey, nextWave, ridersByCategory, summarizeWaves } from "../waves/activeWaves";
import { formatGap, formatRaceTime, lapsText, rankLive } from "../live/liveRanking";
import { trendDeltas, useLiveTrend } from "../live/useLiveTrend";
import { filterResultCategories, filterResultRiders, resultWaves } from "../results/resultFilterRules";
import { rankRiders } from "../results/officialOrder";
import { pagePlan, rowsThatFit } from "../broadcast/paging";
import { formatClock, waveClockMs } from "../waves/raceClock";
import { feedFreshness } from "../feedStatus";
import { publicRefreshDelay, PUBLIC_REFRESH_IDLE_MS, PUBLIC_REFRESH_LIVE_MS, PUBLIC_REFRESH_RUNNING_MS } from "../publicRefresh";

const T0 = Date.parse("2026-11-08T09:00:00Z");
const iso = (min: number, sec = 0) => new Date(T0 + min * 60_000 + sec * 1000).toISOString();

const cat = (uuid: string, name: string, over: Partial<SharedCategory> = {}): SharedCategory =>
  ({ uuid, raceUuid: "R", name, subCategory: null, laps: 3, startTime: "09:00", heat: 1, status: "running", startedAt: T0, finishedAt: null, color: "#123456", importOrder: 1, ignored: false, ...over }) as SharedCategory;

/** A rider who crossed `crossings` (minutes after T0 + its start offset). */
function rider(uuid: string, bib: number, category: string, crossings: number[], over: Partial<PublicRider> = {}, startMin = 0): PublicRider {
  const laps = crossings.map((m, i) => ({ lap: i + 1, startTime: iso(i === 0 ? startMin : crossings[i - 1]), endTime: iso(m), lapTime: "" }));
  return {
    uuid,
    bibNumber: bib,
    firstName: `F${bib}`,
    lastName: `L${bib}`,
    category,
    subCategory: null,
    status: "standing",
    raceStatus: "running",
    lapsCounter: crossings.length,
    lapsDetails: laps,
    timeArrive: laps.length ? laps[laps.length - 1].endTime : null,
    elapsedTimeFromStart: null,
    position_category: 0,
    ...over,
  } as PublicRider;
}

const catMap = (...cats: SharedCategory[]) => new Map(cats.map((c) => [categoryKey(c.name, c.subCategory), c]));

describe("active waves", () => {
  const cats = [
    cat("a", "Elite", { heat: 1, status: "finished", startedAt: T0, finishedAt: T0 + 3_600_000 }),
    cat("b", "Masters", { heat: 2, status: "running", startedAt: T0 + 600_000 }),
    cat("c", "Juniors", { heat: 2, status: "upcoming", startedAt: null }),
    cat("d", "Kids", { heat: 3, status: "upcoming", startedAt: null, startTime: "11:00" }),
    cat("e", "Open", { heat: null, status: "upcoming", startedAt: null }),
  ];
  const riders = [
    rider("r1", 1, "Masters", [20]),
    rider("r2", 2, "Masters", [], { raceStatus: "running" }),
    rider("r3", 3, "Masters", [21], { status: "finished", raceStatus: "finished" }),
    rider("r4", 4, "Masters", [], { status: "DNF" }),
    // the rider's own `heat` copy says 9 — the CATEGORY's wave wins
    rider("r5", 5, "Juniors", [], { heat: 9, raceStatus: "upcoming" }),
  ];
  const waves = summarizeWaves(cats, ridersByCategory(riders));

  it("groups by category.heat, in wave order, unscheduled last", () => {
    expect(waves.map((w) => w.key)).toEqual(["1", "2", "3", "—"]);
    expect(waves[1].riders.map((r) => r.uuid).sort()).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });

  it("a wave is RUNNING when any category runs; states, actual start, counts", () => {
    expect(waves.map((w) => w.state)).toEqual(["finished", "running", "upcoming", "upcoming"]);
    expect(activeWaves(waves).map((w) => w.key)).toEqual(["2"]);
    expect(waves[1]).toMatchObject({ startedAt: T0 + 600_000, finishedAt: null, onCourse: 2, finished: 1, out: 1, total: 5 });
    expect(waves[0].finishedAt).toBe(T0 + 3_600_000);
    expect(nextWave(waves)?.key).toBe("3");
  });

  it("several running waves are all active; none → empty", () => {
    const two = summarizeWaves([cat("x", "A", { heat: 1 }), cat("y", "B", { heat: 2 })], new Map());
    expect(activeWaves(two).map((w) => w.key)).toEqual(["1", "2"]);
    expect(activeWaves(summarizeWaves([cat("x", "A", { status: "upcoming", startedAt: null })], new Map()))).toEqual([]);
  });
});

describe("LIVE ranking", () => {
  const elite = cat("e", "Elite", { laps: 3 });
  const masters = cat("m", "Masters", { laps: 2 });
  const cats = catMap(elite, masters);

  it("more laps first, then the shorter race time; positions only for riders who crossed", () => {
    const list = rankLive(
      [
        rider("a", 10, "Elite", [10, 21]),
        rider("b", 11, "Elite", [10, 20]),
        rider("c", 12, "Elite", [11, 22, 33]),
        rider("d", 13, "Elite", []),
      ],
      cats,
    );
    expect(list.map((e) => [e.uuid, e.position, e.group])).toEqual([
      ["c", 1, "racing"],
      ["b", 2, "racing"],
      ["a", 3, "racing"],
      ["d", null, "waiting"],
    ]);
    expect(list.map((e) => formatGap(e.gap))).toEqual(["Leader", "+1 lap", "+1 lap", "—"]);
    expect(list[3].elapsedMs).toBeNull(); // no made-up time
    expect(lapsText(list[0])).toBe("3/3");
  });

  it("same laps: gap is the race-time difference", () => {
    const list = rankLive([rider("a", 1, "Elite", [10, 20]), rider("b", 2, "Elite", [10, 20], {}, 0), rider("c", 3, "Elite", [10, 20.5])], cats);
    expect(list.map((e) => e.uuid)).toEqual(["a", "b", "c"]); // a/b tie → bib
    expect(formatGap(list[1].gap)).toBe("+0:00");
    expect(formatGap(list[2].gap)).toBe("+0:30");
  });

  it("different start times in one wave: compares elapsed race time, not the clock", () => {
    // Masters started 5 min later; crossed at 24 (19 min race) vs Elite at 22 (22 min race).
    const list = rankLive([rider("el", 1, "Elite", [11, 22]), rider("ma", 2, "Masters", [16, 24], {}, 5)], cats);
    expect(list.map((e) => e.uuid)).toEqual(["ma", "el"]);
    expect(formatRaceTime(list[0].elapsedMs)).toBe("19:00");
  });

  it("DNF / DSQ / DNS always at the bottom, without a position, in that order", () => {
    const list = rankLive(
      [
        rider("dns", 1, "Elite", [], { status: "DNS" }),
        rider("dnf", 2, "Elite", [10, 20, 30], { status: "DNF" }),
        rider("ok", 3, "Elite", [12]),
        rider("dsq", 4, "Elite", [10], { status: "DSQ" }),
      ],
      cats,
    );
    expect(list.map((e) => [e.uuid, e.position])).toEqual([["ok", 1], ["dnf", null], ["dsq", null], ["dns", null]]);
    expect(list.slice(1).every((e) => e.group === "out")).toBe(true);
  });

  it("FINISHED stays distinguishable from riders still racing", () => {
    const list = rankLive([rider("f", 1, "Elite", [10, 20, 30], { status: "finished", raceStatus: "finished" }), rider("r", 2, "Elite", [11, 21])], cats);
    expect(list.map((e) => [e.status, e.finished])).toEqual([["FINISHED", true], ["RUNNING", false]]);
  });

  it("missing timestamps: no crossing time → waiting, never ranked on a fake time", () => {
    const broken = rider("x", 7, "Elite", [10], { timeArrive: null });
    const noTime = rider("y", 8, "Elite", [10], { lapsDetails: [], elapsedTimeFromStart: null, timeStartRace: null });
    const list = rankLive([broken, noTime, rider("z", 9, "Elite", [12])], cats);
    expect(list.map((e) => [e.uuid, e.group])).toEqual([["z", "racing"], ["y", "racing"], ["x", "waiting"]]);
    expect(list[1].elapsedMs).toBeNull(); // y has a crossing but no start: sorts after known times
    expect(formatGap(list[1].gap)).toBe("—");
  });

  it("duplicate and out-of-order data: one row per rider, lap 1 found by number", () => {
    const r = rider("a", 1, "Elite", [10, 20]);
    const shuffled = { ...r, lapsDetails: [...(r.lapsDetails ?? [])].reverse() };
    const list = rankLive([shuffled, r, rider("b", 2, "Elite", [10, 21])], cats);
    expect(list.map((e) => e.uuid)).toEqual(["a", "b"]);
    expect(formatRaceTime(list[0].elapsedMs)).toBe("20:00");
  });

  it("deterministic: input order never changes the result", () => {
    const rs = [rider("a", 5, "Elite", [10]), rider("b", 3, "Elite", [10]), rider("c", 4, "Elite", []), rider("d", 1, "Elite", [], { status: "DNF" })];
    const one = rankLive(rs, cats).map((e) => e.uuid);
    expect(rankLive([...rs].reverse(), cats).map((e) => e.uuid)).toEqual(one);
    expect(one).toEqual(["b", "a", "c", "d"]);
  });

  it("By category: the server's position_category wins when both riders have one", () => {
    const list = rankLive([rider("a", 1, "Elite", [10, 20], { position_category: 2 }), rider("b", 2, "Elite", [10, 21], { position_category: 1 })], cats, "category");
    expect(list.map((e) => e.uuid)).toEqual(["b", "a"]);
    expect(rankLive([rider("a", 1, "Elite", [10, 20], { position_category: 2 }), rider("b", 2, "Elite", [10, 21], { position_category: 1 })], cats, "overall").map((e) => e.uuid)).toEqual(["a", "b"]);
  });
});

describe("position changes", () => {
  it("places gained / lost between two snapshots", () => {
    const d = trendDeltas(new Map([["a", 1], ["b", 2], ["c", 3]]), new Map([["b", 1], ["a", 2], ["c", 3], ["n", 4]]));
    expect([...d]).toEqual([["b", 1], ["a", -1]]);
  });

  it("compares only genuine new rankings; a view change resets the baseline", () => {
    const cats = catMap(cat("e", "Elite"));
    const first = rankLive([rider("a", 1, "Elite", [10]), rider("b", 2, "Elite", [11])], cats);
    const { result, rerender } = renderHook(({ ranking, view }) => useLiveTrend(ranking, view), { initialProps: { ranking: first, view: "w1" } });
    expect(result.current.deltas.size).toBe(0);
    rerender({ ranking: first, view: "w1" }); // re-render, same data
    expect(result.current.version).toBe(0);
    const second = rankLive([rider("a", 1, "Elite", [10, 22]), rider("b", 2, "Elite", [11, 21])], cats);
    act(() => rerender({ ranking: second, view: "w1" }));
    expect([...result.current.deltas]).toEqual([["b", 1], ["a", -1]]);
    expect(result.current.version).toBe(1);
    rerender({ ranking: second, view: "w1" });
    expect(result.current.deltas.get("b")).toBe(1); // still the last update's change
    rerender({ ranking: first, view: "category" });
    expect(result.current.deltas.size).toBe(0);
  });
});

describe("RESULTS filters (presentation only)", () => {
  const cats = [cat("a", "Elite", { heat: 1 }), cat("b", "Kids", { heat: 2 }), cat("c", "Open", { heat: 2 })];
  const riders = [
    rider("1", 1, "Elite", [10], { status: "finished", raceStatus: "finished", position_category: 1 }),
    rider("2", 2, "Elite", [], { status: "DNF" }),
    rider("3", 3, "Kids", [], { status: "DNS" }),
    rider("4", 4, "Open", [10], { status: "finished", raceStatus: "finished", position_category: 1 }),
  ];
  const by = ridersByCategory(riders);

  it("Only Finishers hides non-finishers and categories without finishers", () => {
    const f = { onlyFinishers: true, byWave: false, wave: null };
    expect(filterResultCategories(cats, by, f).map((c) => c.name)).toEqual(["Elite", "Open"]);
    expect(filterResultRiders(by.get("Elite::")!, f).map((r) => r.uuid)).toEqual(["1"]);
  });

  it("Filter by Wave, and both filters together", () => {
    expect(filterResultCategories(cats, by, { onlyFinishers: false, byWave: true, wave: "2" }).map((c) => c.name)).toEqual(["Kids", "Open"]);
    expect(filterResultCategories(cats, by, { onlyFinishers: true, byWave: true, wave: "2" }).map((c) => c.name)).toEqual(["Open"]);
    expect(filterResultCategories(cats, by, { onlyFinishers: false, byWave: false, wave: "2" })).toHaveLength(3);
    expect(resultWaves(cats)).toEqual(["1", "2"]);
  });

  it("filters never change official positions or order", () => {
    const all = rankRiders(by.get("Elite::")!);
    const kept = filterResultRiders(all, { onlyFinishers: true });
    expect(kept[0]).toBe(all[0]);
    expect(kept[0].position_category).toBe(1);
  });
});

describe("TV paging", () => {
  it("everything fits → one page, nothing pinned", () => {
    expect(pagePlan(8, 10)).toEqual({ pinned: 0, pages: [[0, 8]] });
  });
  it("large fields: top 3 pinned, the rest cycles", () => {
    expect(pagePlan(30, 10)).toEqual({ pinned: 3, pages: [[3, 10], [10, 17], [17, 24], [24, 30]] });
  });
  it("short screens don't pin", () => {
    expect(pagePlan(10, 5)).toEqual({ pinned: 0, pages: [[0, 5], [5, 10]] });
    expect(rowsThatFit(550, 55)).toBe(10);
    expect(rowsThatFit(10, 55)).toBe(1);
  });
});

describe("race clock", () => {
  it("elapsed from the authoritative start, frozen at the finish", () => {
    expect(waveClockMs(T0, null, T0 + 2_527_000)).toBe(2_527_000);
    expect(formatClock(2_527_000)).toBe("0:42:07");
    expect(waveClockMs(T0, T0 + 3_600_000, T0 + 9_999_999)).toBe(3_600_000);
    expect(waveClockMs(null, null, T0)).toBeNull();
    expect(formatClock(null)).toBe("—:—:—");
  });
});

describe("feed freshness", () => {
  const base = { offline: false, updatedAt: 1_000_000, delayMs: 20_000, raceFinished: false };
  it("fresh within two intervals + grace; stale after, or when offline; ended when polling stopped", () => {
    expect(feedFreshness({ ...base, now: 1_000_000 + 45_000 })).toBe("fresh");
    expect(feedFreshness({ ...base, now: 1_000_000 + 55_000 })).toBe("stale");
    expect(feedFreshness({ ...base, offline: true, now: 1_000_000 })).toBe("stale");
    expect(feedFreshness({ ...base, delayMs: null, now: 1_000_000 })).toBe("ended");
    expect(feedFreshness({ ...base, delayMs: null, raceFinished: true, now: 1_000_000 })).toBe("fresh");
  });
});

describe("LIVE refresh rule", () => {
  const race = { status: "running", date: new Date().toISOString().slice(0, 10), time: "00:00" };
  it("20 s only with the LIVE tab and a running wave; other tabs unchanged", () => {
    expect(publicRefreshDelay(true, race, [{ status: "running" }], Date.now(), { liveTab: true })).toBe(PUBLIC_REFRESH_LIVE_MS);
    expect(PUBLIC_REFRESH_LIVE_MS).toBe(20_000);
    expect(publicRefreshDelay(true, race, [{ status: "running" }], Date.now())).toBe(PUBLIC_REFRESH_RUNNING_MS);
    expect(publicRefreshDelay(true, race, [{ status: "upcoming" }], Date.now(), { liveTab: true })).toBe(PUBLIC_REFRESH_IDLE_MS);
    expect(publicRefreshDelay(false, race, [{ status: "running" }], Date.now(), { liveTab: true })).toBeNull();
  });
});
