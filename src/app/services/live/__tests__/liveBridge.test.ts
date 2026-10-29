import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Shared race: store writes become Actions in the IndexedDB outbox (each with
 * its race); writes the member may not do are refused; local races and
 * server-applied changes produce nothing.
 */
vi.mock("socket.io-client", () => ({ io: vi.fn(() => ({ on: vi.fn(), connected: false, emit: vi.fn(), disconnect: vi.fn() })) }));
vi.mock("react-toastify", () => ({ toast: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import useRaceStore from "@/stores/racesStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { makeCategory, makeRider } from "@/test/factories";
import { applyingRemote, liveBridge, LIVE_LINKS_KEY, setLiveBridge } from "../liveBridge";
import type { RaceProps } from "@/types/types";

const LOCAL = "local-race-1";
const SERVER = "00000000-0000-4000-8000-0000000000aa";
const RIDER = "00000000-0000-4000-8000-0000000000b1";
const CAT = "00000000-0000-4000-8000-0000000000c1";

let live: typeof import("../liveClient");

const outbox = async () => {
  const db = await initIndexedDB();
  const rows = await db.getAll("live_outbox");
  db.close();
  return rows as { localRaceUuid: string; action: { type: string; raceUuid: string; payload: Record<string, unknown> } }[];
};
const settle = () => new Promise((r) => setTimeout(r, 30));

function access(screens: Record<string, Partial<Record<"view" | "create" | "update" | "delete", boolean>>>, waves: number[] | null = null) {
  const all = ["info", "map", "schedule", "categories", "riders", "results", "start", "checkin", "board", "status", "live", "team", "settings"];
  return {
    isOwner: false, roles: [], permissions: {}, waves, categories: null,
    screens: Object.fromEntries(all.map((s) => [s, { view: false, create: false, update: false, delete: false, ...(screens[s] ?? {}) }])),
  };
}

beforeEach(async () => {
  vi.stubEnv("VITE_SERVER_URL", "http://server.test");
  localStorage.setItem(LIVE_LINKS_KEY, JSON.stringify({ [LOCAL]: { serverRaceUuid: SERVER, lastSeq: 0, linkedAt: "" } }));
  localStorage.removeItem(`commissaire.live.access.${LOCAL}`); // one test restricts access; don't leak it
  live = await import("../liveClient");
  live.useLiveStore.setState({ access: {} });
  live.startLive();
  useRaceStore.setState({ races: [{ id: 1, uuid: LOCAL, name: "Shared" } as RaceProps] });
  useCategoryStore.setState({ categories: [makeCategory({ id: 5, uuid: CAT, raceUuid: LOCAL, name: "Elite", heat: 1 })] });
  useRiderStore.setState({ riders: [makeRider({ id: 9, uuid: RIDER, raceUuid: LOCAL, category: "Elite", heat: 1, bibNumber: 7 })], lastFetchedRaceUuid: LOCAL });
});

describe("store writes on a shared race", () => {
  it("check-in, comment, bib and status become their own Actions, addressed to the server race", async () => {
    const r = useRiderStore.getState().riders[0];
    await useRiderStore.getState().updateRider({ ...r, checked: true, comment: "front row", bibNumber: 77, status: "DNS" });
    await settle();
    const types = (await outbox()).map((e) => e.action.type).sort();
    expect(types).toEqual(["CommentSet", "RiderCheckedIn", "RiderEdited", "StatusCorrection"]);
    expect((await outbox()).every((e) => e.localRaceUuid === LOCAL && e.action.raceUuid === SERVER)).toBe(true);
  });

  it("lap and position fields (computed by the server) are never sent", async () => {
    const r = useRiderStore.getState().riders[0];
    await useRiderStore.getState().updateRider({ ...r, lapsCounter: 3, position_category: 1, raceStatus: "running", timeArrive: "x" });
    await settle();
    expect(await outbox()).toEqual([]);
  });

  it("a new rider gets a shared id and is sent as RiderAdded", async () => {
    await useRiderStore.getState().addNewRider(makeRider({ id: 10, raceUuid: LOCAL, category: "Elite", bibNumber: 8 }));
    await settle();
    const [e] = await outbox();
    expect(e.action.type).toBe("RiderAdded");
    expect((e.action.payload.rider as { uuid: string }).uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(useRiderStore.getState().riders.find((x) => x.id === 10)?.uuid).toBe((e.action.payload.rider as { uuid: string }).uuid);
  });

  it("category laps and race settings become CategoryEdited and SettingChanged", async () => {
    const c = useCategoryStore.getState().categories[0];
    await useCategoryStore.getState().updateCategory({ ...c, laps: 6 });
    const race = useRaceStore.getState().races[0];
    await useRaceStore.getState().updateRace({ ...race, leaderFinishAll: false });
    await settle();
    const acts = (await outbox()).map((e) => e.action);
    expect(acts.find((a) => a.type === "CategoryEdited")?.payload).toEqual({ categoryUuid: CAT, changes: { laps: 6 } });
    expect(acts.find((a) => a.type === "SettingChanged")?.payload).toEqual({ changes: { leaderFinishAll: false } });
  });

  it("a write the member's access does not allow is refused and not applied locally", async () => {
    localStorage.setItem(`commissaire.live.access.${LOCAL}`, JSON.stringify(access({ live: { view: true }, riders: { view: true } })));
    const r = useRiderStore.getState().riders[0];
    await useRiderStore.getState().updateRider({ ...r, comment: "not allowed" });
    await settle();
    expect(useRiderStore.getState().riders[0].comment).not.toBe("not allowed");
    expect(await outbox()).toEqual([]);
  });

  it("changes applied from the server are not sent back", async () => {
    const r = useRiderStore.getState().riders[0];
    await applyingRemote(() => useRiderStore.getState().updateRider({ ...r, comment: "from server" }));
    await settle();
    expect(useRiderStore.getState().riders[0].comment).toBe("from server");
    expect(await outbox()).toEqual([]);
  });

  it("a user's edit made while server changes are being applied is still sent", async () => {
    // A server apply spans IndexedDB awaits; a check-in tapped meanwhile must not be taken for a remote write.
    const r = useRiderStore.getState().riders[0];
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    // A server write still in flight (its IndexedDB put not done) ...
    const remote = applyingRemote(async () => {
      useRiderStore.setState((s) => ({ riders: s.riders.map((x) => (x.id === r.id ? { ...x, team: "server team" } : x)) }));
      await gate;
    });
    await useRiderStore.getState().updateRider({ ...useRiderStore.getState().riders[0], checked: true }); // ... when the user taps
    release();
    await remote;
    await settle();
    expect((await outbox()).map((e) => e.action.type)).toEqual(["RiderCheckedIn"]);
    expect(useRiderStore.getState().riders[0]).toMatchObject({ checked: true, team: "server team" });
  });

  it("edits made before the live client finished loading are sent once it is installed", async () => {
    const real = liveBridge()!;
    setLiveBridge(null); // the dynamic import of the live client has not resolved yet
    const r = useRiderStore.getState().riders[0];
    await useRiderStore.getState().updateRider({ ...r, checked: true });
    await useRiderStore.getState().addNewRider(makeRider({ id: 11, raceUuid: LOCAL, category: "Elite", bibNumber: 12 }));
    expect(useRiderStore.getState().riders[0].checked).toBe(true); // applied locally right away
    const newUuid = useRiderStore.getState().riders.find((x) => x.id === 11)?.uuid;
    expect(newUuid).toMatch(/^[0-9a-f-]{36}$/); // shared id assigned before the write
    expect(await outbox()).toEqual([]);
    setLiveBridge(real);
    await settle();
    const acts = (await outbox()).map((e) => e.action);
    expect(acts.map((a) => a.type).sort()).toEqual(["RiderAdded", "RiderCheckedIn"]);
    expect((acts.find((a) => a.type === "RiderAdded")!.payload.rider as { uuid: string }).uuid).toBe(newUuid);
  });

  it("a local race produces no Actions", async () => {
    localStorage.setItem(LIVE_LINKS_KEY, "{}");
    const r = useRiderStore.getState().riders[0];
    await useRiderStore.getState().updateRider({ ...r, comment: "local" });
    await settle();
    expect(await outbox()).toEqual([]);
  });

  it("the outbox keeps each race's Actions apart (switching races mixes nothing)", async () => {
    localStorage.setItem(LIVE_LINKS_KEY, JSON.stringify({
      [LOCAL]: { serverRaceUuid: SERVER, lastSeq: 0, linkedAt: "" },
      "local-race-2": { serverRaceUuid: "00000000-0000-4000-8000-0000000000dd", lastSeq: 0, linkedAt: "" },
    }));
    await live.dispatchAction(LOCAL, "CommentSet", { riderUuid: RIDER, comment: "a" });
    await live.dispatchAction("local-race-2", "CommentSet", { riderUuid: RIDER, comment: "b" });
    expect(await live.pendingCount(LOCAL)).toBe(1);
    expect(await live.pendingCount("local-race-2")).toBe(1);
    const rows = await outbox();
    expect(rows.find((e) => e.localRaceUuid === "local-race-2")?.action.raceUuid).toBe("00000000-0000-4000-8000-0000000000dd");
  });
});
