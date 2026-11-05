/**
 * Race audit log — local, per-race, append-only event trail (OPFS-backed).
 * Isolated from the existing cloud `raceEvents` sync mechanism on purpose:
 * this is a commissaire-facing audit trail, not a multi-device sync feed.
 */

export type AuditRaceOrigin = "LOCAL" | "EXTERNAL";

export interface AuditPerformedBy {
  userId: string | null;
  userName: string;
  userRole: string | null;
  deviceUserId: string | null;
}

export interface AuditLogEntry {
  timestamp: string; // UTC ISO
  raceId: string; // internal race id (uuid)
  raceCode: string; // visible race code (raceId/uuid fallback)
  raceName: string;
  raceCreatedBy: string | null;
  raceOrigin: AuditRaceOrigin;
  performedBy: AuditPerformedBy;
  action: string;
  screen: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  details: Record<string, unknown>;
  /** Glance-able summary of before/after/details, capped at 200 chars. */
  data: string;
  success: boolean;
  appVersion: string;
}
