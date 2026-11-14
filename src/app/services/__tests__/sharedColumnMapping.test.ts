import { describe, expect, it } from "vitest";
import { autoMapColumns } from "../csvMapper";
import {
  isIdentityHeader,
  MAPPABLE_FIELDS,
  normalizeHeader,
  resolveHeaderVotes,
  type SharedMappingView,
} from "../../../shared/import/columnMapping";
import type { RiderFieldKey } from "@/types/csv.types";

const view = (header: string, v: Partial<SharedMappingView>): [string, SharedMappingView] => [
  normalizeHeader(header),
  { header: normalizeHeader(header), mine: null, suggestion: null, conflict: false, ...v },
];
const byColumn = async (headers: string[], shared?: Map<string, SharedMappingView>) =>
  Object.fromEntries((await autoMapColumns(headers, [headers.map(() => "x")], shared)).map((m) => [m.sourceColumn, m]));

describe("normalizeHeader (Hebrew / English)", () => {
  it("folds quotes, geresh, punctuation, niqqud, case and spaces", () => {
    expect(normalizeHeader("מס׳ רוכב")).toBe("מס רוכב");
    expect(normalizeHeader("מס' רוכב ")).toBe("מס רוכב");
    expect(normalizeHeader("מס. רוכב")).toBe("מס רוכב");
    expect(normalizeHeader("שֵׁם פְּרָטִי")).toBe("שם פרטי");
    expect(normalizeHeader("  Rider   Number:")).toBe("rider number");
    expect(normalizeHeader("ＢＩＢ")).toBe("bib"); // full-width
  });
  it("recognises identity-document headers", () => {
    for (const h of ["ת.ז", "ת\"ז", "תעודת זהות", "Passport", "National ID", "ID"]) expect(isIdentityHeader(h)).toBe(true);
    for (const h of ["מספר רוכב", "Rider Number", "UCI ID"]) expect(isIdentityHeader(h)).toBe(false);
  });
  it("every shareable field is a real import field (checked by the compiler)", () => {
    const fields: readonly RiderFieldKey[] = MAPPABLE_FIELDS;
    expect(fields).not.toContain("infoField"); // per-file choice, never shared
  });
});

describe("resolveHeaderVotes", () => {
  it("one other user is not enough; two agreeing make a suggestion", () => {
    expect(resolveHeaderVotes("h", { mine: null, others: { bibNumber: 1 } }).suggestion).toBeNull();
    expect(resolveHeaderVotes("h", { mine: null, others: { bibNumber: 2 } }).suggestion).toEqual({ field: "bibNumber", users: 2 });
  });
  it("disagreement → conflict, no suggestion; a 3× majority still suggests", () => {
    expect(resolveHeaderVotes("h", { mine: null, others: { bibNumber: 2, standing: 1 } })).toMatchObject({ suggestion: null, conflict: true });
    expect(resolveHeaderVotes("h", { mine: null, others: { bibNumber: 3, standing: 1 } })).toMatchObject({ suggestion: { field: "bibNumber" }, conflict: false });
  });
});

describe("built-in dictionary: the common Hebrew / English headers", () => {
  it("maps bib and name headers without any learning", async () => {
    const m = await byColumn(["מספר רוכב", "שם פרטי", "שם משפחה", "קטגוריה"]);
    expect([m["מספר רוכב"].targetField, m["שם פרטי"].targetField, m["שם משפחה"].targetField]).toEqual(["bibNumber", "firstName", "lastName"]);
    expect((await byColumn(["מספר חזה", "שם"]))["מספר חזה"].targetField).toBe("bibNumber");
    expect((await byColumn(["Rider Number", "Name"]))["Rider Number"].targetField).toBe("bibNumber");
  });
});

describe("autoMapColumns + shared dictionary", () => {
  it("my own confirmed mapping wins over the built-in guess", async () => {
    const m = await byColumn(["Number", "Name"], new Map([view("Number", { mine: "standing" })]));
    expect(m["Number"]).toMatchObject({ targetField: "standing", source: "personal", needsConfirmation: false });
  });

  it("others' suggestion fills an unknown column, but must be confirmed", async () => {
    const m = await byColumn(["Bib", "Zxqv Wxyz"], new Map([view("Zxqv Wxyz", { suggestion: { field: "notes", users: 3 } })]));
    expect(m["Zxqv Wxyz"]).toMatchObject({ targetField: "notes", source: "shared", sharedUsers: 3, needsConfirmation: true });
  });

  it("others' suggestion never overrides a confident built-in match", async () => {
    const m = await byColumn(["שם פרטי", "Bib"], new Map([view("שם פרטי", { suggestion: { field: "lastName", users: 5 } })]));
    expect(m["שם פרטי"].targetField).toBe("firstName");
    expect(m["שם פרטי"].source).toBeUndefined();
  });

  it("a contested header suggests nothing and is flagged", async () => {
    const m = await byColumn(["Bib", "Mystery"], new Map([view("Mystery", { conflict: true })]));
    expect(m["Mystery"]).toMatchObject({ targetField: null, sharedConflict: true });
  });

  it("identity columns stay unmapped even if a mapping exists", async () => {
    const m = await byColumn(["Bib", "תעודת זהות"], new Map([view("תעודת זהות", { mine: "notes" })]));
    expect(m["תעודת זהות"].targetField).toBeNull();
  });
});
