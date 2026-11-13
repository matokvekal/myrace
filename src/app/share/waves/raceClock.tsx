/**
 * The race clock of a wave (RACE, LIVE and the TV header) — elapsed time from the wave's
 * AUTHORITATIVE start (`category.startedAt`, server epoch ms), frozen at its finish.
 *
 * "Now" is the server's clock: every public answer carries `serverTime`; the feed keeps the
 * offset (server − device, measured at the middle of the request), so a TV whose clock is
 * wrong still shows the right race time. Precision is about half a request round-trip;
 * before the first answer the offset is 0 (the device clock).
 *
 * The ticking lives in this small component only, so the leaderboard never re-renders per
 * second. It pauses while the browser tab is hidden.
 */
import React, { useEffect, useState } from "react";

/** Elapsed ms of a wave at `serverNow`, or null when it has no actual start. */
export function waveClockMs(startedAt: number | null, finishedAt: number | null, serverNow: number): number | null {
  if (startedAt == null || !Number.isFinite(startedAt) || startedAt <= 0) return null;
  const end = finishedAt != null && finishedAt > 0 ? finishedAt : serverNow;
  return Math.max(0, end - startedAt);
}

/** "0:42:07" — always with hours, like a race clock. */
export function formatClock(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—:—:—";
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** A timestamp that advances every `tickMs` while the tab is visible. */
export function useTicker(tickMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer || document.visibilityState === "hidden") return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), tickMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => (document.visibilityState === "hidden" ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tickMs, enabled]);
  return now;
}

export function RaceClock({
  startedAt,
  finishedAt,
  offsetMs,
  className,
  testId = "race-clock",
}: {
  startedAt: number | null;
  finishedAt: number | null;
  offsetMs: number;
  className?: string;
  testId?: string;
}) {
  const running = startedAt != null && finishedAt == null;
  const now = useTicker(1000, running);
  const ms = waveClockMs(startedAt, finishedAt, now + offsetMs);
  return (
    <time className={className} data-testid={testId} data-running={running ? "true" : "false"} aria-label={`Race time ${formatClock(ms)}`}>
      {formatClock(ms)}
    </time>
  );
}
