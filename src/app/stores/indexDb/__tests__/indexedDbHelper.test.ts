import { describe, it, expect, vi, afterEach } from "vitest";
import { openDB } from "idb";

/**
 * Story 1.2 — the local database is never deleted as a recovery mechanism.
 *
 * Each test seeds the fake IndexedDB with a database NEWER than the app
 * (version 99) the way a newer deploy would leave it, then calls initIndexedDB()
 * from a freshly imported module (the DB-health flag is module state).
 */

const DB_NAME = "commissireDb";
const ALL_STORES = ["riders", "categories", "races", "roles", "users", "race_events", "live_outbox"];

async function seedNewerDb(stores: string[]) {
  const db = await openDB(DB_NAME, 99, {
    upgrade(d) {
      for (const s of stores) d.createObjectStore(s, { keyPath: "id" });
    },
  });
  if (stores.includes("races")) await db.put("races", { id: 1, uuid: "race-keep", name: "Keep me" });
  if (stores.includes("riders")) await db.put("riders", { id: 7, raceUuid: "race-keep", firstName: "Dana" });
  db.close();
}

async function freshHelper() {
  vi.resetModules();
  return import("../indexedDbHelper");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("idb");
});

describe("initIndexedDB never deletes race data", () => {
  it("creates all stores on a first run (no database yet)", async () => {
    const helper = await freshHelper();
    const db = await helper.initIndexedDB();
    for (const s of ALL_STORES) expect(db.objectStoreNames.contains(s)).toBe(true);
    db.close();
    expect(helper.getDbHealth()).toBe("ok");
  });

  it("opens a newer database that has every store, keeping its data", async () => {
    await seedNewerDb(ALL_STORES);
    const del = vi.spyOn(indexedDB, "deleteDatabase");
    const helper = await freshHelper();

    const db = await helper.initIndexedDB();
    expect(await db.get("races", 1)).toMatchObject({ name: "Keep me" });
    expect(await db.get("riders", 7)).toMatchObject({ firstName: "Dana" });
    db.close();

    expect(del).not.toHaveBeenCalled();
    expect(helper.getDbHealth()).toBe("ok");
  });

  it("opens a newer database missing a store without deleting it, and asks for an update", async () => {
    await seedNewerDb(["riders", "races"]); // no categories / roles / users / race_events
    const del = vi.spyOn(indexedDB, "deleteDatabase");
    const helper = await freshHelper();
    const onChange = vi.fn();
    helper.subscribeDbHealth(onChange);

    const db = await helper.initIndexedDB();
    expect(await db.get("races", 1)).toMatchObject({ name: "Keep me" });
    expect(await db.get("riders", 7)).toMatchObject({ firstName: "Dana" });
    db.close();

    expect(del).not.toHaveBeenCalled();
    expect(helper.getDbHealth()).toBe("needs-update");
    expect(onChange).toHaveBeenCalledTimes(1);

    // Still intact when opened again later.
    const again = await openDB(DB_NAME);
    expect(await again.count("riders")).toBe(1);
    again.close();
  });

  it("does not delete anything when the newer database cannot be opened", async () => {
    await seedNewerDb(ALL_STORES);
    const del = vi.spyOn(indexedDB, "deleteDatabase");
    vi.resetModules();
    vi.doMock("idb", async () => {
      const actual = await vi.importActual<typeof import("idb")>("idb");
      return {
        ...actual,
        openDB: (name: string, version?: number, cbs?: any) => {
          if (version === undefined) return Promise.reject(new Error("open failed"));
          return actual.openDB(name, version, cbs);
        },
      };
    });
    const helper = await import("../indexedDbHelper");

    await expect(helper.initIndexedDB()).rejects.toThrow("open failed");
    expect(del).not.toHaveBeenCalled();
    expect(helper.getDbHealth()).toBe("needs-update");

    const check = await openDB(DB_NAME);
    expect(await check.count("races")).toBe(1);
    check.close();
  });
});
