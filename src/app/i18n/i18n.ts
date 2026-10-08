import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import HttpBackend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";

// English lives inline as the `t(key, "English default")` fallback at every
// call site, so it never needs its own JSON file or network request. Every
// other language is fetched on demand from public/locales/<lng>/common.json
// (same flat-JSON pattern as public/data/dictionary_csv.json) only once the
// user actually switches away from English — keeps the initial bundle/cost
// at zero for the default path (CLAUDE.md bundle-size discipline).
export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", flag: "gb" },
  { code: "es", label: "Español", flag: "es" },
  { code: "fr", label: "Français", flag: "fr" },
  { code: "de", label: "Deutsch", flag: "de" },
  { code: "it", label: "Italiano", flag: "it" },
  { code: "zh", label: "中文", flag: "cn" },
  { code: "ja", label: "日本語", flag: "jp" },
  { code: "hi", label: "हिन्दी", flag: "in" },
] as const;

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    ns: ["common"],
    defaultNS: "common",
    partialBundledLanguages: true,
    resources: { en: { common: {} } }, // no fetch for English — defaults come from t() calls
    backend: {
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}/{{ns}}.json`,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "commissaire.language",
      caches: ["localStorage"],
    },
    // Translation keys use flat dotted strings ("scan.list") as literal keys,
    // not nested-object paths — disable i18next's default "." path traversal
    // so lookups match the flat public/locales/*.json files exactly.
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false }, // missing/loading translations fall back to the default text, never blank the UI
  });

export default i18n;
