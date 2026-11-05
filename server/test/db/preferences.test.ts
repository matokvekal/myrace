/** Per-organizer preferences (user_preferences): own only, upsert, validated. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, auth, newUser, startServer, stopServer, type TestUser } from "./helpers";

let a: TestUser, b: TestUser;
beforeAll(async () => {
  await startServer();
  [a, b] = await Promise.all([newUser("PrefA"), newUser("PrefB")]);
});
afterAll(() => stopServer());

describe("GET/PUT /api/v1/me/preferences/:key", () => {
  it("stores, replaces and reads a user's own preference; another user sees nothing", async () => {
    expect((await api().get("/api/v1/me/preferences/finish_groups").set(auth(a.token))).body).toEqual({ key: "finish_groups", value: null });
    const v1 = { races: { r1: [["masters men", "masters women"]] } };
    expect((await api().put("/api/v1/me/preferences/finish_groups").set(auth(a.token)).send({ value: v1 })).status).toBe(200);
    const v2 = { races: { r1: [["level 2 men", "level 2 women"]] } };
    await api().put("/api/v1/me/preferences/finish_groups").set(auth(a.token)).send({ value: v2 });
    expect((await api().get("/api/v1/me/preferences/finish_groups").set(auth(a.token))).body.value).toEqual(v2);
    expect((await api().get("/api/v1/me/preferences/finish_groups").set(auth(b.token))).body.value).toBeNull();
  });

  it("needs sign-in, a valid key and a bounded size", async () => {
    expect((await api().get("/api/v1/me/preferences/finish_groups")).status).toBe(401);
    expect((await api().get("/api/v1/me/preferences/Bad Key").set(auth(a.token))).status).toBe(400);
    const big = { s: "x".repeat(70 * 1024) };
    expect((await api().put("/api/v1/me/preferences/finish_groups").set(auth(a.token)).send({ value: big })).status).toBe(413);
  });
});
