/**
 * public/sw.js: account data is never cached or answered from a cache (regression:
 * v2 served a cached /api/v1/me of the previous account on a shared phone).
 * Runs the real file against a fake service-worker global.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../../../../../public/sw.js"), "utf8");
const ORIGIN = "https://commissaire.us";

type Listener = (e: unknown) => void;
let listeners: Record<string, Listener>;
let store: Map<string, Map<string, Response>>;
let skipWaiting: ReturnType<typeof vi.fn>;

function fakeCaches() {
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    const key = (r: Request | string) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
    return {
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      match: async (r: Request | string) => m.get(key(r))?.clone(),
      put: async (r: Request | string, res: Response) => void m.set(key(r), res),
      delete: async (r: Request | string) => m.delete(key(r)),
      add: async (u: string) => void m.set(key(u), new Response("shell")),
    };
  };
  return {
    open,
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
    match: async (r: Request | string) => {
      for (const n of store.keys()) {
        const hit = await (await open(n)).match(r);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

function boot() {
  listeners = {};
  skipWaiting = vi.fn();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, l: Listener) => (listeners[t] = l),
    skipWaiting,
    clients: { claim: vi.fn(async () => {}) },
  };
  new Function("self", "caches", "fetch", SRC)(self, fakeCaches(), (globalThis as { fetch: typeof fetch }).fetch);
}

async function dispatchFetch(url: string, mode: RequestMode = "cors") {
  let responded: Promise<Response> | null = null;
  const request = { url, method: "GET", mode } as unknown as Request;
  listeners.fetch({ request, respondWith: (p: Promise<Response>) => (responded = p) });
  return responded ? await responded : null;
}

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("fetch", vi.fn(async () => {
    const r = new Response("net", { status: 200 });
    Object.defineProperty(r, "type", { value: "basic" });
    return r;
  }));
  boot();
});

describe("service worker: account data", () => {
  it("never answers /api/* or /socket.io/* (the browser goes to the network)", async () => {
    store.set("commissire-v4", new Map([[`${ORIGIN}/api/v1/me`, new Response('{"email":"other@x"}')]]));
    expect(await dispatchFetch(`${ORIGIN}/api/v1/me`)).toBeNull();
    expect(await dispatchFetch(`${ORIGIN}/api/v1/races`)).toBeNull();
    expect(await dispatchFetch(`${ORIGIN}/socket.io/?EIO=4&transport=polling`)).toBeNull();
  });

  it("static assets are still cached (offline app shell)", async () => {
    const r = await dispatchFetch(`${ORIGIN}/assets/index-abc.js`);
    expect(await r!.text()).toBe("net");
    await new Promise((res) => setTimeout(res, 0));
    expect(store.get("commissire-v4")!.has(`${ORIGIN}/assets/index-abc.js`)).toBe(true);
  });

  it("activates at once and drops the v2 cache's API responses, keeping its static files", async () => {
    listeners.install({ waitUntil: () => {} });
    expect(skipWaiting).toHaveBeenCalled();
    store.set("commissire-v3", new Map([
      [`${ORIGIN}/api/v1/me`, new Response("giladdlv")],
      [`${ORIGIN}/api/v1/races/x/snapshot`, new Response("private")],
      [`${ORIGIN}/assets/old-chunk.js`, new Response("old")],
    ]));
    let done: Promise<unknown> = Promise.resolve();
    listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(store.has("commissire-v3")).toBe(false);
    const v3 = [...store.get("commissire-v4")!.keys()];
    expect(v3).toContain(`${ORIGIN}/assets/old-chunk.js`);
    expect(v3.some((u) => u.includes("/api/"))).toBe(false);
  });
});
