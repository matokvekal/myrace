/**
 * AuditLogService — local, per-race audit trail stored in OPFS
 * (Origin Private File System), one JSON-Lines file per race:
 *   /logs/RACE_<raceCode>.audit.jsonl
 *
 * Isolated on purpose: this is the ONLY place that touches the audit OPFS
 * files. UI components must call `AuditLogService.log(...)` and never write
 * to OPFS directly. Logging is fire-and-forget — a failure here must never
 * break the caller's real action.
 */

import type { RaceProps } from "@/types/types";
import type { AuditLogEntry, AuditPerformedBy } from "@/types/auditLog.types";
import { useCloudStore } from "@/stores/cloudStore";
import { useAuthStore } from "@/stores/authStore";
import versionInfo from "../../version.json";

export interface AuditLogInput {
  race: RaceProps;
  action: string;
  screen: string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  details?: Record<string, unknown>;
  success?: boolean;
}

const LOGS_DIR = "logs";

function isOpfsSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function raceCodeOf(race: RaceProps): string {
  return race.raceId || race.uuid;
}

function fileNameFor(race: RaceProps): string {
  return `RACE_${sanitizeFileSegment(raceCodeOf(race))}.audit.jsonl`;
}

async function getLogFileHandle(
  race: RaceProps,
  create: boolean
): Promise<FileSystemFileHandle | null> {
  if (!isOpfsSupported()) return null;
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(LOGS_DIR, { create });
  return dir.getFileHandle(fileNameFor(race), { create });
}

// Per-race write queue so concurrent log() calls append serially instead of
// racing on the same OPFS file handle.
const writeQueues = new Map<string, Promise<void>>();

function resolvePerformedBy(race: RaceProps): AuditPerformedBy {
  const cloudUser = useCloudStore.getState().user;
  if (cloudUser) {
    const link = useCloudStore.getState().getLink(race.uuid);
    return {
      userId: cloudUser.id,
      userName: cloudUser.displayName || cloudUser.email || "UNKNOWN",
      userRole: link?.myRole ?? null,
      deviceUserId: null,
    };
  }

  const legacyUser = useAuthStore.getState().currentUser;
  if (legacyUser) {
    return {
      userId: legacyUser.id ?? null,
      userName: legacyUser.name || legacyUser.email || "UNKNOWN",
      userRole: legacyUser.roleId ?? null,
      deviceUserId: null,
    };
  }

  return { userId: null, userName: "UNKNOWN", userRole: null, deviceUserId: null };
}

const MAX_DATA_CHARS = 200;

function truncate(value: string, max = MAX_DATA_CHARS): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

/** Single glance-able summary of before/after/details, capped so the log stays a quick read. */
function summarizeData(input: AuditLogInput): string {
  const payload: Record<string, unknown> = {};
  if (input.before !== undefined) payload.before = input.before;
  if (input.after !== undefined) payload.after = input.after;
  if (input.details && Object.keys(input.details).length > 0) payload.details = input.details;
  if (Object.keys(payload).length === 0) return "";
  try {
    return truncate(JSON.stringify(payload));
  } catch {
    return "";
  }
}

function buildEntry(input: AuditLogInput): AuditLogEntry {
  const { race } = input;
  return {
    timestamp: new Date().toISOString(),
    raceId: race.uuid,
    raceCode: raceCodeOf(race),
    raceName: race.name,
    // No creator field exists on RaceProps today — best-effort only, never
    // fabricated. See docs note in AuditLogService's module doc.
    raceCreatedBy: null,
    raceOrigin: race.viewOnly ? "EXTERNAL" : "LOCAL",
    performedBy: resolvePerformedBy(race),
    action: input.action,
    screen: input.screen,
    entityType: input.entityType,
    entityId: input.entityId != null ? String(input.entityId) : null,
    before: input.before ?? null,
    after: input.after ?? null,
    details: input.details ?? {},
    data: summarizeData(input),
    success: input.success ?? true,
    appVersion: import.meta.env.VITE_APP_VERSION || versionInfo.version || "dev",
  };
}

async function appendLine(race: RaceProps, line: string): Promise<void> {
  const handle = await getLogFileHandle(race, true);
  if (!handle) return; // OPFS not supported — silently skip, never throw
  const file = await handle.getFile();
  const writable = await handle.createWritable({ keepExistingData: true });
  await writable.write({ type: "write", position: file.size, data: line });
  await writable.close();
}

function log(input: AuditLogInput): void {
  // This is the commissaire's own audit trail — a downloaded/view-only race
  // is someone else's race being viewed here, not one to keep a local log for.
  if (input.race.viewOnly) return;
  const entry = buildEntry(input);
  const line = JSON.stringify(entry) + "\n";
  const key = input.race.uuid;
  const queued = (writeQueues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => appendLine(input.race, line))
    .catch((err) => {
      // Logging must never break the caller's real action.
      console.warn("AuditLogService: failed to write entry", err);
    });
  writeQueues.set(key, queued);
}

async function readEntries(race: RaceProps): Promise<AuditLogEntry[]> {
  const handle = await getLogFileHandle(race, false).catch(() => null);
  if (!handle) return [];
  const file = await handle.getFile();
  const text = await file.text();
  if (!text) return [];
  const entries: AuditLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as AuditLogEntry);
    } catch {
      // Skip a corrupted line rather than failing the whole read.
    }
  }
  return entries;
}

async function getExportBlob(race: RaceProps): Promise<Blob | null> {
  const handle = await getLogFileHandle(race, false).catch(() => null);
  if (!handle) return null;
  const file = await handle.getFile();
  return file;
}

async function downloadLogFile(race: RaceProps): Promise<boolean> {
  const blob = await getExportBlob(race);
  if (!blob || blob.size === 0) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileNameFor(race);
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export const AuditLogService = {
  log,
  readEntries,
  downloadLogFile,
  isSupported: isOpfsSupported,
};
