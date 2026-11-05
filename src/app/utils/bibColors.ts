import type { CategoryProps, RiderProps } from "@/types/types";

/**
 * Bib (plate) colours: a background and a digit/text colour, each set on the
 * category (default for its riders) and optionally overridden per rider.
 * Stored normalized as "#RRGGBB"; entered as a hex value or a colour name
 * (English or Hebrew). Unset = the plain bib display.
 */
const NAMED: Record<string, string> = {
  white: "#FFFFFF", black: "#000000", red: "#E53935", orange: "#FB8C00", yellow: "#FDD835", green: "#43A047",
  blue: "#1E88E5", "light blue": "#039BE5", "sky blue": "#039BE5", navy: "#1A237E", "dark blue": "#1A237E",
  purple: "#8E24AA", violet: "#8E24AA", pink: "#F06292", magenta: "#D81B60", brown: "#6D4C41", grey: "#757575",
  gray: "#757575", silver: "#BDBDBD", gold: "#FFB300", turquoise: "#00ACC1", cyan: "#00ACC1", teal: "#00897B",
  lime: "#C0CA33", olive: "#827717", beige: "#F5F5DC",
  לבן: "#FFFFFF", שחור: "#000000", אדום: "#E53935", כתום: "#FB8C00", צהוב: "#FDD835", ירוק: "#43A047",
  כחול: "#1E88E5", תכלת: "#039BE5", "כחול כהה": "#1A237E", סגול: "#8E24AA", ורוד: "#F06292", חום: "#6D4C41",
  אפור: "#757575", כסף: "#BDBDBD", זהב: "#FFB300", טורקיז: "#00ACC1",
};

/** "#abc" / "#AABBCC" / "aabbcc" / a colour name → "#AABBCC"; anything else → null. */
export function normalizeColor(input: string | null | undefined): string | null {
  const v = String(input ?? "").trim();
  if (!v) return null;
  const named = NAMED[v.toLowerCase().replace(/\s+/g, " ")];
  if (named) return named;
  const hex = v.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`;
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${hex.split("").map((c) => c + c).join("").toUpperCase()}`;
  return null;
}

/** Black or white, whichever reads better on the background (WCAG relative luminance). */
export function contrastText(bg: string): string {
  const n = normalizeColor(bg);
  if (!n) return "#000000";
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.179 ? "#000000" : "#FFFFFF";
}

/** The bib colours to display for a rider: rider override → category default → none. */
export function resolveBibColors(
  rider: Pick<RiderProps, "bibColor" | "bibTextColor">,
  category?: Pick<CategoryProps, "bibColor" | "bibTextColor"> | null
): { bg: string; fg: string } | null {
  const bg = normalizeColor(rider.bibColor) ?? normalizeColor(category?.bibColor);
  const fgSet = normalizeColor(rider.bibTextColor) ?? normalizeColor(category?.bibTextColor);
  if (!bg && !fgSet) return null;
  const background = bg ?? "#FFFFFF";
  return { bg: background, fg: fgSet ?? contrastText(background) };
}
