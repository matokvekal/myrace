/**
 * Guest polling window — ONE rule for the server (which refuses updates outside it)
 * and the shared race page (which stops polling). Pure.
 *
 *  - Open while the race can still change.
 *  - Closed once the race is finished (finalized).
 *  - Closed no later than 24 hours after the race's scheduled start (the LIVE window),
 *    even if it was never finalized and even if a wave is still "running". The scheduled
 *    start is the race date at the EARLIEST of the race's start time and its categories'
 *    start times (the race's local time zone, Asia/Jerusalem by default); a race without
 *    a date counts from when it was created.
 *  - READ-TIME only: nothing here changes a race, category or rider status. A wave left
 *    running stays "running" in the data; the window just stops LIVE polling and the
 *    active-wave indicators, and the organizer is warned (`unfinishedAfterWindow`).
 *  - Multi-day races (future): an optional `race.endDate` extends the window to the end of
 *    that day (never shorter than 24 h). No screen sets it yet; single-day races ignore it.
 */
export const GUEST_POLL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const GUEST_POLL_INTERVAL_MS = 10_000;
export const RACE_TIME_ZONE = "Asia/Jerusalem";

interface RaceLike {
  status?: string | null;
  date?: string | null;
  time?: string | null;
  createdAt?: string | null;
  /** Future multi-day races: last race day ("YYYY-MM-DD" / "DD/MM/YYYY"). Absent = single day. */
  endDate?: string | null;
}
interface CategoryLike {
  startTime?: string | null;
  status?: string | null;
}

const HHMM = /^(\d{1,2}):(\d{2})/;

/** Offset of `tz` from UTC at instant `ms`, in ms. */
function zoneOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - ms;
}

/** Wall-clock time in `tz` → epoch ms. */
function zonedTime(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const first = wall - zoneOffset(wall, tz);
  return wall - zoneOffset(first, tz);
}

/** The race's scheduled start (epoch ms), or null when it can't be told. */
export function scheduledStartMs(race: RaceLike, categories: CategoryLike[] = [], tz = RACE_TIME_ZONE): number | null {
  const raw = String(race.date ?? "").trim();
  // Race dates are "YYYY-MM-DD" (date inputs, ISO) or "DD/MM/YYYY" (the app's own format).
  const date = parseRaceDate(raw);
  if (!date) {
    const created = race.createdAt ? Date.parse(race.createdAt) : NaN;
    return Number.isFinite(created) ? created : null;
  }
  const minutes = [race.time, ...categories.map((c) => c.startTime)]
    .map((t) => HHMM.exec(String(t ?? "").trim()))
    .filter((m): m is RegExpExecArray => !!m && Number(m[1]) < 24 && Number(m[2]) < 60)
    .map((m) => Number(m[1]) * 60 + Number(m[2]));
  const earliest = minutes.length ? Math.min(...minutes) : 0;
  return zonedTime(Number(date[0]), Number(date[1]), Number(date[2]), Math.floor(earliest / 60), earliest % 60, tz);
}

/** Parse a race date ("YYYY-MM-DD" or "DD/MM/YYYY") into [y, m, d] strings, or null. */
function parseRaceDate(raw: string | null | undefined): [string, string, string] | null {
  const t = String(raw ?? "").trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(t);
  return iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
}

/** End of the LIVE window (epoch ms): 24 h after the scheduled start, or the end of `endDate` when later. 0 = unknown. */
export function liveWindowEndsAt(race: RaceLike, categories: CategoryLike[] = [], tz = RACE_TIME_ZONE): number {
  const start = scheduledStartMs(race, categories, tz);
  if (start === null) return 0;
  let end = start + GUEST_POLL_WINDOW_MS;
  const last = parseRaceDate(race.endDate);
  if (last) end = Math.max(end, zonedTime(Number(last[0]), Number(last[1]), Number(last[2]), 0, 0, tz) + GUEST_POLL_WINDOW_MS);
  return end;
}

/** When guest polling closes (epoch ms): finished races are closed already (returns 0). */
export function guestPollingEndsAt(race: RaceLike, categories: CategoryLike[] = []): number {
  if (race.status === "finished") return 0;
  return liveWindowEndsAt(race, categories);
}

export const guestPollingOpen = (race: RaceLike, categories: CategoryLike[], now: number): boolean =>
  now < guestPollingEndsAt(race, categories);

/** The LIVE window of an unfinished race has run out. */
export const liveWindowExpired = (race: RaceLike, categories: CategoryLike[], now: number): boolean =>
  race.status !== "finished" && liveWindowEndsAt(race, categories) > 0 && now >= liveWindowEndsAt(race, categories);

/**
 * Waves (by `heat`) that still have a running category after the LIVE window expired — for the
 * organizer's warning. Nothing is finished automatically.
 */
export function unfinishedAfterWindow<C extends CategoryLike & { heat?: number | null }>(race: RaceLike, categories: C[], now: number): (number | null)[] {
  if (!liveWindowExpired(race, categories, now)) return [];
  return [...new Set(categories.filter((c) => c.status === "running").map((c) => c.heat ?? null))].sort((a, b) => (a ?? 1e9) - (b ?? 1e9));
}
