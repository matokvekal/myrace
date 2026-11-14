import {
  isIdentityHeader,
  isMappableField,
  normalizeHeader,
  type SharedMappingView,
} from "../../shared/import/columnMapping";
import type { RiderFieldKey } from "@/types/csv.types";

/**
 * Phase 2 — the shared column-mapping dictionary, client side (server: /me/column-mappings).
 * ONE request per import (all headers at once), only for a signed-in user of a server build,
 * with a short timeout: the import never waits on it and works the same offline.
 */

const serverConfigured = () => !!import.meta.env.VITE_SERVER_URL;
const TIMEOUT_MS = 2500;

async function live() {
  if (!serverConfigured()) return null;
  const mod = await import("./live/liveClient");
  return mod.isSignedIn() ? mod : null;
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/** header (normalized) → view; empty when signed out / offline / older server. */
export async function fetchSharedMappings(headers: string[]): Promise<Map<string, SharedMappingView>> {
  const out = new Map<string, SharedMappingView>();
  const wanted = [...new Set(headers.map(normalizeHeader).filter((h) => h && !isIdentityHeader(h)))].slice(0, 80);
  if (!wanted.length) return out;
  try {
    const client = await live();
    if (!client) return out;
    const q = wanted.map((h) => `h=${encodeURIComponent(h)}`).join("&");
    const res = await withTimeout(client.api<{ mappings: SharedMappingView[] }>("GET", `/me/column-mappings?${q}`), TIMEOUT_MS);
    for (const m of res.mappings ?? []) out.set(m.header, m);
  } catch {
    // offline / timeout / older server: the import goes on with the built-in dictionary
  }
  return out;
}

/**
 * Records mappings the organizer explicitly chose to remember. Returns true when the server
 * stored them (shared across this account's devices, and counted toward suggestions).
 */
export async function rememberSharedMappings(pairs: { header: string; field: RiderFieldKey }[]): Promise<boolean> {
  const mappings = pairs.filter((p) => isMappableField(p.field) && !isIdentityHeader(p.header) && normalizeHeader(p.header));
  if (!mappings.length) return false;
  try {
    const client = await live();
    if (!client) return false;
    await withTimeout(client.api("POST", "/me/column-mappings", { mappings: mappings.slice(0, 50) }), TIMEOUT_MS * 2);
    return true;
  } catch {
    return false;
  }
}

export { normalizeHeader };
