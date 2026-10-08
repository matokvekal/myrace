/**
 * Signing primitives shared by the Excel export and the "Finish Race"
 * finalization record.
 *
 * DELIBERATELY xlsx-free. `raceExport`/`raceImport` pull in ~430 kB of SheetJS
 * and are only ever reached through a dynamic `import()` (BUGS.md #1). The
 * finalize flow needs the same hashing but runs from eagerly-loaded code, so
 * the primitives live here and `raceExport` imports them — never the reverse.
 *
 * This is tamper-EVIDENCE, not tamper-proofing: there is no secret key, so
 * anyone with the app can re-sign a file they rebuilt from scratch. What it
 * does buy is that an ordinary edit — retyping a placing in Excel, flipping a
 * DNF, bumping a lap count — no longer matches the stored token, and the
 * Verify button says so.
 */

import type { RaceProps, RiderProps, RaceFinalization } from "@/types/types";

/** Version tag of the export signature format. Bump only on a breaking payload change. */
export const EXPORT_SIGNATURE_VERSION = "commissaire-race-export/v1";

/** Version tag of the finalization record format. */
export const FINALIZE_SIGNATURE_VERSION = "commissaire-race-final/v1";

export interface ExportSignature {
  algo: "SHA-256";
  version: string;
  /** Who produced the file — the logged-in user, or "anonymous" for a local export. */
  exportedBy: string;
  exportedAt: string;
  nonce: string;
  /** The exact string that was hashed. Stored so the file verifies standalone. */
  payload: string;
  /** Lowercase hex SHA-256 of `payload`. */
  token: string;
}

/**
 * One line per rider, in a fixed field order and sorted by id, so the digest is
 * reproducible from the Riders sheet alone. Any edit to a bib, lap count, status
 * or finish time changes this string and therefore breaks the token.
 */
export function riderResultsDigest(riders: RiderProps[]): string {
  return [...riders]
    .sort((a, b) => a.id - b.id)
    .map((r) =>
      [
        r.id,
        r.bibNumber,
        r.lapsCounter ?? 0,
        r.status ?? "",
        r.raceStatus ?? "",
        r.position_category ?? 0,
        r.elapsedTimeFromStart ?? "",
      ].join(":")
    )
    .join(";");
}

/** The canonical string that gets hashed. Order and separators are part of the format. */
export function buildSignaturePayload(args: {
  raceUuid: string;
  categoryCount: number;
  riderCount: number;
  exportedBy: string;
  exportedAt: string;
  nonce: string;
  ridersDigest: string;
}): string {
  return [
    EXPORT_SIGNATURE_VERSION,
    `race=${args.raceUuid}`,
    `cats=${args.categoryCount}`,
    `riders=${args.riderCount}`,
    `by=${args.exportedBy}`,
    `at=${args.exportedAt}`,
    `nonce=${args.nonce}`,
    `data=${args.ridersDigest}`,
  ].join("\n");
}

export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Only happens on an insecure origin (plain http, non-localhost). Signing is
    // the whole point of the file, so fail loudly rather than ship an unsigned one.
    throw new Error(
      "Web Crypto is unavailable — signing needs a secure context (https or localhost)."
    );
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Recompute the token from a payload and compare — used to verify a received file. */
export async function verifyExportToken(payload: string, token: string): Promise<boolean> {
  return (await sha256Hex(payload)) === token.toLowerCase();
}

// ── Finalization record ─────────────────────────────────────────────────────

/** Canonical string hashed into `RaceFinalization.token`. */
export function buildFinalizationPayload(args: {
  raceUuid: string;
  raceName: string;
  raceDate: string;
  categoryCount: number;
  riderCount: number;
  by: string;
  at: string;
  nonce: string;
  ridersDigest: string;
}): string {
  return [
    FINALIZE_SIGNATURE_VERSION,
    `race=${args.raceUuid}`,
    `name=${args.raceName}`,
    `date=${args.raceDate}`,
    `cats=${args.categoryCount}`,
    `riders=${args.riderCount}`,
    `by=${args.by}`,
    `at=${args.at}`,
    `nonce=${args.nonce}`,
    `data=${args.ridersDigest}`,
  ].join("\n");
}

/**
 * Sign the FINAL rider set. Call with the riders as they will be stored, after
 * positions and times are computed — signing the pre-finalize state would mean
 * the token never matches the results anyone actually reads.
 */
export async function signRaceFinalization(args: {
  race: Pick<RaceProps, "uuid" | "name" | "date">;
  categoryCount: number;
  riders: RiderProps[];
  by: string;
  /** Injectable for tests; defaults to now. */
  at?: string;
}): Promise<RaceFinalization> {
  const at = args.at ?? new Date().toISOString();
  const nonce = randomNonce();
  const payload = buildFinalizationPayload({
    raceUuid: args.race.uuid,
    raceName: args.race.name ?? "",
    raceDate: args.race.date ?? "",
    categoryCount: args.categoryCount,
    riderCount: args.riders.length,
    by: args.by,
    at,
    nonce,
    ridersDigest: riderResultsDigest(args.riders),
  });
  return {
    version: FINALIZE_SIGNATURE_VERSION,
    algo: "SHA-256",
    at,
    by: args.by,
    nonce,
    payload,
    token: await sha256Hex(payload),
    riderCount: args.riders.length,
    categoryCount: args.categoryCount,
  };
}

export type FinalizationCheck =
  /** Token matches its payload and the local riders still hash to it. */
  | "valid"
  /** Token is authentic but the stored riders no longer match — data was altered. */
  | "results-modified"
  /** Token does not match its own payload — the record itself was edited. */
  | "invalid";

/**
 * Re-verify a finalization record against the riders currently in the store.
 * Used by the Info tab's certificate panel, so a race that was tampered with
 * out-of-band (dev tools, a hand-edited import) reads as broken rather than
 * quietly presenting itself as official.
 */
export async function verifyRaceFinalization(
  finalized: RaceFinalization,
  riders: RiderProps[]
): Promise<FinalizationCheck> {
  if (!(await verifyExportToken(finalized.payload, finalized.token))) return "invalid";
  return finalized.payload.includes(`data=${riderResultsDigest(riders)}`)
    ? "valid"
    : "results-modified";
}

/** Short, human-quotable form of the token for the certificate UI. */
export function shortToken(token: string): string {
  return token.slice(0, 8).toUpperCase();
}
