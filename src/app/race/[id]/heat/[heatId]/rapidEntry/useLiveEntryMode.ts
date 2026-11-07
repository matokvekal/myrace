import { useCallback, useRef, useState } from "react";

/** Live recording mode: the existing rider cards, or the Rapid Entry keypad. */
export type LiveEntryMode = "cards" | "keypad";

const keyFor = (raceUuid: string) => `commissaire.liveEntryMode.${raceUuid}`;

function read(raceUuid: string): LiveEntryMode {
  try {
    return localStorage.getItem(keyFor(raceUuid)) === "keypad" ? "keypad" : "cards";
  } catch {
    return "cards";
  }
}

/** The chosen mode, kept per race on this device (survives wave switches and reloads). */
export function useLiveEntryMode(raceUuid: string) {
  const [state, setState] = useState(() => ({ raceUuid, mode: read(raceUuid) }));
  // Another race opened in the same component: load its own choice.
  const current = state.raceUuid === raceUuid ? state.mode : read(raceUuid);
  if (state.raceUuid !== raceUuid) setState({ raceUuid, mode: current });

  const setMode = useCallback(
    (mode: LiveEntryMode) => {
      setState({ raceUuid, mode });
      try {
        localStorage.setItem(keyFor(raceUuid), mode);
      } catch {
        /* private mode — the choice just isn't remembered */
      }
    },
    [raceUuid],
  );
  return [current, setMode] as const;
}

/** Horizontal swipe that switches modes. Ignored inside `[data-no-swipe]`, form fields and when disabled. */
export function useModeSwipe(opts: { enabled: boolean; onSwipeRight: () => void; onSwipeLeft: () => void }) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const MIN_DX = 70;
  const MAX_MS = 700;

  const onTouchStart = (e: React.TouchEvent) => {
    start.current = null;
    if (!opts.enabled || e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-swipe], input, select, textarea")) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || !opts.enabled) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Date.now() - s.t > MAX_MS || Math.abs(dx) < MIN_DX || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (dx > 0) opts.onSwipeRight();
    else opts.onSwipeLeft();
  };

  return { onTouchStart, onTouchEnd };
}
