/**
 * IndexedDB Helper for RBAC and Data Persistence
 *
 * Handles all IndexedDB operations for roles, users, races, riders, and categories.
 * Database: commissireDb (v9)
 * Stores: roles, users, races, riders, categories
 */

import type { Role, User } from '@/types/rbac.types';

const DB_NAME = 'commissireDb';
const DB_VERSION = 9;
const ROLES_STORE = 'roles';
const USERS_STORE = 'users';
const RACES_STORE = 'races';
const RIDERS_STORE = 'riders';
const CATEGORIES_STORE = 'categories';

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB connection
 */
export const initializeDb = async (): Promise<any> => {
  if (db) {
    return createDatabaseWrapper(db);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB open failed:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('IndexedDB opened successfully');
      resolve(createDatabaseWrapper(db));
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create roles store if it doesn't exist
      if (!database.objectStoreNames.contains(ROLES_STORE)) {
        const rolesStore = database.createObjectStore(ROLES_STORE, { keyPath: 'id' });
        rolesStore.createIndex('name', 'name', { unique: true });
        rolesStore.createIndex('isDefault', 'isDefault');
        console.log('Created roles store');
      }

      // Create users store if it doesn't exist
      if (!database.objectStoreNames.contains(USERS_STORE)) {
        const usersStore = database.createObjectStore(USERS_STORE, { keyPath: 'id' });
        usersStore.createIndex('roleId', 'roleId');
        usersStore.createIndex('token', 'token', { unique: true });
        usersStore.createIndex('email', 'email');
        console.log('Created users store');
      }

      // Create races store if it doesn't exist
      if (!database.objectStoreNames.contains(RACES_STORE)) {
        database.createObjectStore(RACES_STORE, { keyPath: 'id' });
        console.log('Created races store');
      }

      // Create riders store if it doesn't exist
      if (!database.objectStoreNames.contains(RIDERS_STORE)) {
        database.createObjectStore(RIDERS_STORE, { keyPath: 'id' });
        console.log('Created riders store');
      }

      // Create categories store if it doesn't exist
      if (!database.objectStoreNames.contains(CATEGORIES_STORE)) {
        database.createObjectStore(CATEGORIES_STORE, { keyPath: 'id' });
        console.log('Created categories store');
      }
    };
  });
};

/**
 * Get database connection
 */
const getDb = async (): Promise<IDBDatabase> => {
  if (!db) {
    return initializeDb();
  }
  return db;
};

// ============================================================================
// ROLES OPERATIONS
// ============================================================================

/**
 * Get all roles from database
 */
export const getAllRolesFromDb = async (): Promise<Role[]> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ROLES_STORE], 'readonly');
    const store = transaction.objectStore(ROLES_STORE);
    const request = store.getAll();

    request.onerror = () => {
      console.error('Failed to get all roles:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      const roles = request.result.map(role => ({
        ...role,
        createdAt: new Date(role.createdAt),
        updatedAt: new Date(role.updatedAt)
      }));
      resolve(roles);
    };
  });
};

/**
 * Get a single role by ID
 */
export const getRoleFromDb = async (roleId: string): Promise<Role | undefined> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ROLES_STORE], 'readonly');
    const store = transaction.objectStore(ROLES_STORE);
    const request = store.get(roleId);

    request.onerror = () => {
      console.error('Failed to get role:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      const role = request.result;
      if (role) {
        role.createdAt = new Date(role.createdAt);
        role.updatedAt = new Date(role.updatedAt);
      }
      resolve(role);
    };
  });
};

/**
 * Add a new role
 */
export const addRoleToDb = async (role: Role): Promise<void> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ROLES_STORE], 'readwrite');
    const store = transaction.objectStore(ROLES_STORE);

    const roleData = {
      ...role,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString()
    };

    const request = store.add(roleData);

    request.onerror = () => {
      console.error('Failed to add role:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('Role added to database:', role.displayName);
      resolve();
    };
  });
};

/**
 * Update an existing role
 */
export const updateRoleInDb = async (role: Role): Promise<void> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ROLES_STORE], 'readwrite');
    const store = transaction.objectStore(ROLES_STORE);

    const roleData = {
      ...role,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString()
    };

    const request = store.put(roleData);

    request.onerror = () => {
      console.error('Failed to update role:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('Role updated in database:', role.displayName);
      resolve();
    };
  });
};

/**
 * Delete a role by ID
 */
export const deleteRoleFromDb = async (roleId: string): Promise<void> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ROLES_STORE], 'readwrite');
    const store = transaction.objectStore(ROLES_STORE);
    const request = store.delete(roleId);

    request.onerror = () => {
      console.error('Failed to delete role:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('Role deleted from database');
      resolve();
    };
  });
};

// ============================================================================
// USERS OPERATIONS
// ============================================================================

/**
 * Get all users from database
 */
export const getAllUsersFromDb = async (): Promise<User[]> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([USERS_STORE], 'readonly');
    const store = transaction.objectStore(USERS_STORE);
    const request = store.getAll();

    request.onerror = () => {
      console.error('Failed to get all users:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      const users = request.result.map(user => ({
        ...user,
        createdAt: new Date(user.createdAt),
        expiresAt: user.expiresAt ? new Date(user.expiresAt) : undefined
      }));
      resolve(users);
    };
  });
};

/**
 * Get a single user by ID
 */
export const getUserFromDb = async (userId: string): Promise<User | undefined> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([USERS_STORE], 'readonly');
    const store = transaction.objectStore(USERS_STORE);
    const request = store.get(userId);

    request.onerror = () => {
      console.error('Failed to get user:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      const user = request.result;
      if (user) {
        user.createdAt = new Date(user.createdAt);
        if (user.expiresAt) {
          user.expiresAt = new Date(user.expiresAt);
        }
      }
      resolve(user);
    };
  });
};

/**
 * Get user by token
 */
export const getUserByTokenFromDb = async (token: string): Promise<User | undefined> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([USERS_STORE], 'readonly');
    const store = transaction.objectStore(USERS_STORE);
    const index = store.index('token');
    const request = index.get(token);

    request.onerror = () => {
      console.error('Failed to get user by token:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      const user = request.result;
      if (user) {
        user.createdAt = new Date(user.createdAt);
        if (user.expiresAt) {
          user.expiresAt = new Date(user.expiresAt);
        }
      }
      resolve(user);
    };
  });
};

/**
 * Get users by role ID
 */
export const getUsersByRoleFromDb = async (roleId: string): Promise<User[]> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([USERS_STORE], 'readonly');
    const store = transaction.objectStore(USERS_STORE);
    const index = store.index('roleId');
    const request = index.getAll(roleId);

    request.onerror = () => {
      console.error('Failed to get users by role:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      const users = request.result.map(user => ({
        ...user,
        createdAt: new Date(user.createdAt),
        expiresAt: user.expiresAt ? new Date(user.expiresAt) : undefined
      }));
      resolve(users);
    };
  });
};

/**
 * Add a new user
 */
export const addUserToDb = async (user: User): Promise<void> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([USERS_STORE], 'readwrite');
    const store = transaction.objectStore(USERS_STORE);

    const userData = {
      ...user,
      createdAt: user.createdAt.toISOString(),
      expiresAt: user.expiresAt?.toISOString()
    };

    const request = store.add(userData);

    request.onerror = () => {
      console.error('Failed to add user:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('User added to database:', user.name);
      resolve();
    };
  });
};

/**
 * Update an existing user
 */
export const updateUserInDb = async (user: User): Promise<void> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([USERS_STORE], 'readwrite');
    const store = transaction.objectStore(USERS_STORE);

    const userData = {
      ...user,
      createdAt: user.createdAt.toISOString(),
      expiresAt: user.expiresAt?.toISOString()
    };

    const request = store.put(userData);

    request.onerror = () => {
      console.error('Failed to update user:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('User updated in database:', user.name);
      resolve();
    };
  });
};

/**
 * Delete a user by ID
 */
export const deleteUserFromDb = async (userId: string): Promise<void> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([USERS_STORE], 'readwrite');
    const store = transaction.objectStore(USERS_STORE);
    const request = store.delete(userId);

    request.onerror = () => {
      console.error('Failed to delete user:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('User deleted from database');
      resolve();
    };
  });
};

/**
 * Clear all data from a store (useful for testing)
 */
export const clearStore = async (storeName: string): Promise<void> => {
  const database = await getDb();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onerror = () => {
      console.error(`Failed to clear ${storeName}:`, request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log(`${storeName} cleared`);
      resolve();
    };
  });
};

/**
 * Close database connection
 */
export const closeDb = (): void => {
  if (db) {
    db.close();
    db = null;
    console.log('Database closed');
  }
};

/**
 * Enhanced database wrapper with simplified API
 * Wraps the IDBDatabase to provide getAll, add, delete methods
 */
export const createDatabaseWrapper = (database: IDBDatabase) => {
  return {
    getAll: async (storeName: string) => {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onerror = () => {
          console.error(`Failed to get all from ${storeName}:`, request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          resolve(request.result);
        };
      });
    },

    add: async (storeName: string, value: any) => {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.add(value);

        request.onerror = () => {
          console.error(`Failed to add to ${storeName}:`, request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        transaction.onerror = () => {
          reject(transaction.error);
        };
      });
    },

    delete: async (storeName: string, key: any) => {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);

        request.onerror = () => {
          console.error(`Failed to delete from ${storeName}:`, request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        transaction.onerror = () => {
          reject(transaction.error);
        };
      });
    },

    transaction: (stores: string[], mode: 'readonly' | 'readwrite') => {
      const tx = database.transaction(stores, mode);
      return {
        objectStore: (storeName: string) => tx.objectStore(storeName),
        done: new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
      };
    }
  };
};

// Alias for backward compatibility
export const initIndexedDB = initializeDb;
