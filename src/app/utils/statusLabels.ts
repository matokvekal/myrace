/**
 * 0.3.3 — the ONE wording for race / wave status, on every screen (RACE, LIVE, BOARD,
 * RESULTS, My Races, public share). Labels only: status values and transitions are unchanged,
 * and each screen keeps its own colours / stripes / icons.
 *   upcoming → NOT STARTED · standing → STANDING · running → RUNNING · finished → FINISHED
 */
export const STATUS_LABEL = {
  upcoming: "NOT STARTED",
  standing: "STANDING",
  running: "RUNNING",
  finished: "FINISHED",
} as const;

export type LabelledStatus = keyof typeof STATUS_LABEL;

/** Label for a race / wave / category status value; unknown or empty → NOT STARTED. */
export const statusLabel = (s: string | null | undefined): string =>
  STATUS_LABEL[(s ?? "upcoming") as LabelledStatus] ?? STATUS_LABEL.upcoming;
