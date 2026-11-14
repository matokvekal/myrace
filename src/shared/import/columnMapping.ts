/**
 * Phase 2 — shared column-mapping dictionary (no AI): what organizers confirmed a
 * start-list column header means. Used by the server (storage, aggregation) and the app.
 *
 * Safety rules:
 *  - A user's own confirmed mapping applies to that user (on every device).
 *  - Other organizers' mappings are only SUGGESTIONS that must be confirmed, and only
 *    when they agree; a contested header gives no suggestion at all. One user can never
 *    silently change how a column is read for everybody.
 *  - Identity-document columns (national ID / passport) are never stored.
 */

export const MAPPABLE_FIELDS = [
  "bibNumber", "firstName", "middleName", "lastName", "fullName", "firstNameEnglish", "lastNameEnglish",
  "category", "team", "gender", "heat", "startTime", "totalLaps", "position", "standing", "raceDay",
  "points", "uciPoints", "federation", "uciNumber", "bibColor", "bibTextColor", "birthDate",
  "federationNumber", "federationChip", "roadNumber", "chip", "notes",
] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];
const FIELD_SET: ReadonlySet<string> = new Set(MAPPABLE_FIELDS);
export const isMappableField = (f: unknown): f is MappableField => typeof f === "string" && FIELD_SET.has(f);

export const MAX_HEADER_LENGTH = 100;

/**
 * One spelling per header: "מס׳ רוכב", "מס' רוכב", "מס רוכב " and "מס. רוכב" are the
 * same column; "Rider  Number:" = "rider number". Hebrew points (niqqud) and the
 * geresh / gershayim are dropped, punctuation becomes a space, case and width are folded.
 */
export function normalizeHeader(header: string): string {
  return String(header ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "") // niqqud and cantillation
    .replace(/[׳״'"`´‘’“”]/g, "") // geresh, gershayim, quotes
    .replace(/[.,:;!?()[\]{}*#_\-/\\|+=<>~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_HEADER_LENGTH);
}

/** National ID / passport columns: never stored, never suggested (PRD FR-45). */
export function isIdentityHeader(header: string): boolean {
  const h = normalizeHeader(header);
  return /(^|\s)(ת ?ז|תז|תעודת זהות|מספר זהות|דרכון|passport|national id|id number|id no|teudat zehut)($|\s)/.test(h) || h === "id";
}

/** Who confirmed what for one header (distinct users per field). */
export interface HeaderVotes {
  /** The field the asking user confirmed (their latest), if any. */
  mine: MappableField | null;
  /** Other users, per field. */
  others: Partial<Record<MappableField, number>>;
}

export interface SharedMappingView {
  header: string;
  mine: MappableField | null;
  /** Other organizers agree on this field: offer it, to be confirmed. */
  suggestion: { field: MappableField; users: number } | null;
  /** Other organizers disagree: suggest nothing. */
  conflict: boolean;
}

/** A suggestion needs this many distinct other organizers… */
export const MIN_SUGGESTION_USERS = 2;
/** …and, when contested, this many times the votes of the runner-up. */
export const DOMINANCE = 3;

export function resolveHeaderVotes(header: string, votes: HeaderVotes): SharedMappingView {
  const ranked = (Object.entries(votes.others) as [MappableField, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [top, second] = ranked;
  let suggestion: SharedMappingView["suggestion"] = null;
  let conflict = false;
  if (top) {
    if (second && top[1] < second[1] * DOMINANCE) conflict = true;
    else if (top[1] >= MIN_SUGGESTION_USERS) suggestion = { field: top[0], users: top[1] };
  }
  return { header, mine: votes.mine, suggestion, conflict };
}
