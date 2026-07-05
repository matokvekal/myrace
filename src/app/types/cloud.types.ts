/**
 * Cloud types — per-race roles, permissions, sync events.
 *
 * This is the NEW per-race cloud system (Supabase).
 * The older token-based types in rbac.types.ts are legacy and untouched.
 */

// ============================================================================
// Roles & Permissions (Part 1)
// ============================================================================

export type RaceRole =
   | "CREATOR"
   | "ADMIN"
   | "MANAGER"
   | "RIDER_MANAGER"
   | "CHECKIN"
   | "FINISH_JUDGE"
   | "VIEWER";

export type Permission =
   | "VIEW_RACE"
   | "EDIT_RACE"
   | "DELETE_RACE"
   | "MANAGE_USERS"
   | "ADD_RIDER"
   | "EDIT_RIDER"
   | "DELETE_RIDER"
   | "CHECKIN_RIDER"
   | "MARK_LAP"
   | "MARK_DNF"
   | "MARK_DNS"
   | "UNDO_EVENT"
   | "EXPORT_RESULTS";

// ============================================================================
// Cloud user / race membership (Part 2)
// ============================================================================

export interface CloudUser {
   id: string; // Supabase auth.users id (uuid)
   email: string;
   displayName?: string | null;
}

/** Row of race_users — who can access a cloud race and with which role */
export interface RaceUserEntry {
   id: string;
   raceId: string; // cloud race id (uuid)
   userId: string | null; // null until the invited email logs in
   email: string;
   role: RaceRole;
   createdBy?: string | null;
   createdAt?: string;
}

/** Link between a local race (uuid in IDB) and its cloud row */
export interface CloudRaceLink {
   localId: string; // RaceProps.uuid
   cloudId: string; // races.id in Supabase
   myRole: RaceRole;
   lastSyncedAt?: string;
}

// ============================================================================
// Race events & sync (Part 3)
// ============================================================================

export type RaceEventType =
   | "LAP_MARKED"
   | "RIDER_CHECKIN"
   | "DNF"
   | "DNS"
   | "UNDO"
   | "RIDER_EDITED";

export type SyncStatus =
   | "local" // never meant to sync (race not in cloud)
   | "pending" // waiting to be pushed
   | "synced" // accepted by server
   | "rejected" // server refused (e.g. duplicate lap)
   | "conflict"; // needs manual resolution

export interface RaceEvent {
   id: string; // crypto.randomUUID()
   raceId: string; // LOCAL race uuid (mapped to cloud id at push time)
   riderId: number; // local RiderProps.id
   bibNumber: number;
   eventType: RaceEventType;
   lapNumber: number | null;
   eventTime: string; // ISO timestamp
   userId: string | null; // cloud user id if logged in
   deviceId: string;
   syncStatus: SyncStatus;
   payload?: Record<string, unknown>; // extra data (e.g. edited fields)
   createdAt: string;
}

export type CloudSyncState = "offline" | "idle" | "syncing" | "error";
