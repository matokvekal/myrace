/**
 * Shared clocks and on-screen detection for the Live board (Tasks 4/5, 2026-11-15).
 *
 * Every rider card used to run two intervals of its own (1 s clock + 10 s pace ring) and
 * re-render on them whether it was on screen or not: 100 cards = 200 timers firing at
 * scattered moments. Now there is ONE interval per period for the whole page, cards
 * subscribe only while they are on screen, and all of them update in the same tick.
 * Values are always derived from timestamps, so a card that was off screen shows the
 * correct time / progress the moment it comes back.
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";

interface Clock {
  period: number;
  now: number;
  subs: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}
const clocks = new Map<number, Clock>();

function clockFor(period: number): Clock {
  let c = clocks.get(period);
  if (!c) {
    c = { period, now: Date.now(), subs: new Set(), timer: null };
    clocks.set(period, c);
  }
  return c;
}

function subscribeClock(c: Clock, cb: () => void): () => void {
  c.subs.add(cb);
  if (!c.timer) {
    c.now = Date.now(); // a stopped clock is stale: refresh before the first read
    c.timer = setInterval(() => {
      c.now = Date.now();
      c.subs.forEach((f) => f());
    }, c.period);
  }
  return () => {
    c.subs.delete(cb);
    if (c.subs.size === 0 && c.timer) {
      clearInterval(c.timer);
      c.timer = null;
    }
  };
}

const noSubscribe = () => () => {};

/**
 * Wall-clock ms, refreshed every `periodMs` by the shared clock while `active`.
 * Inactive: no timer, no re-render (the last value is returned; callers that need
 * "now" at a specific moment combine it with their own timestamps).
 */
export function useTick(periodMs: number, active: boolean): number {
  const c = clockFor(periodMs);
  const subscribe = useCallback((cb: () => void) => subscribeClock(c, cb), [c]);
  return useSyncExternalStore(active ? subscribe : noSubscribe, () => c.now);
}

/** Test helper: stop every shared clock. */
export function resetTickers(): void {
  for (const c of clocks.values()) if (c.timer) clearInterval(c.timer);
  clocks.clear();
}

// ── On-screen detection: one IntersectionObserver for every card ───────────────
type VisCb = (visible: boolean) => void;
let observer: IntersectionObserver | null = null;
const watchers = new Map<Element, VisCb>();

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) watchers.get(e.target)?.(e.isIntersecting);
      },
      // A little ahead of the viewport, so a card scrolling in is already up to date.
      { rootMargin: "200px 0px" },
    );
  }
  return observer;
}

/**
 * Whether the element is on (or about to come on) screen. True until the observer
 * says otherwise, and always true where IntersectionObserver doesn't exist.
 */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    const io = sharedObserver();
    if (!el || !io) return;
    watchers.set(el, setVisible);
    io.observe(el);
    return () => {
      io.unobserve(el);
      watchers.delete(el);
    };
  }, [ref]);
  return visible;
}
