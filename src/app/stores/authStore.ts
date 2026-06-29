/**
 * Authentication Store
 *
 * Manages authentication state, user permissions, and view modes.
 * Uses Zustand for state management.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
   AuthState,
   User,
   PermissionString,
   ViewMode,
   TokenPayload
} from '@/types/rbac.types';

/**
 * Decode JWT-like token
 * For now, this is a simple implementation. In production, use a proper JWT library.
 */
const decodeToken = (token: string): TokenPayload | null => {
   try {
      // Simple base64 decode (replace with proper JWT decode in production)
      const parts = token.split('.');
      if (parts.length !== 3) {
         return null;
      }

      const payload = JSON.parse(atob(parts[1]));
      return payload;
   } catch (error) {
      console.error('Failed to decode token:', error);
      return null;
   }
};

/**
 * Check if token is expired
 */
const isTokenExpired = (payload: TokenPayload): boolean => {
   if (!payload.exp) {
      return false; // No expiry = never expires
   }

   const now = Date.now() / 1000; // Convert to seconds
   return now > payload.exp;
};

/**
 * Auth Store
 */
export const useAuthStore = create<AuthState>()(
   persist(
      (set, get) => ({
         // Initial state
         currentUser: null,
         token: null,
         isAuthenticated: false,
         permissions: [],
         viewMode: 'edit',

         /**
          * Login with token
          */
         login: async (token: string): Promise<boolean> => {
            try {
               // Decode token
               const payload = decodeToken(token);

               if (!payload) {
                  console.error('Invalid token format');
                  return false;
               }

               // Check if token is expired
               if (isTokenExpired(payload)) {
                  console.error('Token has expired');
                  return false;
               }

               // Create user object from token payload
               const user: User = {
                  id: payload.userId,
                  name: payload.roleName, // Temporary - should be actual user name
                  email: '', // Temporary - set from payload if available
                  roleId: payload.roleId,
                  token: token,
                  raceUuid: payload.raceUuid,
                  isActive: true,
                  createdAt: new Date(payload.iat * 1000),
                  expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined
               };

               // Set auth state
               set({
                  currentUser: user,
                  token: token,
                  isAuthenticated: true,
                  permissions: payload.permissions || [],
                  viewMode: 'edit' // Default to edit mode
               });

               console.log('Login successful:', {
                  userId: user.id,
                  role: payload.roleName,
                  permissions: payload.permissions?.length || 0
               });

               return true;
            } catch (error) {
               console.error('Login failed:', error);
               return false;
            }
         },

         /**
          * Logout
          */
         logout: () => {
            set({
               currentUser: null,
               token: null,
               isAuthenticated: false,
               permissions: [],
               viewMode: 'edit'
            });

            console.log('Logged out successfully');
         },

         /**
          * Check if user has a specific permission
          */
         hasPermission: (permission: PermissionString): boolean => {
            const state = get();

            // Not authenticated = no permissions
            if (!state.isAuthenticated || !state.currentUser) {
               return false;
            }

            // Admin wildcard = all permissions
            if (state.permissions.includes('*')) {
               return true;
            }

            // Check specific permission
            return state.permissions.includes(permission);
         },

         /**
          * Check if user has ANY of the provided permissions (OR logic)
          */
         hasAnyPermission: (permissions: PermissionString[]): boolean => {
            const state = get();

            // Not authenticated = no permissions
            if (!state.isAuthenticated || !state.currentUser) {
               return false;
            }

            // Admin wildcard = all permissions
            if (state.permissions.includes('*')) {
               return true;
            }

            // Check if user has at least one of the permissions
            return permissions.some(permission => state.permissions.includes(permission));
         },

         /**
          * Check if user has ALL of the provided permissions (AND logic)
          */
         hasAllPermissions: (permissions: PermissionString[]): boolean => {
            const state = get();

            // Not authenticated = no permissions
            if (!state.isAuthenticated || !state.currentUser) {
               return false;
            }

            // Admin wildcard = all permissions
            if (state.permissions.includes('*')) {
               return true;
            }

            // Check if user has all permissions
            return permissions.every(permission => state.permissions.includes(permission));
         },

         /**
          * Set view mode (watch or edit)
          */
         setViewMode: (mode: ViewMode) => {
            set({ viewMode: mode });
            console.log('View mode changed to:', mode);
         },

         /**
          * Check if token is expired
          */
         checkTokenExpiry: (): boolean => {
            const state = get();

            if (!state.token) {
               return true; // No token = expired
            }

            const payload = decodeToken(state.token);

            if (!payload) {
               return true; // Invalid token = expired
            }

            const expired = isTokenExpired(payload);

            if (expired) {
               console.warn('Token has expired, logging out');
               get().logout();
            }

            return expired;
         }
      }),
      {
         name: 'auth-storage', // localStorage key
         partialize: (state) => ({
            // Only persist essential data
            token: state.token,
            viewMode: state.viewMode
         })
      }
   )
);

/**
 * Initialize auth on app load
 * Call this in your main App component
 */
export const initializeAuth = () => {
   const store = useAuthStore.getState();

   if (store.token) {
      // Re-login with stored token
      store.login(store.token).then((success: boolean) => {
         if (!success) {
            console.warn('Stored token is invalid, logging out');
            store.logout();
         }
      });
   }
};

export default useAuthStore;
