import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RaceProps } from "@/types/types";

// No real socket in unit tests: the race is linked over HTTP only.
vi.mock("socket.io-client", () => ({
  io: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

const LOCAL = "11111111-1111-4111-8111-111111111111";
const SERVER_UUID = "22222222-2222-4222-8222-222222222222";
const race = { id: 1, uuid: LOCAL, name: "Mobile race", date: "2026-11-02", location: "TBD", owner: "1", status: "upcoming" } as unknown as RaceProps;

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let publishStatus: number;

const sessionOf = (id: string) =>
  JSON.stringify({ accessToken: "a", refreshToken: "r", user: { id, email: `${id}@x.test`, name: id, identities: [] } });

async function load(signedIn: boolean | string, keep = false) {
  vi.resetModules();
  if (!keep) localStorage.clear();
  localStorage.removeItem("commissaire.live.session");
  if (signedIn) localStorage.setItem("commissaire.live.session", sessionOf(signedIn === true ? "u1" : signedIn));
  const live = await import("../liveClient");
  const { default: useRaceStore } = await import("@/stores/racesStore");
  useRaceStore.setState({ races: [race] });
  return live;
}

beforeEach(() => {
  calls = [];
  publishStatus = 201;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (url.endsWith("/races/publish")) {
      const body = publishStatus === 201 ? { race: { uuid: SERVER_UUID } } : { error: { code: "internal", message: "Database unavailable" } };
      return new Response(JSON.stringify(body), { status: publishStatus });
    }
    return new Response(JSON.stringify({ error: { code: "unavailable", message: "n/a" } }), { status: 503 });
  }));
});

const publishCalls = () => calls.filter((c) => c.url.endsWith("/races/publish"));

describe("Create Race → server (persistNewRace)", () => {
  it("a new race with no categories yet is published and reported as on the server", async () => {
    const live = await load(true);
    const res = await live.persistNewRace(LOCAL);
    expect(res).toEqual({ stored: "server", serverRaceUuid: SERVER_UUID });
    expect(publishCalls()).toHaveLength(1);
    const body = publishCalls()[0].body as { race: { name: string }; categories: unknown[]; riders: unknown[] };
    expect(publishCalls()[0].method).toBe("POST");
    expect(body.race.name).toBe("Mobile race");
    expect(body.categories).toEqual([]);
    expect(live.isPendingPublish(LOCAL)).toBe(false);
  });

  it("signed out: nothing is sent and nothing is uploaded automatically after signing in", async () => {
    let live = await load(false);
    const res = await live.persistNewRace(LOCAL);
    expect(res).toMatchObject({ stored: "device", reason: "signed_out" });
    expect(publishCalls()).toHaveLength(0);

    live = await load(true, true); // signs in later (same device)
    await live.publishPending();
    expect(publishCalls()).toHaveLength(0);
    expect(live.isPendingPublish(LOCAL)).toBe(false);
  });

  it("'Save to server' uploads a local race only when asked, and links it", async () => {
    const live = await load(true);
    expect(await live.saveRaceToServer(LOCAL)).toBe(SERVER_UUID);
    expect(publishCalls()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("commissaire.live.links")!)[LOCAL].serverRaceUuid).toBe(SERVER_UUID);
  });

  it("'Save to server' failing says why and leaves the race local", async () => {
    publishStatus = 500;
    const live = await load(true);
    await expect(live.saveRaceToServer(LOCAL)).rejects.toThrow("Database unavailable");
    expect(localStorage.getItem("commissaire.live.links") ?? "{}").not.toContain(LOCAL);
    expect(live.useLiveStore.getState().publishErrors[LOCAL]).toBe("Database unavailable");
  });

  it("a race queued by one account is never published under another", async () => {
    publishStatus = 500;
    let live = await load("u1");
    await live.persistNewRace(LOCAL);
    publishStatus = 201;
    calls = [];
    live = await load("u2", true);
    await live.publishPending();
    expect(publishCalls()).toHaveLength(0);
    live = await load("u1", true);
    await live.publishPending();
    expect(publishCalls()).toHaveLength(1);
  });

  it("the retry timer and 'Save to server' at the same moment upload the race once", async () => {
    publishStatus = 500;
    const live = await load(true);
    await live.persistNewRace(LOCAL); // queued after a failure
    publishStatus = 201;
    calls = [];
    const [a, b] = await Promise.all([live.saveRaceToServer(LOCAL), live.publishPending().then(() => SERVER_UUID)]);
    expect(a).toBe(SERVER_UUID);
    expect(b).toBe(SERVER_UUID);
    expect(publishCalls()).toHaveLength(1);
    expect(live.isPendingPublish(LOCAL)).toBe(false);
  });

  it("races in the old signed-out queue are not uploaded automatically", async () => {
    localStorage.clear();
    localStorage.setItem("commissaire.live.pendingPublish", JSON.stringify([LOCAL]));
    const live = await load(true, true);
    await live.publishPending();
    expect(publishCalls()).toHaveLength(0);
  });

  it("a server error is reported, never as success, and the race stays queued with the reason", async () => {
    publishStatus = 500;
    const live = await load(true);
    const res = await live.persistNewRace(LOCAL);
    expect(res).toEqual({ stored: "device", reason: "failed", message: "Database unavailable" });
    expect(live.isPendingPublish(LOCAL)).toBe(true);
    expect(live.useLiveStore.getState().publishErrors[LOCAL]).toBe("Database unavailable");
  });

  it("the queued race is uploaded on the next try once the server is back, and the error clears", async () => {
    publishStatus = 500;
    const live = await load(true);
    await live.persistNewRace(LOCAL);
    publishStatus = 201;
    await live.publishPending();
    expect(live.isPendingPublish(LOCAL)).toBe(false);
    expect(live.useLiveStore.getState().publishErrors[LOCAL]).toBeUndefined();
  });

  it("sharing an empty race by hand from Team is still refused (unchanged)", async () => {
    const live = await load(true);
    await expect(live.publishRace(LOCAL)).rejects.toMatchObject({ code: "no_categories" });
    expect(publishCalls()).toHaveLength(0);
  });
});
