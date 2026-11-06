/**
 * 0.2: an Action the server did not apply is KEPT on the device for review — never silently
 * dropped, never re-sent, never shown to another account — and leaves only on Dismiss.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (sub: string) => `${b64url({ alg: "HS256" })}.${b64url({ sub, sid: "s" })}.sig`;
const sessionJson = (id: string) => JSON.stringify({ accessToken: jwt(id), refreshToken: "r", user: { id, email: `${id}@x.test`, name: id, identities: [] } });
const LOCAL = "local-race-1";
const SERVER = "11111111-1111-4111-8111-111111111111";

let posted: { actionId: string; type: string }[][];
let answer: (actions: { actionId: string; type: string }[]) => { actionId: string; seq: number | null; applied: boolean; reason: string | null }[];

async function load(user: string) {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("commissaire.live.session", sessionJson(user));
  localStorage.setItem("commissaire.live.links", JSON.stringify({ [LOCAL]: { serverRaceUuid: SERVER, lastSeq: 0, linkedAt: new Date().toISOString() } }));
  return import("../liveClient");
}

beforeEach(async () => {
  posted = [];
  answer = (actions) => actions.map((a, i) => ({ actionId: a.actionId, seq: i + 1, applied: true, reason: null }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith(`/races/${SERVER}/actions`)) {
      const body = JSON.parse(String(init?.body)) as { actions: { actionId: string; type: string }[] };
      posted.push(body.actions);
      return new Response(JSON.stringify({ results: answer(body.actions) }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: "unavailable", message: "n/a" } }), { status: 503 });
  }));
  // Fresh IndexedDB per test.
  const { IDBFactory } = await import("fake-indexeddb");
  vi.stubGlobal("indexedDB", new IDBFactory());
});

describe("rejected offline actions", () => {
  it("are kept for review, not re-sent, and leave only when dismissed", async () => {
    const live = await load("judge");
    answer = (actions) => actions.map((a) => ({ actionId: a.actionId, seq: 7, applied: a.type !== "AddLap", reason: a.type === "AddLap" ? "not_member" : null }));
    const lap = await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    await live.dispatchAction(LOCAL, "CommentSet", { riderUuid: "r-2", comment: "ok" });
    await live.flush(LOCAL);

    const kept = await live.rejectedActions(LOCAL);
    expect(kept.map((r) => [r.actionId, r.type, r.reason, r.riderUuid])).toEqual([[lap, "AddLap", "not_member", "r-1"]]);
    expect(live.useLiveStore.getState().sync[LOCAL].notApplied).toHaveLength(1);
    expect(await live.pendingCount(LOCAL)).toBe(0); // nothing waiting to be sent

    // Never sent again.
    const before = posted.length;
    await live.flush(LOCAL);
    expect(posted.length).toBe(before);

    await live.dismissRejected(LOCAL, [lap]);
    expect(await live.rejectedActions(LOCAL)).toEqual([]);
    expect(live.useLiveStore.getState().sync[LOCAL].notApplied).toEqual([]);
  });

  it("survive a reload (module re-import) and are restored when the race opens", async () => {
    let live = await load("judge");
    answer = (actions) => actions.map((a) => ({ actionId: a.actionId, seq: null, applied: false, reason: "forbidden" }));
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    await live.flush(LOCAL);
    // "Reload": same IndexedDB, fresh module and store.
    vi.resetModules();
    live = await import("../liveClient");
    expect(live.useLiveStore.getState().sync[LOCAL]).toBeUndefined();
    await live.openLiveRace(LOCAL);
    expect(live.useLiveStore.getState().sync[LOCAL].notApplied.map((n) => n.reason)).toEqual(["forbidden"]);
  });

  it("are never shown to, or dismissable by, another account on the same device", async () => {
    const live = await load("judge");
    answer = (actions) => actions.map((a) => ({ actionId: a.actionId, seq: null, applied: false, reason: "out_of_scope" }));
    const lap = await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    await live.flush(LOCAL);
    // Another account signs in on this device (same IndexedDB).
    vi.resetModules();
    localStorage.setItem("commissaire.live.session", sessionJson("someone-else"));
    const other = await import("../liveClient");
    expect(await other.rejectedActions(LOCAL)).toEqual([]);
    await other.dismissRejected(LOCAL, [lap]);
    // Back as the judge: still there.
    vi.resetModules();
    localStorage.setItem("commissaire.live.session", sessionJson("judge"));
    const again = await import("../liveClient");
    expect((await again.rejectedActions(LOCAL)).map((r) => r.actionId)).toEqual([lap]);
  });
});
