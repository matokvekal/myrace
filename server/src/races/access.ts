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
  roles: MemberRole[];
  permissions: MemberPermissions;
  revoked: boolean;
  access: EffectiveAccess;
}

export const raceNotFound = () => new ApiError(404, "not_member", "You're not a member of this race");

/** The user's membership in the race, or null (also null when the race does not exist). */
export async function loadMembership(d: Db, raceUuid: string, userId: string): Promise<Membership | null> {
  if (!/^[0-9a-f-]{36}$/i.test(raceUuid)) return null;
  const row = await d.one<{ ownerUserId: string; roles: MemberRole[] | null; permissions: MemberPermissions | null; revokedAt: Date | null }>(
    `SELECT r."ownerUserId", m.roles, m.permissions, m."revokedAt"
     FROM races r LEFT JOIN race_members m ON m."raceUuid" = r.uuid AND m."userId" = $2
     WHERE r.uuid = $1`,
    [raceUuid, userId],
  );
  if (!row) return null;
  const isOwner = row.ownerUserId === userId;
  if (!isOwner && row.roles === null) return null;
  const revoked = !isOwner && row.revokedAt !== null;
  const roles = row.roles ?? [];
  const permissions = row.permissions ?? {};
  return {
    raceUuid,
    userId,
    isOwner,
    roles,
    permissions,
    revoked,
    access: revoked ? noAccess() : effectiveAccess({ isOwner, roles, permissions }),
  };
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

export function requireOwner(m: Membership): void {
  if (!m.isOwner) throw new ApiError(403, "forbidden", "Only the race owner can do this");
}

/** A summary the app uses to show and hide screens. */
export const accessSummary = (m: Membership) => ({
  isOwner: m.isOwner,
  roles: m.roles,
  permissions: m.permissions,
  screens: m.access.screens,
  waves: m.access.waves,
  categories: m.access.categories,
});
