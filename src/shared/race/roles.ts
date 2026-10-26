/**
 * Roles — PRD FR-10 as data (Architecture AD-10).
 *
 * A member holds any set of the member roles (`race_members.roles`); the owner
 * is the race's `ownerUserId`. What each role may do by default, how an owner or
 * admin overrides it per member, and how Actions are checked is in `access.ts`.
 * Pure TypeScript: no React, IndexedDB, DOM or Node APIs.
 */

/** Roles a race membership can hold. "viewer" is read-only. */
export const MEMBER_ROLES = ["admin", "start", "counter", "checkin", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Every role, including the owner (the race's `ownerUserId`). */
export const ROLES = ["owner", ...MEMBER_ROLES] as const;
export type Role = (typeof ROLES)[number];

export const isMemberRole = (value: unknown): value is MemberRole =>
  typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value);

/**
 * How far an FR-10 grant reaches:
 *  - "all": no restriction.
 *  - "inScope": only riders in the member's scope (Counter, FR-11).
 *  - "startTimesOnly": only start times and wave assignment (Start).
 *  - "raceOperationOnly": only race-operation settings (Start).
 */
export type Grant = "all" | "inScope" | "startTimesOnly" | "raceOperationOnly";

/** The rows of the FR-10 table, in order. */
export const PERMISSIONS = [
  "viewRace",
  "editSetup",
  "editRiders",
  "checkIn",
  "runWaves",
  "recordLaps",
  "correctLapCount",
  "setRaceStatus",
  "raceSettings",
  "manageMembers",
  "finalize",
  "deleteRace",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** FR-10. A role missing from a row has no access to it. */
export const PERMISSION_MATRIX: Readonly<Record<Permission, Readonly<Partial<Record<Role, Grant>>>>> = {
  // See the live race, boards, results
  viewRace: { owner: "all", admin: "all", start: "all", counter: "all", checkin: "all", viewer: "all" },
  // Edit race setup (categories, laps, start times)
  editSetup: { owner: "all", admin: "all", start: "startTimesOnly" },
  // Add/edit riders, bibs, late entries
  editRiders: { owner: "all", admin: "all", checkin: "all" },
  // Check riders in, set DNS before start
  checkIn: { owner: "all", admin: "all", checkin: "all" },
  // Start / finish waves and categories, countdown
  runWaves: { owner: "all", admin: "all", start: "all" },
  // Add Lap, Undo, resolve Jokers
  recordLaps: { owner: "all", admin: "all", counter: "inScope" },
  // Correct a rider's lap count
  correctLapCount: { owner: "all", admin: "all", counter: "inScope" },
  // Set DNF / DSQ during the race
  setRaceStatus: { owner: "all", admin: "all", counter: "inScope" },
  // Race settings (first-finish-all-finish etc.)
  raceSettings: { owner: "all", admin: "all", start: "raceOperationOnly" },
  // Manage members, view the Audit history
  manageMembers: { owner: "all", admin: "all" },
  // Finalize, Amend
  finalize: { owner: "all" },
  // Delete race, transfer ownership
  deleteRace: { owner: "all" },
};

export const grantFor = (role: Role, permission: Permission): Grant | null =>
  PERMISSION_MATRIX[permission][role] ?? null;
