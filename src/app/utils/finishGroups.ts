import type { CategoryProps } from "@/types/types";

/**
 * Finish Group (stored in `category.linkGroup`): empty = None, the category has
 * its own bell and finish; categories with the same value share them, whatever
 * their wave. New assignments are numbers ("1", "2", …); older free-text values
 * ("Masters") are kept and shown as they are.
 */
export function finishGroupLabel(value: string | null | undefined): string {
  const v = value?.trim();
  return v ? `Finish Group ${v}` : "None";
}

/** Dropdown values: "" (None), "1"…"n" (at least 3, one free number past the highest used), then any legacy text values. */
export function finishGroupOptions(categories: Pick<CategoryProps, "linkGroup">[]): string[] {
  const used = categories.map((c) => c.linkGroup?.trim() ?? "").filter(Boolean);
  const maxNum = Math.max(0, ...used.filter((v) => /^\d+$/.test(v)).map(Number));
  const count = Math.max(3, maxNum + 1);
  const legacy = [...new Set(used.filter((v) => !/^\d+$/.test(v)))].sort();
  return ["", ...Array.from({ length: count }, (_, i) => String(i + 1)), ...legacy];
}
