import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RaceProps } from "@/types/types";
import { makeRider } from "@/test/factories";

vi.mock("socket.io-client", () => ({
  io: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

const LOCAL = "11111111-1111-4111-8111-111111111111";
const SERVER_UUID = "22222222-2222-4222-8222-222222222222";
const race = { id: 1, uuid: LOCAL, name: "Phone race", date: "2026-11-02", status: "upcoming", autoColor: true } as unknown as RaceProps;
const rider = (bib: number, category: string, heat = 1) =>
  makeRider({ raceUuid: LOCAL, bibNumber: bib, firstName: "T", lastName: `R${bib}`, category, heat, timeStartRace: "09:00" });

type Sent = { actionId: string; type: string; payload: { riders: { bibNumber: number }[]; categories: { name: string; heat: number }[] } };
let sent: Sent[];
let answer: "applied" | "invalid" | "offline";

async function load() {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("commissaire.live.session", JSON.stringify({ accessToken: "a", refreshToken: "r", user: { id: "u1", email: "o@x.test", name: "O", identities: [] } }));
  localStorage.setItem("commissaire.live.links", JSON.stringify({ [LOCAL]: { serverRaceUuid: SERVER_UUID, lastSeq: 0, linkedAt: new Date().toISOString() } }));
  const live = await import("../liveClient");
  const { default: useRaceStore } = await import("@/stores/racesStore");
  const { default: useRiderStore } = await import("@/stores/ridersStore");
  useRaceStore.setState({ races: [race] });
  useRiderStore.setState({ riders: [], lastFetchedRaceUuid: LOCAL });
  return { live, useRiderStore };
}

beforeEach(() => {
  sent = [];
  answer = "applied";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/actions")) {
      if (answer === "offline") throw new TypeError("Failed to fetch");
      const { actions } = JSON.parse(String(init!.body)) as { actions: Sent[] };
      sent.push(...actions);
      return new Response(JSON.stringify({ results: actions.map((a) => ({ actionId: a.actionId, seq: 1, applied: answer === "applied", reason: answer === "applied" ? null : "invalid" })) }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: "unavailable", message: "n/a" } }), { status: 503 }); // catch-up: not needed here
  }));
});

describe("Import into a shared race", () => {
  it("sends ONE RidersImported with the riders and the categories they need", async () => {
    const { live } = await load();
    const res = await live.importIntoSharedRace(LOCAL, [rider(1, "Elite"), rider(2, "Elite"), rider(3, "Masters", 2)], [2, 3, 4]);
    expect(res).toEqual({ riders: 3, categories: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("RidersImported");
    expect(sent[0].payload.riders.map((r) => r.bibNumber)).toEqual([1, 2, 3]);
    expect(sent[0].payload.categories.map((c) => [c.name, c.heat]).sort()).toEqual([["Elite", 1], ["Masters", 2]]);
  });

  it("a bad file is refused by row before anything is sent or saved", async () => {
    const { live, useRiderStore } = await load();
    const err = await live.importIntoSharedRace(LOCAL, [rider(7, "Elite"), rider(7, "Elite"), rider(8, "")], [2, 3, 4]).catch((e) => e);
    expect(err).toBeInstanceOf(live.ImportRefused);
    expect(err.problems.map((p: { message: string }) => p.message)).toEqual(["Row 4 (T R8): no category", "Bib 7 appears on rows 2, 3"]);
    expect(sent).toHaveLength(0);
    expect(useRiderStore.getState().riders).toHaveLength(0);
  });

  it("refused by the server: says so, saves nothing here", async () => {
    answer = "invalid";
    const { live, useRiderStore } = await load();
    await expect(live.importIntoSharedRace(LOCAL, [rider(1, "Elite")], [2])).rejects.toThrow("Nothing was imported. The server refused the import (not valid any more).");
    expect(useRiderStore.getState().riders).toHaveLength(0);
  });

  it("no answer, then retry of the same file: the same actionId, so the server imports it once", async () => {
    answer = "offline";
    const { live, useRiderStore } = await load();
    const file = [rider(1, "Elite"), rider(2, "Elite")];
    await expect(live.importIntoSharedRace(LOCAL, file, [2, 3])).rejects.toThrow("Nothing was imported. No connection to the server. Try again.");
    expect(useRiderStore.getState().riders).toHaveLength(0);
    answer = "applied";
    await live.importIntoSharedRace(LOCAL, file.map((r) => ({ ...r })), [2, 3]);
    await live.importIntoSharedRace(LOCAL, [rider(9, "Elite")], [2]); // a different file gets its own id
    expect(sent).toHaveLength(2);
    expect(sent[0].actionId).not.toBe(sent[1].actionId);
  });
});
