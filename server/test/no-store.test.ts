/** Account isolation, no database: no API answer may be cached (browser, service worker, proxy). */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("API responses are never cacheable", () => {
  const app = createApp();
  it("public endpoint: no-store + Vary: Authorization", async () => {
    const r = await request(app).get("/api/v1/time");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["vary"]).toMatch(/Authorization/i);
  });
  it("account endpoints (signed out → 401) are no-store too", async () => {
    for (const path of ["/api/v1/me", "/api/v1/races"]) {
      const r = await request(app).get(path);
      expect(r.status).toBe(401);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["vary"]).toMatch(/Authorization/i);
    }
  });
  it("an unknown API path is no-store too", async () => {
    const r = await request(app).get("/api/v1/nothing-here");
    expect(r.headers["cache-control"]).toBe("no-store");
  });
});
