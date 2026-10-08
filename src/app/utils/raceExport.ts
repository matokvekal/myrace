import * as XLSX from "xlsx";
import type { RaceProps, CategoryProps, RiderProps } from "@/types/types";
// The hashing primitives live in an xlsx-free module so the finalize flow can
// use them without dragging SheetJS into the main chunk (BUGS.md #1).
import {
  EXPORT_SIGNATURE_VERSION,
  buildSignaturePayload,
  randomNonce,
  riderResultsDigest,
  sha256Hex,
  verifyExportToken,
  type ExportSignature,
} from "./raceSignature";

// Re-exported for the existing importers of this module.
export {
  EXPORT_SIGNATURE_VERSION,
  buildSignaturePayload,
  riderResultsDigest,
  verifyExportToken,
};
export type { ExportSignature };
import { getRaceTracks } from "@/utils/raceTracks";

function safeStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export type VerificationStatus =
  /** Token matches and the rider rows still hash to the signed digest. */
  | "valid"
  /** Token matches its payload, but the Riders sheet no longer matches it. */
  | "results-modified"
  /** Token does not match its own payload — the signature block was edited. */
  | "invalid"
  /** No Signature sheet — an older export, or not one of ours. */
  | "unsigned";

export interface VerificationResult {
  status: VerificationStatus;
  message: string;
  exportedBy?: string;
  exportedAt?: string;
  /** Present when the file came from a FINALIZED race — who closed it and when. */
  finalizedBy?: string;
  finalizedAt?: string;
}

/**
 * Verify an exported workbook against its own Signature sheet (BUGS.md #28).
 * Uses the same format `exportRaceToXlsx` writes — there is no second scheme.
 */
export async function verifyRaceWorkbook(wb: XLSX.WorkBook): Promise<VerificationResult> {
  const sheet = wb.Sheets["Signature"];
  if (!sheet) {
    return {
      status: "unsigned",
      message:
        "This file has no signature sheet. It was either exported before signing existed, or it did not come from Commissaire.",
    };
  }

  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const field: Record<string, string> = {};
  rows.slice(1).forEach((r) => { if (r[0]) field[String(r[0])] = String(r[1] ?? ""); });

  const { payload, token, exportedBy, exportedAt, finalizedBy, finalizedAt } = field;
  // Provenance carried on every outcome, so even a failed check tells you where
  // the file came from and whether it claims to be an official final result.
  const meta = {
    exportedBy,
    exportedAt,
    finalizedBy: finalizedBy || undefined,
    finalizedAt: finalizedAt || undefined,
  };
  if (!payload || !token) {
    return {
      status: "invalid",
      message: "The signature sheet is incomplete — the file cannot be verified.",
      ...meta,
    };
  }

  if (!(await verifyExportToken(payload, token))) {
    return {
      status: "invalid",
      message:
        "The signature does not match its own contents. The signature block has been altered.",
      ...meta,
    };
  }

  // The token is intact — now check the results still hash to what was signed.
  const ridersSheet = wb.Sheets["Riders"];
  if (!ridersSheet) {
    return {
      status: "results-modified",
      message: "The signature is intact, but the Riders sheet is missing.",
      ...meta,
    };
  }

  const riderRows = XLSX.utils.sheet_to_json<Record<string, string>>(ridersSheet, {
    defval: "",
    raw: false,
  });
  const digest = riderRows
    .map((r) => ({
      id: Number(r.id),
      line: [
        r.id,
        r.bibNumber,
        r.lapsCounter === "" ? 0 : r.lapsCounter,
        r.status,
        r.raceStatus,
        r.position_category === "" ? 0 : r.position_category,
        r.elapsedTimeFromStart,
      ].join(":"),
    }))
    .sort((a, b) => a.id - b.id)
    .map((r) => r.line)
    .join(";");

  if (!payload.includes(`data=${digest}`)) {
    return {
      status: "results-modified",
      message:
        "The signature is authentic, but the race results in this file have been changed since it was exported.",
      ...meta,
    };
  }

  return {
    status: "valid",
    message: finalizedBy
      ? "Signature valid — these are the official final results, exactly as exported."
      : "Signature valid — the results are exactly as exported.",
    ...meta,
  };
}

export async function exportRaceToXlsx(
  race: RaceProps,
  categories: CategoryProps[],
  riders: RiderProps[],
  filenameSuffix?: string,
  /** Identity stamped into the signature — email/id of the logged-in user. */
  exportedBy: string = "anonymous"
): Promise<ExportSignature> {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Race metadata ──────────────────────────────────────
  const raceRows = [
    ["Field", "Value"],
    ["uuid", race.uuid],
    ["id", race.id],
    ["name", race.name ?? ""],
    ["date", race.date ?? ""],
    ["time", race.time ?? ""],
    ["location", race.location ?? ""],
    ["distance", race.distance ?? ""],
    ["type", race.type ?? ""],
    ["level", race.level ?? ""],
    ["orgenizer", race.orgenizer ?? ""],
    ["manager", race.manager ?? ""],
    ["phone", race.phone ?? ""],
    ["site", race.site ?? ""],
    ["takanon", race.takanon ?? ""],
    ["status", race.status ?? "upcoming"],
    ["owner", race.owner ?? ""],
    // Whole finalization record, verbatim. An importer reads this back so a
    // finalized race stays finalized on whoever's device opens it next.
    ["finalized", race.finalized ? JSON.stringify(race.finalized) : ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(raceRows), "Race");

  // ── Sheet 2: Categories ─────────────────────────────────────────
  const catHeaders = [
    "id", "raceUuid", "name", "subCategory", "color", "laps", "heat",
    "startTime", "status", "linkedFinish", "finishedAt", "lapsCounter", "riders",
    "importOrder"
  ];
  const catData = [catHeaders, ...categories.map((c) => catHeaders.map((h) => safeStr(c[h as keyof CategoryProps])))];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(catData), "Categories");

  // ── Sheet 3: Riders ─────────────────────────────────────────────
  const riderHeaders = [
    "id", "raceUuid", "bibNumber", "firstName", "middleName", "lastName",
    "category", "subCategory", "team", "heat", "color", "chipNumber",
    "federation", "points", "flag",
    "totalLaps", "lapsCounter", "lapsDetails",
    "status", "raceStatus", "checked",
    "timeStartRace", "timeArrive",
    "elapsedLastLap", "elapsedTimeFromStart",
    "position_start", "position_category", "position_race",
    "distance", "viewOrder", "comment",
    // Start-list data — without these a rider handed to another device loses
    // their seeding and the reference columns shown on the rider card.
    "standing", "uciPoints", "uciNumber", "extraFields"
  ];
  const riderData = [
    riderHeaders,
    ...riders.map((r) =>
      riderHeaders.map((h) => {
        if (h === "lapsDetails") return JSON.stringify(r.lapsDetails ?? []);
        return safeStr(r[h as keyof RiderProps]);
      })
    )
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riderData), "Riders");

  // ── Sheets: Tracks + TrackPoints (course maps) ───────────────────────
  // One row per point, not one JSON cell: a GPS route easily exceeds Excel's
  // 32,767-character cell limit. Only written when the race has maps.
  const tracks = getRaceTracks(race);
  if (tracks.length > 0) {
    const trackRows = [
      ["id", "title", "header", "color", "centerLat", "centerLng", "zoom", "categories"],
      ...tracks.map((t) => [
        t.id, t.title, t.header ?? "", t.color,
        t.center?.lat ?? "", t.center?.lng ?? "", t.zoom ?? "",
        JSON.stringify(t.categoryKeys ?? []),
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(trackRows), "Tracks");

    const pointRows: (string | number)[][] = [["trackId", "kind", "seq", "lat", "lng", "label", "type"]];
    for (const t of tracks) {
      t.points.forEach(([lat, lng], i) => pointRows.push([t.id, "route", i, lat, lng, "", ""]));
      t.markers.forEach((m, i) => pointRows.push([t.id, "marker", i, m.lat, m.lng, m.label, m.type ?? "point"]));
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pointRows), "TrackPoints");
  }

  // ── Sheet 4: Signature ──────────────────────────────────────────
  // Provenance + tamper-evidence: the token is a SHA-256 over the exporting
  // user, the timestamp, a nonce, and a digest of every rider's result. Editing
  // a placing or a lap count in the Riders sheet no longer matches the token.
  const exportedAt = new Date().toISOString();
  const nonce = randomNonce();
  const payload = buildSignaturePayload({
    raceUuid: race.uuid,
    categoryCount: categories.length,
    riderCount: riders.length,
    exportedBy,
    exportedAt,
    nonce,
    ridersDigest: riderResultsDigest(riders),
  });
  const token = await sha256Hex(payload);
  const signature: ExportSignature = {
    algo: "SHA-256",
    version: EXPORT_SIGNATURE_VERSION,
    exportedBy,
    exportedAt,
    nonce,
    payload,
    token,
  };
  const sigRows = [
    ["Field", "Value"],
    ["version", signature.version],
    ["algo", signature.algo],
    ["exportedBy", signature.exportedBy],
    ["exportedAt", signature.exportedAt],
    ["nonce", signature.nonce],
    ["token", signature.token],
    ["payload", signature.payload],
    // Finalization provenance is separate from the export signature: the export
    // token says "this file is unedited since download", the finalize token says
    // "this race was officially closed by X at Y". Verify surfaces both.
    ["finalizedBy", race.finalized?.by ?? ""],
    ["finalizedAt", race.finalized?.at ?? ""],
    ["finalizeToken", race.finalized?.token ?? ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sigRows), "Signature");

  // ── Download ────────────────────────────────────────────────────
  const safeName = (race.name ?? "race").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
  const date = race.date ? race.date.replace(/-/g, "") : new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = filenameSuffix ? `_${filenameSuffix}` : "";
  XLSX.writeFile(wb, `${safeName}_${date}${suffix}.xlsx`);

  return signature;
}
