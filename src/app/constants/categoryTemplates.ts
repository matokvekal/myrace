import { CategoryTemplate } from "@/types/types";

/**
 * The built-in category "bank" offered when building a race's categories.
 *
 * Single source of truth (BUGS.md #5): this list used to be copy-pasted, byte
 * for byte, into both `Categories.tsx` and `CategoryManager.tsx`. Edit it here.
 *
 * Each age band is its own standalone flat category — no sub-categories
 * ("Man Masters 30-39", not "Man Masters" + "30-39"). See BUGS.md #2.
 */
export const MASTERS_AGE_BANDS = ["19-29", "30-39", "40-49", "50-59", "60+"];

export const PREDEFINED_CATEGORY_TEMPLATES: CategoryTemplate[] = [
  {
    id: "man-juniors",
    name: "Man Juniors",
    subCategories: [],
    color: "#63A6FC",
    createdAt: new Date(),
    lastUsed: new Date()
  },
  {
    id: "woman-juniors",
    name: "Woman Juniors",
    subCategories: [],
    color: "#E05585",
    createdAt: new Date(),
    lastUsed: new Date()
  },
  // Masters are one category per age band — no sub-categories (BUGS.md #2)
  ...MASTERS_AGE_BANDS.map((band) => ({
    id: `man-masters-${band}`,
    name: `Man Masters ${band}`,
    subCategories: [],
    color: "#3EDDA4",
    createdAt: new Date(),
    lastUsed: new Date()
  })),
  ...MASTERS_AGE_BANDS.map((band) => ({
    id: `woman-masters-${band}`,
    name: `Woman Masters ${band}`,
    subCategories: [],
    color: "#FFC300",
    createdAt: new Date(),
    lastUsed: new Date()
  })),
  {
    id: "man-elite",
    name: "Man Elite",
    subCategories: [],
    color: "#9D4EDD",
    createdAt: new Date(),
    lastUsed: new Date()
  },
  {
    id: "woman-elite",
    name: "Woman Elite",
    subCategories: [],
    color: "#FF006E",
    createdAt: new Date(),
    lastUsed: new Date()
  }
];
