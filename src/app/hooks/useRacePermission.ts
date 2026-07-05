/**
 * Per-race permission hook (reactive version of can()).
 *
 * const { can, role, isCloudLinked } = useRacePermission(raceUuid);
 * <button disabled={!can("MARK_LAP")} ... />
 */

import { useCallback } from "react";
import type { Permission, RaceRole } from "@/types/cloud.types";
import { useCloudStore } from "@/stores/cloudStore";
import { roleHasPermission } from "@/services/cloud/permissions";

export function useRacePermission(raceUuid: string): {
   can: (permission: Permission) => boolean;
   role: RaceRole | null;
   isCloudLinked: boolean;
} {
   // subscribing to links/user keeps components in sync with login state
   const link = useCloudStore((s) => s.links[raceUuid] ?? null);
   useCloudStore((s) => s.user);

   const can = useCallback(
      (permission: Permission) => {
         if (!link) return true; // pure local race — full control
         if (link.myRole) return roleHasPermission(link.myRole, permission);
         return permission === "VIEW_RACE";
      },
      [link]
   );

   return { can, role: link?.myRole ?? null, isCloudLinked: Boolean(link) };
}

export default useRacePermission;
