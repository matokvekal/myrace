/**
 * Finish Race (shared race) must never finalize while this device still holds laps the
 * server hasn't acknowledged: the official result is computed on the server, and a lap
 * that arrives afterwards is refused as `race_official`. The queue is kept as it is, so
 * pressing Finish Race again after reconnecting sends it and finishes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (sub: string) => `${b64url({ alg: "HS256" })}.${b64url({ sub, sid: "s" })}.sig`;
const sessionJson = (id: string) => JSON.stringify({ accessToken: jwt(id), refreshToken: "r", user: { id, email: `${id}@x.test`, name: id, identities: [] } });
const LOCAL = "local-race-1";
const SERVER = "11111111-1111-4111-8111-111111111111";
const OFFICIAL = { version: "1", at: "2026-11-15T10:00:00.000Z", by: "owner", nonce: "n", payload: "p", token: "t", riderCount: 2, categoryCount: 1 };

/** Server log, in order: what reached it. */
let calls: string[];
let actionsDown: boolean;
let finalizeMode: "ok" | "network" | "already_official";
let answer: (a: { actionId: string; type: string }) => { applied: boolean; reason: string | null };

async function load() {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("commissaire.live.session", sessionJson("owner"));
  localStorage.setItem("commissaire.live.links", JSON.stringify({ [LOCAL]: { serverRaceUuid: SERVER, lastSeq: 0, linkedAt: new Date().toISOString() } }));
  return import("../liveClient");
}
const setOnline = (v: boolean) => Object.defineProperty(window.navigator, "onLine", { value: v, configurable: true });

beforeEach(async () => {
  calls = [];
  actionsDown = false;
  finalizeMode = "ok";
  answer = () => ({ applied: true, reason: null });
  setOnline(true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(url.indexOf("/races/"));
    if (path === `/races/${SERVER}/actions`) {
      if (actionsDown) throw new TypeError("Failed to fetch");
      const body = JSON.parse(String(init?.body)) as { actions: { actionId: string; type: string }[] };
      calls.push(`actions:${body.actions.length}`);
      return new Response(JSON.stringify({ results: body.actions.map((a, i) => ({ actionId: a.actionId, seq: i + 1, ...answer(a) })) }), { status: 200 });
    }
    if (path === `/races/${SERVER}/finalize`) {
      calls.push("finalize");
      if (finalizeMode === "network") throw new TypeError("Failed to fetch");
      if (finalizeMode === "already_official") return new Response(JSON.stringify({ error: { code: "already_official", message: "already" } }), { status: 409 });
      return new Response(JSON.stringify({ official: OFFICIAL }), { status: 201 });
    }
    if (path === `/races/${SERVER}/official`) {
      calls.push("official");
      return new Response(JSON.stringify({ versions: [{ ...OFFICIAL, officialVersion: 1 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: "unavailable", message: "n/a" } }), { status: 503 });
  }));
  const { IDBFactory } = await import("fake-indexeddb");
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => setOnline(true));

describe("finalizeShared with laps still on the device", () => {
  it("sends the queued laps first, then finalizes, reporting each stage", async () => {
    const live = await load();
    actionsDown = true; // queue two laps without sending them
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-2" });
    await live.flush(LOCAL);
    expect(await live.pendingCount(LOCAL)).toBe(2);
    actionsDown = false;

    const stages: string[] = [];
    const n = await live.finalizeShared(LOCAL, (s) => stages.push(s.stage === "sending" ? `sending:${s.pending}` : s.stage));
    expect(n).toBe(2);
    expect(calls.slice(0, 2)).toEqual(["actions:2", "finalize"]); // laps reach the server BEFORE the result is computed
    expect(stages).toEqual(["sending:2", "finalizing", "updating"]);
    expect(await live.pendingCount(LOCAL)).toBe(0);
  });

  it("refuses to finalize when the laps can't be sent, keeps them, and finishes on retry", async () => {
    const live = await load();
    actionsDown = true;
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-2" });
    await live.dispatchAction(LOCAL, "StatusCorrection", { riderUuid: "r-3", status: "DNF" });

    const err = await live.finalizeShared(LOCAL).catch((e) => e);
    expect(err).toBeInstanceOf(live.LiveApiError);
    expect(err.code).toBe("pending_actions");
    expect(err.message).toMatch(/^3 recorded changes/);
    expect(calls).not.toContain("finalize");
    expect(await live.pendingCount(LOCAL)).toBe(3); // nothing lost

    actionsDown = false; // connection back: same button again
    await live.finalizeShared(LOCAL);
    expect(calls).toEqual(["actions:3", "finalize", ...calls.slice(2)]);
    expect(await live.pendingCount(LOCAL)).toBe(0);
  });

  it("offline: says how many changes are waiting, sends nothing, and works after reconnect", async () => {
    const live = await load();
    actionsDown = true;
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    setOnline(false);
    const fetchCount = vi.mocked(fetch).mock.calls.length;

    const err = await live.finalizeShared(LOCAL).catch((e) => e);
    expect(err.code).toBe("offline");
    expect(err.message).toMatch(/1 recorded change \(laps, statuses…\)/);
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCount); // no request at all
    expect(await live.pendingCount(LOCAL)).toBe(1);

    setOnline(true);
    actionsDown = false;
    await live.finalizeShared(LOCAL);
    expect(calls.slice(0, 2)).toEqual(["actions:1", "finalize"]);
  });

  it("changes the server already refused don't block finishing (they stay in review)", async () => {
    const live = await load();
    answer = (a) => (a.type === "AddLap" ? { applied: false, reason: "locked" } : { applied: true, reason: null });
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    await live.flush(LOCAL);
    expect(await live.rejectedActions(LOCAL)).toHaveLength(1);

    await live.finalizeShared(LOCAL);
    expect(calls).toContain("finalize");
    expect(await live.rejectedActions(LOCAL)).toHaveLength(1); // kept for the owner, not deleted
  });

  it("a lost finalize answer gives a clear message; the retry adopts the official result", async () => {
    const live = await load();
    finalizeMode = "network";
    const err = await live.finalizeShared(LOCAL).catch((e) => e);
    expect(err.code).toBe("offline");
    expect(err.message).toMatch(/didn't answer/);

    finalizeMode = "already_official"; // the first request did finish it on the server
    expect(await live.finalizeShared(LOCAL)).toBe(2);
    expect(calls.filter((c) => c === "official")).toHaveLength(1);
  });
});
