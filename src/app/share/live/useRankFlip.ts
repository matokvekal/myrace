/**
 * FLIP animation of the LIVE leaderboard rows (mobile LIVE tab and TV broadcast).
 *
 * After every commit the rows' layout positions (by `data-uuid`, inside one container) are
 * recorded. When a GENUINE update arrives (a new `trend` object from useLiveTrend, never on
 * mount, view/filter change, page flip, tab switch or after a stale/reconnect period), each
 * row is played from its old place to its new one with the Web Animations API — transform and
 * opacity only, nothing that triggers layout:
 *   - primary mover (gain/loss): 1.4 s glide, lifted above the others, restrained stagger;
 *   - displaced rows: a plain 1.1 s glide, no stagger, no highlight;
 *   - out (DNF/DSQ/DNS): slides sideways out of its old place, then settles in the status section;
 *   - a row that arrives from another TV page enters from the side it came from; a row that
 *     left the visible page fades out as a short-lived, inert copy ("ghost"), so nothing jumps.
 * `prefers-reduced-motion: reduce` → no movement at all (the CSS keeps a static highlight).
 * Positions in the DOM are always the current ranking; only transforms are animated.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import type { LiveTrend } from "./useLiveTrend";

export const MOTION_MS = { primary: 1400, displaced: 1100, out: 1600, enter: 900, ghost: 800 } as const;
export const STAGGER_MS = 90;
export const MAX_STAGGER_STEPS = 5;
const EASE = "cubic-bezier(0.22, 0.8, 0.24, 1)";

interface Snap {
  top: number;
  left: number;
  width: number;
  height: number;
  html: string;
}

const ROW_SELECTOR = "[data-uuid]:not([data-ghost])";

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Layout offset of `el` inside `box`, ignoring transforms (so an animation in flight never skews it). */
function offsetWithin(el: HTMLElement, box: HTMLElement): { top: number; left: number } {
  let top = 0;
  let left = 0;
  let n: HTMLElement | null = el;
  while (n && n !== box) {
    top += n.offsetTop;
    left += n.offsetLeft;
    n = n.offsetParent as HTMLElement | null;
  }
  if (n === box) return { top, left };
  const a = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  return { top: a.top - b.top, left: a.left - b.left };
}

const staggerOf = (order: number) => Math.min(order, MAX_STAGGER_STEPS) * STAGGER_MS;

export function useRankFlip(containerRef: RefObject<HTMLElement | null>, trend: LiveTrend, opts: { stale?: boolean } = {}) {
  const snaps = useRef<Map<string, Snap>>(new Map());
  const lastTrend = useRef(trend);
  const wasStale = useRef(false);
  const running = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const box = containerRef.current;
    if (opts.stale) wasStale.current = true;
    const fresh = trend !== lastTrend.current;
    lastTrend.current = trend;
    if (!box) return;

    // READ everything first (one layout pass) …
    const rows = Array.from(box.querySelectorAll<HTMLElement>(ROW_SELECTOR));
    const now = new Map<string, { el: HTMLElement; top: number; left: number; width: number; height: number }>();
    for (const el of rows) {
      const uuid = el.dataset.uuid!;
      const { top, left } = offsetWithin(el, box);
      now.set(uuid, { el, top, left, width: el.offsetWidth, height: el.offsetHeight });
    }
    const before = snaps.current;
    const next = new Map<string, Snap>();
    for (const [uuid, r] of now) next.set(uuid, { top: r.top, left: r.left, width: r.width, height: r.height, html: r.el.outerHTML });
    snaps.current = next;

    // A reconnect after a stale period shows the result, never a replay of everything missed.
    const skip = !fresh || wasStale.current || opts.stale || before.size === 0 || prefersReducedMotion() || (typeof document !== "undefined" && document.visibilityState === "hidden");
    if (fresh && !opts.stale) wasStale.current = false;
    if (skip || typeof (box as HTMLElement).animate !== "function") return;

    // … then WRITE (animations only).
    for (const a of running.current) a.cancel();
    running.current = [];
    const play = (el: Element, frames: Keyframe[], o: KeyframeAnimationOptions, onEnd?: () => void) => {
      const a = el.animate(frames, { easing: EASE, fill: "backwards", ...o });
      running.current.push(a);
      a.onfinish = a.oncancel = () => onEnd?.();
    };
    const lift = (el: HTMLElement) => {
      el.dataset.motionActive = "true";
      return () => delete el.dataset.motionActive;
    };

    for (const [uuid, r] of now) {
      const prev = before.get(uuid);
      const m = trend.motions.get(uuid);
      const delta = trend.deltas.get(uuid);
      if (prev) {
        const dy = prev.top - r.top;
        if (m?.kind === "out") {
          play(
            r.el,
            [
              { transform: `translate(0, ${dy}px)`, opacity: 1 },
              { transform: `translate(55%, ${dy}px)`, opacity: 0, offset: 0.45 },
              { transform: "translate(-8%, 0)", opacity: 0, offset: 0.6 },
              { transform: "none", opacity: 1 },
            ],
            { duration: MOTION_MS.out },
            lift(r.el),
          );
        } else if (Math.abs(dy) >= 1) {
          const primary = !!m; // "out" was handled above
          play(
            r.el,
            [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
            { duration: primary ? MOTION_MS.primary : MOTION_MS.displaced, delay: primary ? staggerOf(m.order) : 0 },
            primary ? lift(r.el) : undefined,
          );
        }
      } else if (delta || (m && m.kind !== "out")) {
        // Arrived from another TV page: enter from the side it came from.
        const fromBelow = (m?.delta ?? delta ?? 0) > 0;
        const shift = Math.max(r.height, 1) * 1.5 * (fromBelow ? 1 : -1);
        play(r.el, [{ transform: `translateY(${shift}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: MOTION_MS.enter, delay: m ? staggerOf(m.order) : 0 });
      }
    }

    // Rows that left the visible page (still ranked, now on another page): fade out in place.
    for (const [uuid, prev] of before) {
      if (now.has(uuid)) continue;
      const delta = trend.deltas.get(uuid);
      const m = trend.motions.get(uuid);
      if (!delta && !m) continue;
      const ghost = ghostOf(prev);
      if (!ghost) continue;
      box.appendChild(ghost);
      const dir = m?.kind === "out" ? "translateX(55%)" : `translateY(${(delta ?? 0) > 0 ? -1 : 1}em)`;
      play(ghost, [{ transform: "none", opacity: 1 }, { transform: dir, opacity: 0 }], { duration: MOTION_MS.ghost, fill: "forwards" }, () => ghost.remove());
    }
  });
}

/** An inert visual copy of a row that is no longer on screen. */
function ghostOf(s: Snap): HTMLElement | null {
  const t = document.createElement("template");
  t.innerHTML = s.html.trim();
  const g = t.content.firstElementChild as HTMLElement | null;
  if (!g) return null;
  for (const a of ["data-uuid", "data-testid", "aria-label", "id"]) g.removeAttribute(a);
  g.querySelectorAll("[data-testid],[id]").forEach((c) => {
    c.removeAttribute("data-testid");
    c.removeAttribute("id");
  });
  g.setAttribute("aria-hidden", "true");
  g.dataset.ghost = "true";
  Object.assign(g.style, { position: "absolute", top: `${s.top}px`, left: `${s.left}px`, width: `${s.width}px`, height: `${s.height}px`, margin: "0", pointerEvents: "none", zIndex: "1" });
  return g;
}
