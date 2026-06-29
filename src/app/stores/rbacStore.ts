/**
 * RBAC Store
 *
 * Manages roles and users for admin panel.
 * Handles CRUD operations for roles/users and token generation.
 */

import { create } from 'zustand';
import type { RBACState, Role, User } from '@/types/rbac.types';
import { DEFAULT_ROLES } from '@/types/rbac.types';
import {
   getAllRolesFromDb,
   addRoleToDb,
   updateRoleInDb,
   deleteRoleFromDb,
   getAllUsersFromDb,
   addUserToDb,
   updateUserInDb,
   deleteUserFromDb
} from '@/helpers/indexedDbHelper';

/**
 * RBAC Store
 */
export const useRBACStore = create<RBACState>((set: any, get: any) => ({
   // Initial state
   roles: [],
   users: [],
   isLoading: false,
   error: null,

   /**
    * Get all roles from database
    */
   getRoles: async () => {
      try {
         set({ isLoading: true, error: null });

         // Try to get roles from IndexedDB
         let roles = await getAllRolesFromDb();

         // If no roles exist, seed with default roles
         if (!roles || roles.length === 0) {
            console.log('No roles found, seeding default roles...');

            for (const defaultRole of DEFAULT_ROLES) {
               const role: Role = {
                  ...defaultRole,
                  id: crypto.randomUUID(),
                  createdAt: new Date(),
                  updatedAt: new Date()
               };

               await addRoleToDb(role);
            }

            // Fetch again
            roles = await getAllRolesFromDb();
         }

         set({ roles, isLoading: false });
      } catch (error) {
         console.error('Failed to get roles:', error);
         set({ error: 'Failed to load roles', isLoading: false });
      }
   },

   /**
    * Get all users from database
    */
   getUsers: async () => {
      try {
         set({ isLoading: true, error: null });

         const users = await getAllUsersFromDb();

         set({ users: users || [], isLoading: false });
      } catch (error) {
         console.error('Failed to get users:', error);
         set({ error: 'Failed to load users', isLoading: false });
      }
   },

   /**
    * Create a new role
    */
   createRole: async (roleData: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>) => {
      try {
         set({ isLoading: true, error: null });

         const role: Role = {
            ...roleData,
            id: crypto.randomUUID(),
            createdAt: new Date(),
            updatedAt: new Date()
         };

         await addRoleToDb(role);

         // Update state
         const roles = [...get().roles, role];
         set({ roles, isLoading: false });

         console.log('Role created:', role.displayName);
         return role;
      } catch (error) {
         console.error('Failed to create role:', error);
         set({ error: 'Failed to create role', isLoading: false });
         throw error;
      }
   },

   /**
    * Update an existing role
    */
   updateRole: async (roleId: string, updates: Partial<Role>) => {
      try {
         set({ isLoading: true, error: null });

         const role = get().roles.find((r: Role) => r.id === roleId);

         if (!role) {
            throw new Error('Role not found');
         }

         // Check if it's a default role and prevent critical changes
         if (role.isDefault && updates.isDefault === false) {
            throw new Error('Cannot modify default role status');
         }

         const updatedRole: Role = {
            ...role,
            ...updates,
            updatedAt: new Date()
         };

         await updateRoleInDb(updatedRole);

         // Update state
         const roles = get().roles.map((r: Role) =>
            r.id === roleId ? updatedRole : r
         );
         set({ roles, isLoading: false });

         console.log('Role updated:', updatedRole.displayName);
      } catch (error) {
         console.error('Failed to update role:', error);
         set({ error: 'Failed to update role', isLoading: false });
         throw error;
      }
   },

   /**
    * Delete a role
    */
   deleteRole: async (roleId: string) => {
      try {
         set({ isLoading: true, error: null });

         const role = get().roles.find((r: Role) => r.id === roleId);

         if (!role) {
            throw new Error('Role not found');
         }

         // Prevent deleting default roles
         if (role.isDefault) {
            throw new Error('Cannot delete default roles');
         }

         // Check if any users have this role
         const usersWithRole = get().users.filter((u: User) => u.roleId === roleId);
         if (usersWithRole.length > 0) {
            throw new Error(`Cannot delete role: ${usersWithRole.length} user(s) still assigned`);
         }

         await deleteRoleFromDb(roleId);

         // Update state
         const roles = get().roles.filter((r: Role) => r.id !== roleId);
         set({ roles, isLoading: false });

         console.log('Role deleted:', role.displayName);
      } catch (error) {
         console.error('Failed to delete role:', error);
         set({ error: (error as Error).message || 'Failed to delete role', isLoading: false });
         throw error;
      }
   },

   /**
    * Create a new user/commissaire
    */
   createUser: async (userData: Omit<User, 'id' | 'token' | 'createdAt'>) => {
      try {
         set({ isLoading: true, error: null });

         // Generate token for user
         const token = await get().generateUserToken(
            userData.roleId,
            userData.roleId
         );

         const user: User = {
            ...userData,
            id: crypto.randomUUID(),
            token: token,
            createdAt: new Date()
         };

         await addUserToDb(user);

         // Update state
         const users = [...get().users, user];
         set({ users, isLoading: false });

         console.log('User created:', user.name);
         return user;
      } catch (error) {
         console.error('Failed to create user:', error);
         set({ error: 'Failed to create user', isLoading: false });
         throw error;
      }
   },

   /**
    * Generate authentication token for a user
    */
   generateUserToken: async (userId: string, roleId: string, expiresIn?: number) => {
      try {
         const role = get().roles.find((r: Role) => r.id === roleId);

         if (!role) {
            throw new Error('Role not found');
         }

         // Create token payload
         const iat = Math.floor(Date.now() / 1000); // Issued at (seconds)
         const exp = expiresIn ? iat + Math.floor(expiresIn / 1000) : undefined;

         const payload = {
            userId: userId,
            roleId: role.id,
            roleName: role.displayName,
            permissions: role.permissions,
            iat: iat,
            exp: exp
         };

         // Simple token encoding (in production, use proper JWT signing)
         const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
         const encodedPayload = btoa(JSON.stringify(payload));
         const signature = btoa(crypto.randomUUID()); // Replace with proper HMAC signature

         const token = `${header}.${encodedPayload}.${signature}`;

         console.log('Token generated for role:', role.displayName);
         return token;
      } catch (error) {
         console.error('Failed to generate token:', error);
         throw error;
      }
   },

   /**
    * Revoke user access (mark as inactive)
    */
   revokeUser: async (userId: string) => {
      try {
         set({ isLoading: true, error: null });

         const user = get().users.find((u: User) => u.id === userId);

         if (!user) {
            throw new Error('User not found');
         }

         const updatedUser: User = {
            ...user,
            isActive: false
         };

         await updateUserInDb(updatedUser);

         // Update state
         const users = get().users.map((u: User) =>
            u.id === userId ? updatedUser : u
         );
         set({ users, isLoading: false });

         console.log('User revoked:', user.name);
      } catch (error) {
         console.error('Failed to revoke user:', error);
         set({ error: 'Failed to revoke user', isLoading: false });
         throw error;
      }
   },

   /**
    * Delete a user
    */
   deleteUser: async (userId: string) => {
      try {
         set({ isLoading: true, error: null });

         const user = get().users.find((u: User) => u.id === userId);

         if (!user) {
            throw new Error('User not found');
         }

         await deleteUserFromDb(userId);

         // Update state
         const users = get().users.filter((u: User) => u.id !== userId);
         set({ users, isLoading: false });

         console.log('User deleted:', user.name);
      } catch (error) {
         console.error('Failed to delete user:', error);
         set({ error: 'Failed to delete user', isLoading: false });
         throw error;
      }
   }
}));

/**
 * Initialize RBAC store
 * Call this in admin panel or app initialization
 */
export const initializeRBAC = async () => {
   const store = useRBACStore.getState();
   await store.getRoles();
   await store.getUsers();
};

export default useRBACStore;
