import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * Regression (production 2026-11-14, race "סובב כינרת": 55 "not applied"): a SHARED race whose
 * wave comes from the categories' start times. Start saves the derived wave (CategoryEdited heat),
 * the server moves the riders to that wave, then GO. StartManager used to write back the riders it
 * held from render time (heat 0) and the bridge sent `RiderEdited {heat: 0}` for every rider —
 * refused as "locked" after the GO. Starting a wave must send only CategoryEdited + WaveStarted,
 * keep the riders in their wave locally, and do the same when the device is offline and reconnects.
 */
vi.mock("socket.io-client", () => ({ io: vi.fn(() => ({ on: vi.fn(), off: vi.fn(), connected: false, emit: vi.fn(), disconnect: vi.fn() })) }));
vi.mock("react-toastify", () => ({ toast: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import useRaceStore from "@/stores/racesStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { makeCategory, makeRider } from "@/test/factories";
import { applyingRemote, LIVE_LINKS_KEY } from "@/services/live/liveBridge";
import type { CategoryProps, RaceProps, RiderProps } from "@/types/types";
import StartManager from "../StartManager";

const LOCAL = "local-start-race";
const SERVER = "00000000-0000-4000-8000-00000000a001";
const CAT_UUID = "00000000-0000-4000-8000-00000000c001";

type Sent = { type: string; payload: Record<string, unknown> };
let live: typeof import("@/services/live/liveClient");
let online = false;
let sent: Sent[] = [];

const outbox = async () => {
  const db = await initIndexedDB();
  const rows = (await db.getAll("live_outbox")) as { action: Sent; rejected?: unknown; createdAt: number }[];
  db.close();
  return rows.sort((a, b) => a.createdAt - b.createdAt); // queue order, as flush sends it
};
const clearOutbox = async () => {
  const db = await initIndexedDB();
  await db.clear("live_outbox");
  db.close();
};

const riderUuid = (i: number) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;

beforeEach(async () => {
  vi.stubEnv("VITE_SERVER_URL", "http://server.test");
  localStorage.setItem("commissaire.live.session", JSON.stringify({ accessToken: "a", refreshToken: "r", user: { id: "owner-1", email: "o@x.test", name: "O", identities: [] } }));
  localStorage.setItem(LIVE_LINKS_KEY, JSON.stringify({ [LOCAL]: { serverRaceUuid: SERVER, lastSeq: 0, linkedAt: "" } }));
  online = false;
  sent = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!online) throw new TypeError("Failed to fetch");
    if (String(url).endsWith("/actions")) {
      const { actions } = JSON.parse(String(init!.body)) as { actions: (Sent & { actionId: string })[] };
      sent.push(...actions);
      return new Response(JSON.stringify({ results: actions.map((a, i) => ({ actionId: a.actionId, seq: i + 1, applied: true, reason: null })) }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: "unavailable", message: "n/a" } }), { status: 503 });
  }));
  live = await import("@/services/live/liveClient");
  live.useLiveStore.setState({ access: {} });
  live.startLive();
  await clearOutbox();

  // Waves come from start times: the category has NO wave yet, nor do its riders.
  const cat = makeCategory({ id: 1, uuid: CAT_UUID, raceUuid: LOCAL, name: "Elite", heat: 0, laps: 3, startTime: "09:00", status: "upcoming" });
  useRaceStore.setState({ races: [{ id: 1, uuid: LOCAL, name: "Shared", date: "2026-11-14", status: "upcoming" } as RaceProps] });
  useCategoryStore.setState({ categories: [cat] });
  useRiderStore.setState({
    riders: [1, 2, 3].map((i) => makeRider({ id: 100 + i, uuid: riderUuid(i), raceUuid: LOCAL, category: "Elite", heat: 0, bibNumber: i, checked: true, status: "standing" })),
    lastFetchedRaceUuid: LOCAL,
  });

  // The server's answer to the saved wave: its riders move to wave 1 (as a remote change),
  // arriving while Start is still awaiting — exactly the 2026-11-14 order of events.
  useCategoryStore.subscribe((s, prev) => {
    const before = prev.categories.find((c) => c.uuid === CAT_UUID);
    const after = s.categories.find((c) => c.uuid === CAT_UUID);
    if (!(Number(before?.heat) > 0) && Number(after?.heat) > 0) {
      const wave = Number(after!.heat);
      const moved: RiderProps[] = useRiderStore.getState().riders.map((r) => (r.raceUuid === LOCAL ? { ...r, heat: wave } : r));
      void applyingRemote(() => useRiderStore.getState().patchRiders(moved));
    }
  });
});

const startWave = async () => {
  const cats = useCategoryStore.getState().categories as CategoryProps[];
  render(
    <MemoryRouter>
      <StartManager raceUuid={LOCAL} waveNum={1} categories={cats} simple />
    </MemoryRouter>
  );
  await userEvent.setup().click(await screen.findByTestId("start-all"));
  await waitFor(() => expect(useCategoryStore.getState().categories[0].status).toBe("running"));
  await new Promise((r) => setTimeout(r, 50));
};

const types = (list: { type: string }[]) => list.map((a) => a.type);

describe("Start of a shared wave derived from start times", () => {
  it("sends only the saved wave + WaveStarted — never RiderEdited {heat} — and keeps riders in their wave", async () => {
    await startWave();
    const queued = (await outbox()).map((e) => e.action);
    expect(types(queued)).toEqual(["CategoryEdited", "WaveStarted"]);
    expect(queued[0].payload).toMatchObject({ categoryUuid: CAT_UUID, changes: { heat: 1 } });
    expect(queued.some((a) => a.type === "RiderEdited")).toBe(false);

    const riders = useRiderStore.getState().riders.filter((r) => r.raceUuid === LOCAL) as RiderProps[];
    expect(riders.map((r) => [r.heat, r.raceStatus, !!r.timeStartRace])).toEqual([[1, "running", true], [1, "running", true], [1, "running", true]]);
  });

  it("offline at Start, then reconnect: the queue goes out in order, nothing is refused or left behind", async () => {
    await startWave(); // offline: everything stays queued
    expect(types((await outbox()).map((e) => e.action))).toEqual(["CategoryEdited", "WaveStarted"]);
    expect(sent).toEqual([]);

    online = true; // reconnect
    await live.flush(LOCAL);
    expect(types(sent)).toEqual(["CategoryEdited", "WaveStarted"]);
    expect(await outbox()).toEqual([]);
    expect(live.useLiveStore.getState().sync[LOCAL]?.notApplied ?? []).toEqual([]);
  });
});

describe("sync layer: a rider-only wave change is not sent once the category has a wave", () => {
  beforeEach(async () => {
    await applyingRemote(() => useCategoryStore.getState().upsertCategories([{ ...useCategoryStore.getState().categories[0], heat: 1 }]));
    await applyingRemote(() => useRiderStore.getState().patchRiders(useRiderStore.getState().riders.map((r) => ({ ...r, heat: 1 }))));
    await clearOutbox();
  });

  it("a stale heat 0 written back (with other changes) sends only the real changes", async () => {
    const r = useRiderStore.getState().riders[0];
    await useRiderStore.getState().updateAllRiders([{ ...r, heat: 0, firstName: "Renamed", raceStatus: "running" }]);
    await new Promise((res) => setTimeout(res, 30));
    const queued = (await outbox()).map((e) => e.action);
    expect(types(queued)).toEqual(["RiderEdited"]);
    expect(queued[0].payload.changes).toEqual({ firstName: "Renamed" });
  });

  it("legitimate edits still go out: bib change and a move to another category", async () => {
    await applyingRemote(() => useCategoryStore.getState().upsertCategories([
      makeCategory({ id: 2, uuid: "00000000-0000-4000-8000-00000000c002", raceUuid: LOCAL, name: "Masters", heat: 2, laps: 2, status: "upcoming" }),
    ]));
    const r = useRiderStore.getState().riders[0];
    await useRiderStore.getState().updateRider({ ...r, bibNumber: 77 });
    const r2 = useRiderStore.getState().riders.find((x) => x.id === 102)!;
    await useRiderStore.getState().updateRider({ ...r2, category: "Masters", heat: 2 });
    await new Promise((res) => setTimeout(res, 30));
    const changes = (await outbox()).map((e) => e.action.payload.changes);
    expect(changes).toEqual([{ bibNumber: 77 }, { category: "Masters" }]); // the server sets the wave from Masters
  });

  it("a category WITHOUT a wave keeps per-rider waves (unchanged behaviour)", async () => {
    await applyingRemote(() => useCategoryStore.getState().upsertCategories([{ ...useCategoryStore.getState().categories[0], heat: 0 }]));
    const r = useRiderStore.getState().riders[0];
    await useRiderStore.getState().updateRider({ ...r, heat: 4 });
    await new Promise((res) => setTimeout(res, 30));
    expect((await outbox()).map((e) => e.action.payload.changes)).toEqual([{ heat: 4 }]);
  });
});
