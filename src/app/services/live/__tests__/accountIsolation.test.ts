/**
 * Account isolation on one device (regression for the 0.1.14 service-worker bug:
 * a cached GET /me showed a previous account's email; cached race lists/snapshots).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** A JWT-shaped token for `sub` (the client only reads the payload; the server verifies). */
const jwt = (sub: string) => `${b64url({ alg: "HS256" })}.${b64url({ sub, sid: "s" })}.sig`;
const userOf = (id: string) => ({ id, email: `${id}@x.test`, name: id, identities: [] });
const sessionJson = (tokenSub: string, profileId = tokenSub) =>
  JSON.stringify({ accessToken: jwt(tokenSub), refreshToken: "r", user: userOf(profileId) });

type Handler = (url: string, init?: RequestInit) => Response | undefined;
let handler: Handler;
let calls: { url: string; init?: RequestInit }[];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

async function load(session?: string) {
  vi.resetModules();
  localStorage.clear();
  if (session) localStorage.setItem("commissaire.live.session", session);
  return import("../liveClient");
}

beforeEach(() => {
  calls = [];
  handler = () => undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init) ?? json({ error: { code: "unavailable", message: "n/a" } }, 503);
  }));
});

describe("the displayed user is always the token's account", () => {
  it("a stored profile of another account is dropped at start-up (tokens kept)", async () => {
    const live = await load(sessionJson("mictavim", "giladdlv"));
    const u = live.useLiveStore.getState().user!;
    expect(u.id).toBe("mictavim");
    expect(u.email).toBeNull();
    expect(live.isSignedIn()).toBe(true);
  });

  it("GET /me answering for another account (a cached response) is refused", async () => {
    const live = await load(sessionJson("mictavim"));
    handler = (url) => (url.endsWith("/me") ? json(userOf("giladdlv")) : undefined);
    await expect(live.auth.me()).rejects.toMatchObject({ code: "stale_profile" });
    expect(live.useLiveStore.getState().user!.id).toBe("mictavim");
    expect(live.useLiveStore.getState().user!.email).toBe("mictavim@x.test");
  });

  it("GET /me for the token's account refreshes the profile", async () => {
    const live = await load(sessionJson("mictavim", "giladdlv"));
    handler = (url) => (url.endsWith("/me") ? json(userOf("mictavim")) : undefined);
    await live.auth.me();
    expect(live.useLiveStore.getState().user!.email).toBe("mictavim@x.test");
  });

  it("every API request bypasses the HTTP cache", async () => {
    const live = await load(sessionJson("mictavim"));
    handler = (url) => (url.endsWith("/me") ? json(userOf("mictavim")) : undefined);
    await live.auth.me();
    const me = calls.find((c) => c.url.endsWith("/me"))!;
    expect(me.init?.cache).toBe("no-store");
  });
});

describe("cached API responses are purged", () => {
  it("removes /api and /socket.io entries from every cache, keeps static files", async () => {
    const store = new Map<string, Map<string, Response>>([
      ["commissire-v2", new Map([
        ["https://commissaire.us/api/v1/me", json(userOf("giladdlv"))],
        ["https://commissaire.us/api/v1/races", json({ races: [] })],
        ["https://commissaire.us/socket.io/?EIO=4", json({})],
        ["https://commissaire.us/assets/index-abc.js", new Response("js")],
      ])],
    ]);
    vi.stubGlobal("caches", {
      keys: async () => [...store.keys()],
      open: async (name: string) => {
        const m = store.get(name)!;
        return { keys: async () => [...m.keys()].map((u) => new Request(u)), delete: async (r: Request) => m.delete(r.url) };
      },
    });
    const live = await load(sessionJson("mictavim"));
    await live.purgeApiCache();
    expect([...store.get("commissire-v2")!.keys()]).toEqual(["https://commissaire.us/assets/index-abc.js"]);
    vi.unstubAllGlobals();
  });
});

describe("switching accounts on one device", () => {
  it("clears the previous account's per-race access (owner flags) on sign-in as another account", async () => {
    const live = await load(sessionJson("giladdlv"));
    localStorage.setItem("commissaire.live.access.race-a", JSON.stringify({ isOwner: true }));
    live.useLiveStore.setState({ access: { "race-a": { isOwner: true } as never } });
    handler = (url) =>
      url.endsWith("/auth/login") ? json({ accessToken: jwt("mictavim"), refreshToken: "r2", user: userOf("mictavim") }) : undefined;
    await live.auth.login("mictavim@x.test", "pw");
    expect(localStorage.getItem("commissaire.live.access.race-a")).toBeNull();
    expect(live.useLiveStore.getState().access).toEqual({});
    expect(live.useLiveStore.getState().user!.id).toBe("mictavim");
  });

  it("signing in again as the same account keeps its access cache", async () => {
    const live = await load(sessionJson("mictavim"));
    localStorage.setItem("commissaire.live.access.race-a", JSON.stringify({ isOwner: true }));
    handler = (url) =>
      url.endsWith("/auth/login") ? json({ accessToken: jwt("mictavim"), refreshToken: "r2", user: userOf("mictavim") }) : undefined;
    await live.auth.login("mictavim@x.test", "pw");
    expect(localStorage.getItem("commissaire.live.access.race-a")).not.toBeNull();
  });

  it("another account's downloaded race is not listed before this account's list arrives", async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem("commissaire.live.session", sessionJson("mictavim"));
    localStorage.setItem("commissaire.live.links", JSON.stringify({ "local-of-giladdlv": { serverRaceUuid: "srv-g", lastSeq: 0, linkedAt: "x" } }));
    localStorage.setItem("commissaire.live.accountRaces.giladdlv", JSON.stringify(["srv-g"]));
    const live = await import("../liveClient");
    expect(live.raceVisibleToAccount("local-of-giladdlv")).toBe(false);
    expect(live.raceVisibleToAccount("never-uploaded")).toBe(true);
  });
});

describe("My Races sync", () => {
  it("lists only the server's races for this account; one failing race doesn't stop the rest", async () => {
    const live = await load(sessionJson("mictavim"));
    handler = (url) => {
      if (url.endsWith("/races")) {
        return json({
          races: [
            { race: { uuid: "srv-1", name: "Race 1" }, access: { isOwner: true, roles: [] } },
            { race: { uuid: "srv-2", name: "Race 2" }, access: { isOwner: true, roles: [] } },
          ],
          removed: [],
        });
      }
      return undefined; // snapshots fail (503)
    };
    const r = await live.syncMyRaces();
    expect(r.total).toBe(2);
    expect(calls.filter((c) => c.url.endsWith("/races"))).toHaveLength(1);
    expect(calls.find((c) => c.url.endsWith("/races"))!.init?.cache).toBe("no-store");
    expect(live.raceVisibleToAccount("srv-1")).toBe(true); // linked under this account
    expect(live.raceVisibleToAccount("srv-2")).toBe(true);
  });

  it("concurrent syncs share one request", async () => {
    const live = await load(sessionJson("mictavim"));
    handler = (url) => (url.endsWith("/races") ? json({ races: [], removed: [] }) : undefined);
    const [a, b] = await Promise.all([live.syncMyRaces(), live.syncMyRaces()]);
    expect(a).toBe(b);
    expect(calls.filter((c) => c.url.endsWith("/races"))).toHaveLength(1);
  });
});
