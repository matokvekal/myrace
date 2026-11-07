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

  it("don't count as waiting, and leave with the race when the race is removed from the device", async () => {
    const live = await load("judge");
    answer = (actions) => actions.map((a) => ({ actionId: a.actionId, seq: null, applied: false, reason: "forbidden" }));
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    await live.flush(LOCAL);
    expect(await live.outboxCounts(LOCAL)).toEqual({ pending: 0, rejected: 1 });
    expect(live.useLiveStore.getState().sync[LOCAL].pending).toBe(0);
    await live.removeDeletedRace(LOCAL);
    expect(await live.outboxCounts(LOCAL)).toEqual({ pending: 0, rejected: 0 });
  });
});

describe("duplicate lap reports (first write wins on the server)", () => {
  it("leave the outbox, are not listed as not applied, and reload the server's copy", async () => {
    const live = await load("judge");
    answer = (actions) => actions.map((a) => ({ actionId: a.actionId, seq: null, applied: false, reason: "duplicate" }));
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    await live.flush(LOCAL);

    expect(await live.rejectedActions(LOCAL)).toEqual([]);
    expect(await live.outboxCounts(LOCAL)).toEqual({ pending: 0, rejected: 0 });
    expect(live.useLiveStore.getState().sync[LOCAL].notApplied).toEqual([]);
    // The other judge's lap was skipped locally while ours was queued: fetch the server's copy
    // (once, shortly after the burst — single-flight + debounce).
    const snaps = () => vi.mocked(fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.endsWith(`/races/${SERVER}/snapshot`)).length;
    await vi.waitFor(() => expect(snaps()).toBe(1), { timeout: 4000 });
  });

  it("a burst of duplicate answers reloads the race ONCE, not per send", async () => {
    const live = await load("judge");
    answer = (actions) => actions.map((a) => ({ actionId: a.actionId, seq: null, applied: false, reason: "duplicate" }));
    for (const r of ["r-1", "r-2", "r-3"]) {
      await live.dispatchAction(LOCAL, "AddLap", { riderUuid: r });
      await live.flush(LOCAL);
    }
    const snaps = () => vi.mocked(fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.endsWith(`/races/${SERVER}/snapshot`)).length;
    expect(snaps()).toBe(0); // not during the burst
    await vi.waitFor(() => expect(snaps()).toBe(1), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(snaps()).toBe(1);
  });

  it("two flushes at once send the queue once", async () => {
    const live = await load("judge");
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    await Promise.all([live.flush(LOCAL), live.flush(LOCAL)]);
    expect(posted.length).toBe(1);
  });

  it("are told apart from real refusals in the same batch", async () => {
    const live = await load("judge");
    answer = (actions) => actions.map((a, i) => ({ actionId: a.actionId, seq: null, applied: false, reason: i === 0 ? "duplicate" : "forbidden" }));
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    const refused = await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-2" });
    await live.flush(LOCAL);
    expect((await live.rejectedActions(LOCAL)).map((r) => r.actionId)).toEqual([refused]);
  });

  it("isDuplicateResult only matches a not-applied duplicate", async () => {
    const live = await load("judge");
    expect(live.isDuplicateResult({ applied: false, reason: "duplicate" })).toBe(true);
    expect(live.isDuplicateResult({ applied: true, reason: "duplicate" })).toBe(false);
    expect(live.isDuplicateResult({ applied: false, reason: "stale" })).toBe(false);
  });
});

describe("manual Sync (syncRaceNow)", () => {
  const snapshot = {
    lastSeq: 42,
    access: { role: "judge", screens: {} },
    race: { name: "Server race" },
    categories: [],
    riders: [
      { uuid: "r-1", bibNumber: 1, firstName: "Server", lastName: "One", category: "Elite", lapsCounter: 3 },
      { uuid: "r-2", bibNumber: 2, firstName: "Server", lastName: "Two", category: "Elite", lapsCounter: 5 },
    ],
  };
  let calls: string[];
  let actionsDown: boolean;

  async function loadWithStores() {
    const live = await load("judge");
    const { default: useRaceStore } = await import("@/stores/racesStore");
    const { default: useRiderStore } = await import("@/stores/ridersStore");
    const { default: useCategoryStore } = await import("@/stores/categoryStore");
    useRaceStore.setState({ races: [{ id: 1, uuid: LOCAL, name: "Local race" } as never] });
    useCategoryStore.setState({ categories: [] });
    const { makeRider } = await import("@/test/factories");
    // r-1 has a lap typed here that has not been sent; r-2's local copy is stale.
    const mine = [
      makeRider({ id: 1, uuid: "r-1", raceUuid: LOCAL, bibNumber: 1, lapsCounter: 4 }),
      makeRider({ id: 2, uuid: "r-2", raceUuid: LOCAL, bibNumber: 2, lapsCounter: 1 }),
    ];
    useRiderStore.setState({ riders: mine, lastFetchedRaceUuid: LOCAL });
    return { live, useRiderStore, useRaceStore };
  }

  beforeEach(() => {
    calls = [];
    actionsDown = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/races/${SERVER}/actions`)) {
        calls.push("actions");
        if (actionsDown) return new Response(JSON.stringify({ error: { code: "unavailable", message: "n/a" } }), { status: 503 });
        const body = JSON.parse(String(init?.body)) as { actions: { actionId: string; type: string }[] };
        posted.push(body.actions);
        return new Response(JSON.stringify({ results: answer(body.actions) }), { status: 200 });
      }
      if (url.endsWith(`/races/${SERVER}/snapshot`)) {
        calls.push("snapshot");
        return new Response(JSON.stringify(snapshot), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: "unavailable", message: "n/a" } }), { status: 503 });
    }));
  });

  it("sends the outbox FIRST, then replaces the local copy with the server snapshot", async () => {
    const { live, useRiderStore, useRaceStore } = await loadWithStores();
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    const res = await live.syncRaceNow(LOCAL);

    expect(calls.filter((c) => c === "actions" || c === "snapshot").slice(0, 2)).toEqual(["actions", "snapshot"]);
    expect(res).toEqual({ pending: 0, rejected: 0 });
    const riders = useRiderStore.getState().riders;
    expect(riders.find((r) => r.uuid === "r-1")!.lapsCounter).toBe(3); // sent → server's copy
    expect(riders.find((r) => r.uuid === "r-2")!.lapsCounter).toBe(5); // stale local copy replaced
    expect(useRaceStore.getState().races[0].name).toBe("Server race");
  });

  it("an Action that could not be sent stays queued and its rider keeps the local change", async () => {
    const { live, useRiderStore } = await loadWithStores();
    actionsDown = true;
    await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    const res = await live.syncRaceNow(LOCAL);

    expect(calls.indexOf("actions")).toBeLessThan(calls.indexOf("snapshot"));
    expect(res.pending).toBe(1); // never discarded
    const riders = useRiderStore.getState().riders;
    expect(riders.find((r) => r.uuid === "r-1")!.lapsCounter).toBe(4); // queued change wins until sent
    expect(riders.find((r) => r.uuid === "r-2")!.lapsCounter).toBe(5);
  });

  it("refused Actions stay in review after a Sync", async () => {
    const { live } = await loadWithStores();
    answer = (actions) => actions.map((a) => ({ actionId: a.actionId, seq: null, applied: false, reason: "forbidden" }));
    const lap = await live.dispatchAction(LOCAL, "AddLap", { riderUuid: "r-1" });
    const res = await live.syncRaceNow(LOCAL);
    expect(res).toEqual({ pending: 0, rejected: 1 });
    expect((await live.rejectedActions(LOCAL)).map((r) => r.actionId)).toEqual([lap]);
  });

  it("throws (nothing replaced) when the snapshot can't be fetched", async () => {
    const { live, useRiderStore } = await loadWithStores();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(live.syncRaceNow(LOCAL)).rejects.toThrow();
    expect(useRiderStore.getState().riders.find((r) => r.uuid === "r-2")!.lapsCounter).toBe(1);
  });
});
