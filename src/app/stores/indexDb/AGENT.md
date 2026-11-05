# IndexDb Folder Guide

Purpose

- IndexedDB persistence layer: the core helper plus Zustand `PersistStorage`
  adapters for each store (races, riders, categories).

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. indexedDbHelper.ts (db open/version/schema)
4. raceStorageAdapter.ts, riderStorageAdapter.ts, categoryStorageAdapter.ts

Immediate Children Summary

- No child folders.
- Top-level files:
  - indexedDbHelper.ts (largest file — `initIndexedDB()`, db name
    `commissireDb`, object stores: races/riders/categories/roles/users,
    VersionError handling)
  - categoryStorageAdapter.ts, raceStorageAdapter.ts, riderStorageAdapter.ts
    (each a small `PersistStorage` shape: getItem reads `db.getAll(store)` and
    wraps it as `{ state: { <key> } }`; setItem `put`s each record by id inside
    a `readwrite` transaction; removeItem clears the store)

Conventions

- WARNING: the current IDB VersionError handler deletes all data on version
  mismatch (BUG-02, unresolved) — do not extend this handler's blast radius
  further without fixing the underlying data-loss behavior first.
- Every adapter opens its own db handle via `initIndexedDB()` and explicitly
  `db.close()`s when done — keep that pattern rather than sharing a long-lived
  handle across adapters.
- Adapters are thin translation shims only; put actual business logic (sync
  ordering, conflict handling, dedup) in the Zustand store files
  (`../ridersStore.ts` etc.), not here.

When To Update

- IDB schema/version changes (object stores, keyPaths)
- VersionError/migration handling changes
- New store needing its own adapter
