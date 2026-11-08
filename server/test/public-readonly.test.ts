import { describe, expect, it } from "vitest";
import { publicRouter } from "../src/public/routes.js";

/** 0.3.2: the guest (no account) API behind public Board / Results links is strictly read-only. */
describe("public guest API", () => {
  it("has only GET routes", () => {
    const routes = (publicRouter.stack as { route?: { path: string; methods: Record<string, boolean> } }[])
      .filter((l) => l.route)
      .map((l) => ({ path: l.route!.path, methods: Object.keys(l.route!.methods) }));
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(r.methods, r.path).toEqual(["get"]);
  });
});
