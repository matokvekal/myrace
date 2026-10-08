import { TERMS_VERSION } from "./terms";

/**
 * Persisted record of the user accepting the Terms & Conditions (BUGS.md #16).
 * Single source of truth for "has this user agreed to the current terms".
 */

const KEY = "termsAcceptance";

interface AcceptanceRecord {
  version: string;
  acceptedAt: string; // ISO timestamp
}

/** True when the user has accepted the CURRENT terms version. */
export function hasAcceptedCurrentTerms(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const rec = JSON.parse(raw) as AcceptanceRecord;
    return rec.version === TERMS_VERSION;
  } catch {
    return false;
  }
}

/** Record acceptance of the current terms version. */
export function acceptCurrentTerms(): void {
  try {
    const rec: AcceptanceRecord = {
      version: TERMS_VERSION,
      acceptedAt: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* storage unavailable — the gate will simply ask again next time */
  }
}
