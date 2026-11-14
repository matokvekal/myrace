/**
 * Phase 2 — shared column-mapping dictionary (/api/v1/me/column-mappings, migration 015):
 * normalized headers, provenance per user, my mapping for me only, others' only as an
 * agreed suggestion (never who), contested headers give nothing, identity headers refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/db/pool";
import { api, auth, newUser, startServer, stopServer, type TestUser } from "./helpers";

let a: TestUser, b: TestUser, c: TestUser, d: TestUser, e: TestUser;
beforeAll(async () => {
  await startServer();
  [a, b, c, d, e] = await Promise.all(["MapA", "MapB", "MapC", "MapD", "MapE"].map((n) => newUser(n)));
});
afterAll(stopServer);

const save = (u: TestUser, mappings: { header: string; field: string }[]) =>
  api().post("/api/v1/me/column-mappings").set(auth(u.token)).send({ mappings });
const read = async (u: TestUser, ...headers: string[]) => {
  const q = headers.map((h) => `h=${encodeURIComponent(h)}`).join("&");
  const r = await api().get(`/api/v1/me/column-mappings?${q}`).set(auth(u.token));
  expect(r.status).toBe(200);
  return r.body.mappings as { header: string; mine: string | null; suggestion: { field: string; users: number } | null; conflict: boolean }[];
};
const uniq = () => `ph2 ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`;

describe("shared column mappings", () => {
  it("needs a signed-in user", async () => {
    expect((await api().get("/api/v1/me/column-mappings?h=x")).status).toBe(401);
  });

  it("my confirmation applies to me; one other user's is NOT a suggestion for everyone", async () => {
    const h = `מספר חזה ${uniq()}`;
    expect((await save(a, [{ header: h, field: "bibNumber" }])).body).toEqual({ saved: 1 });
    expect((await read(a, h))[0]).toMatchObject({ mine: "bibNumber", suggestion: null, conflict: false });
    expect((await read(b, h))[0]).toMatchObject({ mine: null, suggestion: null, conflict: false });
  });

  it("two organizers agreeing → a suggestion (with a count, no identities); spellings are normalized", async () => {
    const base = uniq();
    await save(a, [{ header: `מס׳ רוכב ${base}`, field: "bibNumber" }]);
    await save(b, [{ header: `מס' רוכב  ${base}`, field: "bibNumber" }]);
    const [view] = await read(c, `מס רוכב ${base}`);
    expect(view.suggestion).toEqual({ field: "bibNumber", users: 2 });
    expect(JSON.stringify(view)).not.toContain(a.id);
  });

  it("contested header → no suggestion, flagged as conflict; a clear majority still suggests", async () => {
    const h = `Number ${uniq()}`;
    await save(a, [{ header: h, field: "bibNumber" }]);
    await save(b, [{ header: h, field: "standing" }]);
    expect((await read(c, h))[0]).toMatchObject({ suggestion: null, conflict: true });

    const h2 = `Rider No ${uniq()}`;
    for (const u of [a, b, c]) await save(u, [{ header: h2, field: "bibNumber" }]);
    await save(d, [{ header: h2, field: "standing" }]);
    expect((await read(e, h2))[0]).toMatchObject({ suggestion: { field: "bibNumber", users: 3 }, conflict: false });
  });

  it("a user's new answer replaces their old one (provenance kept: times and dates)", async () => {
    const h = `Seed ${uniq()}`;
    await save(a, [{ header: h, field: "bibNumber" }]);
    await save(a, [{ header: h, field: "bibNumber" }]);
    let [row] = await db.query<{ field: string; timesConfirmed: number }>(`SELECT field, "timesConfirmed" FROM column_mappings WHERE "userId" = $1 AND header = $2`, [a.id, h.toLowerCase()]);
    expect(row).toEqual({ field: "bibNumber", timesConfirmed: 2 });
    await save(a, [{ header: h, field: "standing" }]);
    [row] = await db.query(`SELECT field, "timesConfirmed" FROM column_mappings WHERE "userId" = $1 AND header = $2`, [a.id, h.toLowerCase()]);
    expect(row).toEqual({ field: "standing", timesConfirmed: 1 });
    expect((await read(a, h))[0].mine).toBe("standing");
  });

  it("refuses identity-document headers and unknown fields; never lists identity headers", async () => {
    expect((await save(a, [{ header: "תעודת זהות", field: "notes" }])).status).toBe(400);
    expect((await save(a, [{ header: "Passport", field: "notes" }])).status).toBe(400);
    expect((await save(a, [{ header: `x ${uniq()}`, field: "nationalId" }])).status).toBe(400);
    expect(await read(a, "ת.ז")).toEqual([]);
  });
});
