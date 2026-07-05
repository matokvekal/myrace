/**
 * Per-race permission system.
 *
 * Rule of thumb:
 *  - Race NOT linked to the cloud  -> full local control (app works offline, no login).
 *  - Race linked to the cloud      -> permission comes from my role in race_users.
 *
 * These checks are UX guards only. Real enforcement is Supabase RLS.
 */

import type { CloudUser, Permission, RaceRole } from "@/types/cloud.types";
import { useCloudStore } from "@/stores/cloudStore";

const ALL_PERMISSIONS: Permission[] = [
   "VIEW_RACE",
   "EDIT_RACE",
   "DELETE_RACE",
   "MANAGE_USERS",
   "ADD_RIDER",
   "EDIT_RIDER",
   "DELETE_RIDER",
   "CHECKIN_RIDER",
   "MARK_LAP",
   "MARK_DNF",
   "MARK_DNS",
   "UNDO_EVENT",
   "EXPORT_RESULTS",
];

export const ROLE_PERMISSIONS: Record<RaceRole, Permission[]> = {
   CREATOR: ALL_PERMISSIONS,
   ADMIN: ALL_PERMISSIONS,
   // Everything except delete race + manage users
   MANAGER: ALL_PERMISSIONS.filter(
      (p) => p !== "DELETE_RACE" && p !== "MANAGE_USERS"
   ),
   RIDER_MANAGER: [
      "VIEW_RACE",
      "ADD_RIDER",
      "EDIT_RIDER",
      "DELETE_RIDER",
      "EXPORT_RESULTS",
   ],
   CHECKIN: ["VIEW_RACE", "CHECKIN_RIDER"],
   FINISH_JUDGE: [
      "VIEW_RACE",
      "MARK_LAP",
      "MARK_DNF",
      "MARK_DNS",
      "UNDO_EVENT",
      "EXPORT_RESULTS",
   ],
   VIEWER: ["VIEW_RACE", "EXPORT_RESULTS"],
};

export function roleHasPermission(role: RaceRole, permission: Permission): boolean {
   return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Main permission check. Call before every important action.
 *
 * @param user   current cloud user (null when not logged in)
 * @param raceId LOCAL race uuid (RaceProps.uuid)
 */
export function can(
   user: CloudUser | null,
   raceId: string,
   permission: Permission
): boolean {
   const link = useCloudStore.getState().getLink(raceId);

   // Pure local race — the owner of the device owns the data.
   if (!link) return true;

   // Cloud race: role was cached at link/login time, so this also
   // works offline for a user who already opened the race.
   if (link.myRole) return roleHasPermission(link.myRole, permission);

   // Linked race with unknown role -> read only.
   void user;
   return permission === "VIEW_RACE";
}

/** Convenience wrapper that pulls the current user from the store. */
export function canForRace(raceId: string, permission: Permission): boolean {
   return can(useCloudStore.getState().user, raceId, permission);
}

/** Throwing variant for the service/action layer. */
export function assertCan(raceId: string, permission: Permission): void {
   if (!canForRace(raceId, permission)) {
      throw new Error(`No permission: ${permission}`);
   }
}
