/**
 * liveClient session handling around /auth/refresh (2026-11-13 production sign-out):
 * expired access token → one coordinated refresh → retry; transient failures keep the
 * session; another tab's refresh / sign-out is adopted through the storage event.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

const KEY = "commissaire.live.session";
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (sub: string, n: string) => `${b64url({ alg: "HS256" })}.${b64url({ sub, sid: n })}.sig`;
const user = { id: "u1", email: "u1@x.test", name: "U", identities: [] };
const stored = (n: string, extra: Record<string, unknown> = {}) => JSON.stringify({ accessToken: jwt("u1", n), refreshToken: `rt-${n}`, user, ...extra });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
let handler: Handler;
let calls: { url: string; init?: RequestInit }[];
const bearer = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.authorization;
const refreshCalls = () => calls.filter((c) => c.url.endsWith("/auth/refresh"));
const bodyOf = (c: { init?: RequestInit }) => JSON.parse(String(c.init?.body)) as { refreshToken: string; requestId?: string };

async function load(session: string | null = stored("1")) {
  vi.resetModules();
  localStorage.clear();
  if (session) localStorage.setItem(KEY, session);
  return import("../liveClient");
}

beforeEach(() => {
  calls = [];
  handler = () => undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return (await handler(url, init)) ?? json({ error: { code: "unavailable" } }, 503);
  }));
});

/** /me answers only for the access token of session "2"; refresh hands out session "2". */
const meNeeds2: Handler = (url, init) => {
  if (url.endsWith("/auth/refresh")) return json({ accessToken: jwt("u1", "2"), refreshToken: "rt-2" });
  if (url.endsWith("/me")) return bearer(init) === `Bearer ${jwt("u1", "2")}` ? json(user) : json({ error: { code: "unauthorized" } }, 401);
  return undefined;
};

describe("expired access token", () => {
  it("refreshes once, stores the new tokens and retries the request", async () => {
    const live = await load();
    handler = meNeeds2;
    await expect(live.api("GET", "/me")).resolves.toMatchObject({ id: "u1" });
    expect(refreshCalls()).toHaveLength(1);
    expect(bodyOf(refreshCalls()[0]).refreshToken).toBe("rt-1");
    expect(bodyOf(refreshCalls()[0]).requestId).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    const s = JSON.parse(localStorage.getItem(KEY)!);
    expect(s.refreshToken).toBe("rt-2");
    expect(s.refreshRequestId).toBeUndefined();
  });

  it("several requests failing with 401 at once share ONE refresh", async () => {
    const live = await load();
    handler = meNeeds2;
    await Promise.all([live.api("GET", "/me"), live.api("GET", "/me"), live.api("GET", "/me")]);
    expect(refreshCalls()).toHaveLength(1);
  });
});

describe("transient refresh failures do not sign out", () => {
  it.each([503, 429, 502])("refresh answers %s → still signed in, the call fails as offline", async (status) => {
    const live = await load();
    handler = (url) => (url.endsWith("/auth/refresh") ? new Response("<html>", { status }) : json({ error: { code: "unauthorized" } }, 401));
    await expect(live.api("GET", "/me")).rejects.toMatchObject({ status: 0, code: "offline" });
    expect(live.isSignedIn()).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!).refreshToken).toBe("rt-1");
  });

  it("connection lost during refresh → kept, and the retry sends the SAME requestId (lost-answer replay)", async () => {
    const live = await load();
    handler = (url) => {
      if (url.endsWith("/auth/refresh")) throw new TypeError("Failed to fetch");
      return json({ error: { code: "unauthorized" } }, 401);
    };
    await expect(live.api("GET", "/me")).rejects.toMatchObject({ code: "offline" });
    expect(live.isSignedIn()).toBe(true);
    handler = meNeeds2;
    await expect(live.api("GET", "/me")).resolves.toMatchObject({ id: "u1" });
    const [first, retry] = refreshCalls().map(bodyOf);
    expect(retry.refreshToken).toBe(first.refreshToken);
    expect(retry.requestId).toBe(first.requestId);
  });

  it("the server's 401 on refresh (revoked session) signs this device out", async () => {
    const live = await load();
    handler = () => json({ error: { code: "unauthorized" } }, 401);
    await expect(live.api("GET", "/me")).rejects.toMatchObject({ status: 401 });
    expect(live.isSignedIn()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("a refresh that never answers", () => {
  it("is abandoned after REFRESH_TIMEOUT_MS: still signed in, the cross-tab lock is released, the next try works", async () => {
    const live = await load();
    vi.useFakeTimers();
    try {
      handler = (url, init) => {
        if (url.endsWith("/auth/refresh")) {
          return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
        }
        return json({ error: { code: "unauthorized" } }, 401);
      };
      const hung = live.api("GET", "/me");
      const settled = expect(hung).rejects.toMatchObject({ code: "offline" });
      await vi.advanceTimersByTimeAsync(live.REFRESH_TIMEOUT_MS + 10);
      await settled;
      expect(live.isSignedIn()).toBe(true);
      handler = meNeeds2; // the retry (same requestId) is not blocked by the abandoned one
      await expect(live.api("GET", "/me")).resolves.toMatchObject({ id: "u1" });
      const [first, retry] = refreshCalls().map(bodyOf);
      expect(retry.requestId).toBe(first.requestId);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("another tab", () => {
  it("signed in as ANOTHER account: this tab reloads (no previous account's state kept in memory)", async () => {
    await load();
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      localStorage.setItem(KEY, JSON.stringify({ accessToken: jwt("u2", "9"), refreshToken: "rt-other", user: { ...user, id: "u2" } }));
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
      expect(reload).toHaveBeenCalled(); // (once per module copy: tests re-import liveClient, the app loads it once)
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("refreshed meanwhile: this tab adopts its tokens and never sends the rotated one", async () => {
    const live = await load();
    // Tab B rotated rt-1 → rt-2 and stored it; this tab still holds rt-1 in memory.
    localStorage.setItem(KEY, stored("2"));
    handler = (url, init) => {
      if (url.endsWith("/auth/refresh")) return json({ error: { code: "unauthorized" } }, 401); // would be reuse
      return meNeeds2(url, init);
    };
    await expect(live.api("GET", "/me")).resolves.toMatchObject({ id: "u1" });
    expect(refreshCalls()).toHaveLength(0);
  });

  it("storage event: the new session is used right away; a sign-out there signs this tab out", async () => {
    const live = await load();
    localStorage.setItem(KEY, stored("2"));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    handler = meNeeds2;
    await live.api("GET", "/me");
    expect(bearer(calls.at(-1)!.init)).toBe(`Bearer ${jwt("u1", "2")}`);
    expect(refreshCalls()).toHaveLength(0);

    localStorage.removeItem(KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(live.isSignedIn()).toBe(false);
    expect(live.useLiveStore.getState().user).toBeNull();
  });
});
