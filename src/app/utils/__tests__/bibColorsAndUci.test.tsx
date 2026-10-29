import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { contrastText, normalizeColor, resolveBibColors } from "../bibColors";
import { isValidUciId, normalizeUciId } from "../uciId";
import { rowToRider } from "@/services/riderRowMapper";
import BibBadge from "@/components/ui/BibBadge";
import type { ColumnMapping } from "@/types/csv.types";

const map = (cols: [string, ColumnMapping["targetField"]][]): ColumnMapping[] =>
  cols.map(([sourceColumn, targetField]) => ({ sourceColumn, targetField, confidence: 100, isAutoMapped: true, needsConfirmation: false }));

describe("bib colours", () => {
  it("normalizes names (English, Hebrew), hex and short hex; refuses anything else", () => {
    expect(normalizeColor("Blue")).toBe("#1E88E5");
    expect(normalizeColor("צהוב")).toBe("#FDD835");
    expect(normalizeColor("#1e88e5")).toBe("#1E88E5");
    expect(normalizeColor("abc")).toBe("#AABBCC");
    expect(normalizeColor("")).toBeNull();
    expect(normalizeColor("blurple")).toBeNull();
  });

  it("picks readable digits: white on dark, black on light", () => {
    expect(contrastText("#1A237E")).toBe("#FFFFFF");
    expect(contrastText("#FDD835")).toBe("#000000");
  });

  it("rider override → category default → plain; text colour defaults to the readable one", () => {
    const cat = { bibColor: "#1A237E", bibTextColor: null };
    expect(resolveBibColors({ bibColor: null, bibTextColor: null }, cat)).toEqual({ bg: "#1A237E", fg: "#FFFFFF" });
    expect(resolveBibColors({ bibColor: "#FDD835", bibTextColor: "#E53935" }, cat)).toEqual({ bg: "#FDD835", fg: "#E53935" });
    expect(resolveBibColors({ bibColor: null, bibTextColor: null }, null)).toBeNull();
  });

  it("BibBadge shows the bib in its colours, or plain when none are set", () => {
    const rider = { bibNumber: 42, bibColor: "red", bibTextColor: null, raceUuid: "r", category: "Elite", subCategory: null };
    render(<BibBadge rider={rider} category={null} />);
    const bib = screen.getByText("#42");
    expect(bib).toHaveAttribute("data-bib-colored", "true");
    expect(bib).toHaveStyle({ background: "#E53935" });
  });
});

describe("UCI ID", () => {
  it("is optional, 11 digits; spaces and dashes are stripped; other values are kept but invalid", () => {
    expect(normalizeUciId("100 123 456 78")).toBe("10012345678");
    expect(isValidUciId(normalizeUciId("10012345678"))).toBe(true);
    expect(isValidUciId(null)).toBe(true);
    expect(normalizeUciId("ISR123")).toBe("ISR123");
    expect(isValidUciId("ISR123")).toBe(false);
  });

  it("imports UCI ID and bib colours from a start list", () => {
    const rider = rowToRider(["7", "Dana", "100-123-456-78", "כחול", "white"], map([["bib", "bibNumber"], ["fn", "firstName"], ["uci", "uciNumber"], ["bc", "bibColor"], ["btc", "bibTextColor"]]), "race-1", 0);
    expect([rider.uciNumber, rider.bibColor, rider.bibTextColor]).toEqual(["10012345678", "#1E88E5", "#FFFFFF"]);
  });
});
