/**
 * Sync safety (final QA): an older snapshot is never applied over newer rows, and a race
 * removed from the device while a reload is in flight is not brought back.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (sub: string) => `${b64url({ alg: "HS256" })}.${b64url({ sub, sid: "s" })}.sig`;
const LOCAL = "local-race-sync";
const SERVER = "22222222-2222-4222-8222-222222222222";
const access = { isOwner: false, roles: ["counter"], permissions: {}, screens: {}, waves: null, categories: null };
const snapshotOf = (lastSeq: number) => ({ race: { uuid: SERVER, name: "R" }, categories: [], riders: [], lastSeq, access });

let snapshotCalls = 0;
let snapshotSeq = 5;
let gate: Promise<void> | null = null;

async function load(lastSeq: number) {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("commissaire.live.session", JSON.stringify({ accessToken: jwt("judge"), refreshToken: "r", user: { id: "judge", email: "j@x.test", name: "j", identities: [] } }));
  localStorage.setItem("commissaire.live.links", JSON.stringify({ [LOCAL]: { serverRaceUuid: SERVER, lastSeq, linkedAt: new Date().toISOString() } }));
  return import("../liveClient");
}

beforeEach(async () => {
  snapshotCalls = 0;
  snapshotSeq = 5;
  gate = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith(`/races/${SERVER}/snapshot`)) {
      snapshotCalls++;
      if (gate) await gate;
      return new Response(JSON.stringify(snapshotOf(snapshotSeq)), { status: 200 });
    }
    if (url.includes(`/races/${SERVER}/actions`)) return new Response(JSON.stringify({ results: [] }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: "unavailable", message: "n/a" } }), { status: 503 });
  }));
  const { IDBFactory } = await import("fake-indexeddb");
  vi.stubGlobal("indexedDB", new IDBFactory());
});

describe("sync safety", () => {
  it("an older snapshot than what the device shows is never applied (no rows deleted); Sync reports it", async () => {
    const live = await load(10); // this device already applied up to seq 10
    snapshotSeq = 5; // the server answer is older (e.g. a lagging read)
    await expect(live.syncRaceNow(LOCAL)).rejects.toThrow("stale_snapshot");
    expect(snapshotCalls).toBe(3); // read again twice before giving up
    expect(JSON.parse(localStorage.getItem("commissaire.live.links")!)[LOCAL].lastSeq).toBe(10); // never moved backwards
  });

  it("a race removed while its reload is in flight is not brought back", async () => {
    const live = await load(0);
    const { default: useRaceStore } = await import("@/stores/racesStore");
    let open!: () => void;
    gate = new Promise((r) => { open = r; });
    const sync = live.syncRaceNow(LOCAL).catch(() => undefined);
    await vi.waitFor(() => expect(snapshotCalls).toBe(1));
    live.detachRace(LOCAL); // e.g. deleted by its creator / stop syncing
    open();
    await sync;
    expect(useRaceStore.getState().races.find((r) => r.uuid === LOCAL)).toBeUndefined();
  });
});
