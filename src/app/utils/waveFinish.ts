import type { CategoryProps, RiderProps } from "@/types/types";
import { riderInCategory } from "../race/[id]/schedule/Schedule";

/** "mm:ss" / "h:mm:ss" from an "HH:MM:SS" start clock to `now` (same as StartManager's). */
function formatElapsed(now: Date, startTimeStr: string | null | undefined): string {
  if (!startTimeStr) return "--:--";
  const [h, m, s = 0] = startTimeStr.split(":").map(Number);
  const startMs = new Date(now);
  startMs.setHours(h, m, s, 0);
  const diffSec = Math.max(0, Math.floor((now.getTime() - startMs.getTime()) / 1000));
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * What finishing a WAVE changes — pure, shared by Race → Start (StartManager)
 * and Live (Finish Wave), so both finish a wave the same way:
 *   categories  every not-yet-finished category of the wave → finished (+finishedAt);
 *   finalized   riders of started categories who already finished or are out:
 *               raceStatus finished, elapsed time kept;
 *   closedOut   riders still on the road: credited as finishers on the laps they
 *               completed — ADMINISTRATIVELY finished (status "finished"), with
 *               no invented crossing time (timeArrive/laps untouched). Never DNF;
 *               a DNF/DSQ/DNS already set is kept.
 * Only the given wave's categories and riders are touched — never another wave,
 * even one linked through a Finish Group. Running it again changes nothing.
 */
export function planWaveFinish(waveCats: CategoryProps[], riders: RiderProps[], raceUuid: string, now: Date) {
  const categories = waveCats
    .filter((c) => c.status !== "finished")
    .map((c) => ({ ...c, status: "finished" as const, finishedAt: now.getTime() }));

  const finalized: RiderProps[] = [];
  for (const cat of waveCats.filter((c) => c.status === "running")) {
    for (const r of riders) {
      if (r.raceUuid !== raceUuid || r.status === "DNS" || !riderInCategory(r, cat)) continue;
      const isOut = r.status === "DNF" || r.status === "DSQ";
      if (!isOut && r.raceStatus !== "finished") continue;
      finalized.push({ ...r, raceStatus: "finished" as const, elapsedTimeFromStart: r.elapsedTimeFromStart ?? formatElapsed(now, r.timeStartRace) });
    }
  }

  const closedOut = riders
    .filter((r) => r.raceUuid === raceUuid && r.raceStatus === "running" && waveCats.some((c) => riderInCategory(r, c)))
    .map((r) => ({
      ...r,
      raceStatus: "finished" as const,
      status: ["DNF", "DSQ", "DNS"].includes(r.status) ? r.status : ("finished" as const),
    }));

  return { categories, finalized, closedOut };
}

/** A rider closed out by a wave finish (administrative), as opposed to one who crossed the line to finish. */
export const isAdministrativeFinish = (r: Pick<RiderProps, "status" | "raceStatus">): boolean =>
  r.raceStatus === "finished" && r.status === "finished";
