/**
 * TV broadcast hooks: rows that fit the screen, automatic page rotation, screen wake lock,
 * auto-hiding controls. All pause or clean up with the component; nothing polls the network.
 */
import { useEffect, useRef, useState } from "react";
import { rowsThatFit } from "./paging";

/** Seconds each leaderboard page stays on screen. */
export const PAGE_MS = 10_000;
/** Row height in em of the broadcast font (keep in step with --tv-row in broadcast.module.css). */
export const ROW_EM = 2.75;

/**
 * How many rows of ROW_EM fit in the element's height (re-measured on resize).
 * Returns a callback ref, so a different element (another layout) is measured too.
 */
export function useFitRows(rowEm = ROW_EM, fallback = 12): [(el: HTMLElement | null) => void, number] {
  const [rows, setRows] = useState(fallback);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const font = parseFloat(getComputedStyle(el).fontSize) || 16;
      const h = el.clientHeight;
      if (h > 0) setRows(rowsThatFit(h, font * rowEm));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, rowEm]);
  return [setEl, rows];
}

/** Cycles 0..count-1 every `ms` while the tab is visible; restarts at 0 when `resetKey` changes. */
export function usePager(count: number, ms = PAGE_MS, resetKey = ""): number {
  const [page, setPage] = useState(0);
  const countRef = useRef(count);
  countRef.current = count;
  useEffect(() => setPage(0), [resetKey]);
  useEffect(() => {
    if (count <= 1) return;
    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setPage((p) => (p + 1) % Math.max(1, countRef.current));
    }, ms);
    return () => clearInterval(t);
  }, [count > 1, ms, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return count > 0 ? Math.min(page, count - 1) : 0;
}

/** Keep the screen awake while the broadcast is shown (where the browser supports it). */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let lock: Sentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        lock = await nav.wakeLock!.request("screen");
      } catch {
        lock = null; // not allowed here: the display may dim, nothing else breaks
      }
    };
    const onVis = () => void acquire(); // the browser drops the lock when the tab is hidden
    void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => undefined);
    };
  }, [enabled]);
}

/** true while the pointer/keyboard was used in the last `ms` (controls + cursor show). */
export function useRecentActivity(ms = 3000): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const poke = () => {
      setActive(true);
      if (t) clearTimeout(t);
      t = setTimeout(() => setActive(false), ms);
    };
    window.addEventListener("pointermove", poke);
    window.addEventListener("pointerdown", poke);
    window.addEventListener("keydown", poke);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("pointermove", poke);
      window.removeEventListener("pointerdown", poke);
      window.removeEventListener("keydown", poke);
    };
  }, [ms]);
  return active;
}
