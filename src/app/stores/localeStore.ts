import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─────────────────────────────────────────────────────────────────────────────
// Locale packs = the per-language "upload matching vocabulary" (CSV field
// keywords, club aliases, spoken numbers, export labels). One JSON file per
// language under public/data/locales/. English (`baseLocale`) is always shipped
// and always merged in; any extra language (e.g. Hebrew) lives in its own file
// so it can be added/removed from a build just by shipping/omitting that file
// and its line in index.json. Later this can be swapped for a DB/API endpoint —
// only the fetch URLs in this store change.
// ─────────────────────────────────────────────────────────────────────────────

export type NumType = "unit" | "ten10" | "tens" | "hundred" | "thousand";

export interface LocalePack {
  locale: string;
  country: string;
  label: string;
  dir: "ltr" | "rtl";
  fieldKeywords: Record<string, string[]>;
  spokenNumbers: Record<string, { value: number; type: NumType }>;
  exportLabels: Record<string, string>;
  clubAliases: Record<string, string[]>;
}

export interface LocaleInfo {
  locale: string;
  label: string;
  country: string;
  dir: "ltr" | "rtl";
}

export interface LocaleIndex {
  baseLocale: string;
  defaultLocale: string;
  locales: LocaleInfo[];
  countryToLocale: Record<string, string>;
  fieldPriority: Record<string, number>;
}

const BASE_URL = import.meta.env.BASE_URL || "/";
const localesUrl = (file: string) => `${BASE_URL}data/locales/${file}`;

async function fetchJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(localesUrl(file));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`Locale file not available: ${file}`, err);
    return null;
  }
}

/** Concatenate two keyword maps, de-duplicating each field's list. */
function mergeKeywords(
  base: Record<string, string[]>,
  extra: Record<string, string[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(extra)])) {
    out[key] = Array.from(new Set([...(base[key] || []), ...(extra[key] || [])]));
  }
  return out;
}

interface LocaleStore {
  index: LocaleIndex | null;
  baseLocale: string;
  activeLocale: string;
  packs: Record<string, LocalePack>; // in-memory cache (not persisted)
  loading: boolean;

  /** Load index.json + base pack + active pack. Safe to call repeatedly. */
  init: () => Promise<void>;
  /** Switch active language, loading its pack if needed. */
  setLocale: (locale: string) => Promise<void>;
  /** Resolve a locale from an ISO country code (e.g. "IL" → "he"). */
  localeForCountry: (country: string) => string;

  // Merged views (base English + active language). Active wins on key clashes.
  getFieldKeywords: () => Record<string, string[]>;
  getSpokenNumbers: () => Record<string, { value: number; type: NumType }>;
  getExportLabels: () => Record<string, string>;
  getClubAliases: () => Record<string, string[]>;
  getFieldPriority: () => Record<string, number>;
  getDir: () => "ltr" | "rtl";
}

async function ensurePack(
  get: () => LocaleStore,
  set: (partial: Partial<LocaleStore>) => void,
  locale: string
): Promise<void> {
  if (get().packs[locale]) return;
  const pack = await fetchJson<LocalePack>(`${locale}.json`);
  if (pack) set({ packs: { ...get().packs, [locale]: pack } });
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set, get) => ({
      index: null,
      baseLocale: "en",
      activeLocale: "en",
      packs: {},
      loading: false,

      init: async () => {
        set({ loading: true });
        const index = await fetchJson<LocaleIndex>("index.json");
        const baseLocale = index?.baseLocale || "en";
        // Persisted activeLocale may be a language that is no longer shipped;
        // fall back to base in that case.
        const shipped = new Set((index?.locales || []).map((l) => l.locale));
        const wanted = get().activeLocale;
        const activeLocale =
          index && !shipped.has(wanted) ? baseLocale : wanted || index?.defaultLocale || "en";

        set({ index, baseLocale, activeLocale });
        await ensurePack(get, set, baseLocale);
        if (activeLocale !== baseLocale) await ensurePack(get, set, activeLocale);
        set({ loading: false });
      },

      setLocale: async (locale) => {
        set({ loading: true });
        await ensurePack(get, set, locale);
        // If the pack failed to load, keep the base locale rather than break.
        const ok = !!get().packs[locale] || locale === get().baseLocale;
        set({ activeLocale: ok ? locale : get().baseLocale, loading: false });
      },

      localeForCountry: (country) =>
        get().index?.countryToLocale[country?.toUpperCase()] || get().baseLocale,

      getFieldKeywords: () => {
        const { packs, baseLocale, activeLocale } = get();
        const base = packs[baseLocale]?.fieldKeywords || {};
        if (activeLocale === baseLocale) return base;
        return mergeKeywords(base, packs[activeLocale]?.fieldKeywords || {});
      },

      getSpokenNumbers: () => {
        const { packs, baseLocale, activeLocale } = get();
        const base = packs[baseLocale]?.spokenNumbers || {};
        if (activeLocale === baseLocale) return base;
        return { ...base, ...(packs[activeLocale]?.spokenNumbers || {}) };
      },

      getExportLabels: () => {
        const { packs, baseLocale, activeLocale } = get();
        const active = packs[activeLocale]?.exportLabels;
        return active || packs[baseLocale]?.exportLabels || {};
      },

      getClubAliases: () => {
        const { packs, baseLocale, activeLocale } = get();
        const base = packs[baseLocale]?.clubAliases || {};
        if (activeLocale === baseLocale) return base;
        return { ...base, ...(packs[activeLocale]?.clubAliases || {}) };
      },

      getFieldPriority: () => get().index?.fieldPriority || {},

      getDir: () => {
        const { packs, activeLocale } = get();
        return packs[activeLocale]?.dir || "ltr";
      },
    }),
    {
      name: "locale-store",
      // Only remember which language the user picked — packs are re-fetched.
      partialize: (state) => ({ activeLocale: state.activeLocale }),
    }
  )
);
