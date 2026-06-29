import { useAuthStore } from '@/stores/authStore';
import type { User, PermissionString } from '@/types/rbac.types';

export const useAuth = () => {
   const {
      currentUser,
      token,
      isAuthenticated,
      permissions,
      viewMode,
      login,
      logout,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
      setViewMode,
      checkTokenExpiry
   } = useAuthStore();

   return {
      user: currentUser as User | null,
      token,
      isAuthenticated,
      permissions,
      viewMode,
      login,
      logout,
      hasPermission: (permission: PermissionString) => hasPermission(permission),
      hasAnyPermission: (perms: PermissionString[]) => hasAnyPermission(perms),
      hasAllPermissions: (perms: PermissionString[]) => hasAllPermissions(perms),
      setViewMode,
      checkTokenExpiry
   };
};
