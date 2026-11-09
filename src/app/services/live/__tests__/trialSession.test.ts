/**
 * Quick Trial Access on the device: a trial never replaces a signed-in account, a new
 * device gets a trial session, and an ended trial drops ONLY the trial session and leaves
 * a notice (so the judge sees "trial ended", not a sign-in wall).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (sub: string) => `${b64url({ alg: "HS256" })}.${b64url({ sub, sid: "s" })}.sig`;
const trialUser = { id: "t1", email: null, name: "Trial judge 1", identities: [], trial: { raceUuid: "11111111-1111-1111-1111-111111111111", expiresAt: "2026-11-11T10:00:00.000Z" } };

let handler: (url: string, init?: RequestInit) => Response | undefined;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

async function load(session?: unknown) {
  vi.resetModules();
  localStorage.clear();
  if (session) localStorage.setItem("commissaire.live.session", JSON.stringify(session));
  return import("../liveClient");
}

beforeEach(() => {
  handler = () => undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => handler(url, init) ?? json({ error: { code: "unavailable", message: "n/a" } }, 503)));
});

describe("trial session", () => {
  it("never starts a trial over a signed-in account", async () => {
    const live = await load({ accessToken: jwt("u1"), refreshToken: "r", user: { id: "u1", email: "a@x.test", name: "A", identities: [] } });
    const start = vi.fn();
    handler = (url) => (url.includes("/trial/") ? (start(), json({})) : undefined);
    await expect(live.trial.start("tok")).rejects.toMatchObject({ code: "signed_in" });
    expect(start).not.toHaveBeenCalled();
    expect(live.useLiveStore.getState().user!.id).toBe("u1");
  });

  it("a new device gets the trial user's session", async () => {
    const live = await load();
    handler = (url) => (url.includes("/trial/tok/start") ? json({ accessToken: jwt("t1"), refreshToken: "r", user: trialUser, raceUuid: trialUser.trial.raceUuid }, 201) : undefined);
    const r = await live.trial.start("tok");
    expect(r.raceUuid).toBe(trialUser.trial.raceUuid);
    expect(live.isTrialUser()).toBe(true);
  });

  it("trial_ended drops the trial session and leaves the notice", async () => {
    const live = await load({ accessToken: jwt("t1"), refreshToken: "r", user: trialUser });
    handler = () => json({ error: { code: "trial_ended", message: "ended" } }, 403);
    await expect(live.api("GET", "/races")).rejects.toMatchObject({ code: "trial_ended" });
    expect(live.isSignedIn()).toBe(false);
    expect(localStorage.getItem("commissaire.trial.ended")).toBeTruthy();
  });

  it("a permanent account's 403 never signs it out", async () => {
    const live = await load({ accessToken: jwt("u1"), refreshToken: "r", user: { id: "u1", email: "a@x.test", name: "A", identities: [] } });
    handler = () => json({ error: { code: "trial_ended", message: "ended" } }, 403);
    await expect(live.api("GET", "/races")).rejects.toBeTruthy();
    expect(live.isSignedIn()).toBe(true);
    expect(localStorage.getItem("commissaire.trial.ended")).toBeNull();
  });
});
