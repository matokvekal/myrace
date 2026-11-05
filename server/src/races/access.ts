/**
 * Who may do what in a race, read fresh from race_members on every request
 * (AD-20). A non-member and an unknown race get the same 404.
 */
import type { Db } from "../db/pool.js";
import { ApiError } from "../lib/core.js";
import {
  SCREENS,
  effectiveAccess,
  type EffectiveAccess,
  type MemberPermissions,
  type Operation,
  type Screen,
} from "../../../src/shared/race/access.js";
import type { MemberRole } from "../../../src/shared/race/roles.js";

export interface Membership {
  raceUuid: string;
  userId: string;
  isOwner: boolean;
  /** The race's original creator (011) — the only one who may delete it. Unknown creator (legacy) → the owner. */
  isCreator: boolean;
  /** The owner let members change race data in this race (011, per race). */
  memberWrites: boolean;
  roles: MemberRole[];
  permissions: MemberPermissions;
  revoked: boolean;
  access: EffectiveAccess;
}

export const raceNotFound = () => new ApiError(404, "not_member", "You're not a member of this race");
/** A soft-deleted race, answered to its owner and members so their devices remove their copy. */
export const raceDeleted = () => new ApiError(410, "race_deleted", "This race was deleted by its owner");

/** The user's membership in the race, or null (also null when the race does not exist). */
export async function loadMembership(d: Db, raceUuid: string, userId: string): Promise<Membership | null> {
  if (!/^[0-9a-f-]{36}$/i.test(raceUuid)) return null;
  const row = await d.one<{ ownerUserId: string; createdByUserId: string | null; memberWrites: boolean; roles: MemberRole[] | null; permissions: MemberPermissions | null; revokedAt: Date | null; deletedAt: Date | null }>(
    `SELECT r."ownerUserId", r."createdByUserId", r."memberWrites", m.roles, m.permissions, m."revokedAt", r."deletedAt"
     FROM races r LEFT JOIN race_members m ON m."raceUuid" = r.uuid AND m."userId" = $2
     WHERE r.uuid = $1`,
    [raceUuid, userId],
  );
  if (!row) return null;
  const isOwner = row.ownerUserId === userId;
  if (!isOwner && row.roles === null) return null;
  // Soft-deleted (migration 010): nothing is served or accepted any more, and the 410 tells
  // the owner's and members' devices to remove their copy — an offline device can't bring it back.
  if (row.deletedAt) throw raceDeleted();
  const revoked = !isOwner && row.revokedAt !== null;
  const roles = row.roles ?? [];
  const permissions = row.permissions ?? {};
  return {
    raceUuid,
    userId,
    isOwner,
    isCreator: isCreatorOf(row, userId),
    memberWrites: row.memberWrites,
    roles,
    permissions,
    revoked,
    access: revoked ? noAccess() : phaseAccess(effectiveAccess({ isOwner, roles, permissions }), isOwner, row.memberWrites),
  };
}

/** The original creator; a legacy race whose creator is unknown falls back to its current owner. */
export const isCreatorOf = (race: { ownerUserId: string; createdByUserId: string | null }, userId: string): boolean =>
  (race.createdByUserId ?? race.ownerUserId) === userId;

/**
 * Members write only in races whose owner switched member writes on (per race, 011);
 * otherwise a member who is not the owner may view what their role shows, never write.
 * COMMISSAIRE_MEMBER_WRITES=1 (tests only) turns member writes on everywhere.
 */
function phaseAccess(a: EffectiveAccess, isOwner: boolean, memberWrites: boolean): EffectiveAccess {
  if (isOwner || memberWrites || !WRITES_OWNER_ONLY()) return a;
  const screens = Object.fromEntries(
    SCREENS.map((s) => [s, { view: a.screens[s].view, create: false, update: false, delete: false }]),
  ) as EffectiveAccess["screens"];
  return { ...a, screens };
}

export const noAccess = (): EffectiveAccess => ({
  isOwner: false,
  screens: Object.fromEntries(SCREENS.map((s) => [s, { view: false, create: false, update: false, delete: false }])) as EffectiveAccess["screens"],
  waves: null,
  categories: null,
});

export const canSeeAnything = (a: EffectiveAccess) => SCREENS.some((s) => a.screens[s].view);

/** Requires an active membership that can see something (or a given screen/operation). */
export async function requireMember(d: Db, raceUuid: string, userId: string, need?: [Screen, Operation]): Promise<Membership> {
  const m = await loadMembership(d, raceUuid, userId);
  if (!m || m.revoked || !canSeeAnything(m.access)) throw raceNotFound();
  if (need && !m.access.screens[need[0]][need[1]]) throw new ApiError(403, "forbidden", "Your role in this race does not allow this");
  return m;
}

/**
 * Current phase (Race Access Rules): ONLY the race owner changes a race. Members
 * keep read access; roles that write (start, counter, check-in, admin members) are
 * future scope. COMMISSAIRE_MEMBER_WRITES=1 restores role-based member writes
 * (the multi-user tests use it); unset in production.
 */
export const WRITES_OWNER_ONLY = () => process.env.COMMISSAIRE_MEMBER_WRITES !== "1";

/** Requires a membership allowed to change race data (the owner in this phase). */
export async function requireWriter(d: Db, raceUuid: string, userId: string): Promise<Membership> {
  const m = await requireMember(d, raceUuid, userId);
  if (WRITES_OWNER_ONLY()) requireOwner(m);
  return m;
}

export function requireOwner(m: Membership): void {
  if (!m.isOwner) throw new ApiError(403, "forbidden", "Only the race owner can do this");
}

/** A summary the app uses to show and hide screens. */
export const accessSummary = (m: Membership) => ({
  isOwner: m.isOwner,
  isCreator: m.isCreator,
  memberWrites: m.memberWrites,
  roles: m.roles,
  permissions: m.permissions,
  screens: m.access.screens,
  waves: m.access.waves,
  categories: m.access.categories,
});
