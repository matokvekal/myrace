/**
 * Cross-tab refresh (production sign-out of 2026-11-13: three "refresh token reuse"
 * warnings, every session of the account revoked). Fake tabs share one storage, one
 * Web Lock and one server that follows the real rules (server/src/auth/tokens.ts):
 * rotate on use, reuse of a rotated token revokes everything, except the exact replay
 * (same token + requestId) while the replacement is still unused.
 */
import { describe, it, expect } from "vitest";
import { refreshSharedSession, type RefreshDeps, type RefreshableSession } from "../sessionRefresh";

type S = RefreshableSession & { user: { id: string } };

/** In-memory model of the server's refresh rules. */
class FakeServer {
  private n = 0;
  sessions = new Map<string, { revoked: boolean; replacedBy: string | null; requestId: string | null }>();
  calls = 0;
  reuseRevocations = 0;
  /** Next answers to force: "lose" rotates but the device never gets the answer. */
  script: ("ok" | "lose" | "503" | "429" | "garbled" | "trial")[] = [];

  issue(): string {
    const t = `rt-${++this.n}`;
    this.sessions.set(t, { revoked: false, replacedBy: null, requestId: null });
    return t;
  }
  private revokeAll() {
    this.reuseRevocations++;
    for (const s of this.sessions.values()) s.revoked = true;
  }
  isValid(token: string) {
    const s = this.sessions.get(token);
    return !!s && !s.revoked && !s.replacedBy;
  }

  async post(body: { refreshToken: string; requestId?: string }): Promise<Response> {
    this.calls++;
    await Promise.resolve();
    const mode = this.script.shift() ?? "ok";
    if (mode === "503") return new Response("<html>bad gateway</html>", { status: 503 });
    if (mode === "429") return new Response("{}", { status: 429 });
    if (mode === "trial") return Response.json({ error: { code: "trial_ended" } }, { status: 403 });
    const s = this.sessions.get(body.refreshToken);
    if (!s) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
    let next: string;
    if (s.revoked || s.replacedBy) {
      const r = s.replacedBy ? this.sessions.get(s.replacedBy) : null;
      const replay = !!body.requestId && s.requestId === body.requestId && !!r && !r.revoked && !r.replacedBy;
      if (!replay) {
        this.revokeAll();
        return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
      }
      next = s.replacedBy!;
    } else {
      next = this.issue();
      s.replacedBy = next;
      s.requestId = body.requestId ?? null;
    }
    if (mode === "lose") throw new TypeError("Failed to fetch"); // rotated on the server, answer lost
    if (mode === "garbled") return new Response("{\"accessTo", { status: 200 });
    return Response.json({ accessToken: `at-for-${next}`, refreshToken: next });
  }
}

/** One mutex shared by every tab, like navigator.locks. */
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, cb: () => Promise<T>): Promise<T> {
      const run = tail.then(cb, cb);
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

/** Shared localStorage-like slot. */
function sharedStore(initial: S | null) {
  let raw = initial ? JSON.stringify(initial) : null;
  return {
    read: (): S | null => (raw ? (JSON.parse(raw) as S) : null),
    write: (s: S | null) => {
      raw = s ? JSON.stringify(s) : null;
    },
  };
}

function tab(server: FakeServer, store: ReturnType<typeof sharedStore>, locks: ReturnType<typeof fakeLocks> | null) {
  let ids = 0;
  const memory = { session: store.read() };
  const deps: RefreshDeps<S> = {
    read: store.read,
    write: (s) => {
      store.write(s);
      memory.session = s;
    },
    post: (b) => server.post(b),
    locks,
    newRequestId: () => `req-${Math.random().toString(36).slice(2)}-${++ids}-padding-xxxx`,
  };
  return {
    memory,
    /** What liveClient does: refresh with the token this tab holds, then adopt storage. */
    async refresh() {
      const out = await refreshSharedSession(memory.session!.refreshToken, deps);
      memory.session = store.read();
      return out;
    },
  };
}

function setup(withLocks = true) {
  const server = new FakeServer();
  const first = server.issue();
  const store = sharedStore({ accessToken: "at-0", refreshToken: first, user: { id: "u1" } });
  const locks = withLocks ? fakeLocks() : null;
  return { server, store, a: tab(server, store, locks), b: tab(server, store, locks) };
}

describe("two tabs share one session", () => {
  it("both tabs' access tokens expire together: one refresh, both adopt it, nobody is signed out", async () => {
    const { server, a, b, store } = setup();
    const [ra, rb] = await Promise.all([a.refresh(), b.refresh()]);
    expect([ra, rb].sort()).toEqual(["adopted", "refreshed"]);
    expect(server.calls).toBe(1);
    expect(server.reuseRevocations).toBe(0);
    expect(a.memory.session!.refreshToken).toBe(b.memory.session!.refreshToken);
    expect(server.isValid(store.read()!.refreshToken)).toBe(true);
  });

  it("a tab holding an already-rotated token (the production bug) adopts the stored one instead of sending it", async () => {
    const { server, a, b } = setup();
    await a.refresh(); // tab A rotates; tab B still holds the old token in memory
    expect(b.memory.session!.refreshToken).not.toBe(a.memory.session!.refreshToken);
    expect(await b.refresh()).toBe("adopted");
    expect(server.calls).toBe(1);
    expect(server.reuseRevocations).toBe(0);
    expect(b.memory.session).toEqual(a.memory.session);
  });

  it("many concurrent refreshes across tabs stay one chain (no reuse) — also without Web Locks when sequential", async () => {
    const { server, a, b } = setup();
    for (let i = 0; i < 5; i++) await Promise.all([a.refresh(), b.refresh(), a.refresh()]);
    expect(server.reuseRevocations).toBe(0);
    expect(server.calls).toBe(5);

    const noLocks = setup(false);
    await noLocks.a.refresh();
    expect(await noLocks.b.refresh()).toBe("adopted"); // the stored-token check alone prevents the reuse
    expect(noLocks.server.reuseRevocations).toBe(0);
  });
});

describe("transient failures keep the session", () => {
  it.each(["503", "429"] as const)("HTTP %s: session and stored token unchanged", async (code) => {
    const { server, a, store } = setup();
    const before = store.read()!.refreshToken;
    server.script = [code];
    expect(await a.refresh()).toBe("transient");
    expect(store.read()!.refreshToken).toBe(before);
    expect(await a.refresh()).toBe("refreshed");
    expect(server.reuseRevocations).toBe(0);
  });

  it("offline (fetch throws before reaching the server): kept, next try works", async () => {
    const { server, a, store } = setup();
    const offline: RefreshDeps<S>["post"] = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await refreshSharedSession(store.read()!.refreshToken, { read: store.read, write: store.write, post: offline })).toBe("transient");
    expect(store.read()).not.toBeNull();
    expect(await a.refresh()).toBe("refreshed");
    expect(server.reuseRevocations).toBe(0);
  });
});

describe("lost refresh answers", () => {
  it("rotated on the server but the answer never arrived: the retry replays it (same requestId), no sign-out", async () => {
    const { server, a, store } = setup();
    server.script = ["lose"];
    expect(await a.refresh()).toBe("transient");
    const pending = store.read()!;
    expect(pending.refreshRequestId).toBeTruthy(); // kept for the retry
    expect(await a.refresh()).toBe("refreshed");
    expect(server.reuseRevocations).toBe(0);
    const now = store.read()!;
    expect(server.isValid(now.refreshToken)).toBe(true);
    expect(now.refreshRequestId).toBeUndefined();
  });

  it("a garbled 200 is treated as lost, and another tab can finish the retry", async () => {
    const { server, a, b, store } = setup();
    server.script = ["garbled"];
    expect(await a.refresh()).toBe("transient");
    expect(await b.refresh()).toBe("refreshed"); // same stored token + requestId → replay
    expect(server.reuseRevocations).toBe(0);
    expect(server.isValid(store.read()!.refreshToken)).toBe(true);
  });
});

describe("server security is unchanged", () => {
  it("genuine reuse (a stolen old token, no requestId) revokes every session; the device is then signed out", async () => {
    const { server, a, store } = setup();
    const stolen = store.read()!.refreshToken;
    await a.refresh();
    const attacker = await server.post({ refreshToken: stolen });
    expect(attacker.status).toBe(401);
    expect(server.reuseRevocations).toBe(1);
    expect(await a.refresh()).toBe("signedOut");
    expect(store.read()).toBeNull();
  });

  it("a stolen token + requestId cannot replay once the replacement was used", async () => {
    const { server, a, store } = setup();
    server.script = ["lose"];
    await a.refresh();
    const copy = store.read()!;
    await a.refresh(); // replay → replacement handed over
    await a.refresh(); // the device uses it: replacement rotated
    const replay = await server.post({ refreshToken: copy.refreshToken, requestId: copy.refreshRequestId });
    expect(replay.status).toBe(401);
    expect(server.reuseRevocations).toBe(1);
  });

  it("403 trial_ended is reported, not a silent keep", async () => {
    const { server, a } = setup();
    server.script = ["trial"];
    expect(await a.refresh()).toBe("trialEnded");
  });

  it("signed out in another tab while a refresh was in flight: the answer doesn't bring the session back", async () => {
    const { a, store } = setup();
    const deps: RefreshDeps<S> = {
      read: store.read,
      write: store.write,
      post: async (body) => {
        store.write(null); // the other tab's Logout lands meanwhile
        return Response.json({ accessToken: "x", refreshToken: `${body.refreshToken}-next` });
      },
    };
    expect(await refreshSharedSession(a.memory.session!.refreshToken, deps)).toBe("signedOut");
    expect(store.read()).toBeNull();
  });
});
