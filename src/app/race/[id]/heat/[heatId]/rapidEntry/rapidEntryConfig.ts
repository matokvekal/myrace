/**
 * Rapid Entry timing — UX EXPERIMENTS, not business rules. Tune freely.
 */

/** A number no bib can become is cleared and logged as invalid after this pause (ms). */
export const INVALID_CLEAR_MS = 500;

/**
 * Optional assist: accept an AMBIGUOUS bib (e.g. "1" while 18/182 exist) after this
 * much inactivity. `null` = off — Enter is required (start conservatively).
 */
export const AMBIGUOUS_ACCEPT_MS: number | null = null;

/** How long the last result stays in the big display once the input is empty (ms). */
export const RESULT_FLASH_MS = 1600;

/** Entries kept in the per-wave history on this device. */
export const HISTORY_LIMIT = 300;

/** Two-step undo: the X turns into "Undo?" for this long (ms). */
export const UNDO_ARM_MS = 3000;
