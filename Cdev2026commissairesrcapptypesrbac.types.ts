export type PermissionString = string;

export type ViewMode = 'edit' | 'watch';

export interface Role {
   id: string;
   displayName: string;
   description: string;
   permissions: PermissionString[];
   isDefault: boolean;
   createdAt: Date;
   updatedAt: Date;
}

export interface User {
   id: string;
   name: string;
   email: string;
   roleId: string;
   token: string;
   raceUuid?: string;
   isActive: boolean;
   createdAt: Date;
   expiresAt?: Date;
}

export interface TokenPayload {
   userId: string;
   roleId: string;
   roleName: string;
   permissions: PermissionString[];
   raceUuid?: string;
   iat: number;
   exp?: number;
}

export interface AuthState {
   currentUser: User | null;
   token: string | null;
   isAuthenticated: boolean;
   permissions: PermissionString[];
   viewMode: ViewMode;
   login: (token: string) => Promise<boolean>;
   logout: () => void;
   hasPermission: (permission: PermissionString) => boolean;
   hasAnyPermission: (permissions: PermissionString[]) => boolean;
   hasAllPermissions: (permissions: PermissionString[]) => boolean;
   setViewMode: (mode: ViewMode) => void;
   checkTokenExpiry: () => boolean;
}

export interface RBACState {
   roles: Role[];
   users: User[];
   isLoading: boolean;
   error: string | null;
   getRoles: () => Promise<void>;
   getUsers: () => Promise<void>;
   createRole: (roleData: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Role>;
   updateRole: (roleId: string, updates: Partial<Role>) => Promise<void>;
   deleteRole: (roleId: string) => Promise<void>;
   createUser: (userData: Omit<User, 'id' | 'token' | 'createdAt'>) => Promise<User>;
   generateUserToken: (userId: string, roleId: string, expiresIn?: number) => Promise<string>;
   revokeUser: (userId: string) => Promise<void>;
   deleteUser: (userId: string) => Promise<void>;
}

export const DEFAULT_ROLES: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>[] = [
   {
      displayName: 'Admin',
      description: 'Full system access',
      permissions: ['*'],
      isDefault: true
   },
   {
      displayName: 'Commissaire',
      description: 'Race commissaire - can record races',
      permissions: ['race.record', 'race.view', 'rider.view'],
      isDefault: true
   },
   {
      displayName: 'Viewer',
      description: 'Read-only access',
      permissions: ['race.view', 'rider.view'],
      isDefault: true
   }
];
