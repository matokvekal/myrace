/**
 * Guest access to ONE race through its share link: plain fetches of the public,
 * read-only endpoints (server/src/public/routes.ts). No session, no auth header,
 * no socket, no IndexedDB — a guest never touches management APIs or local data.
 */
import type { SharedCategory, SharedRace, SharedRider } from "../../../shared/race/state";

const API = `${String(import.meta.env.VITE_SERVER_URL ?? "").replace(/\/$/, "")}/api/v1/public`;

export interface PublicPolling {
  open: boolean;
  endsAt: number | null;
  intervalMs: number;
}
export interface PublicRace {
  lastSeq: number;
  serverTime: number;
  polling: PublicPolling;
  race: Partial<SharedRace>;
  categories: SharedCategory[];
  riders: Partial<SharedRider>[];
}
export interface PublicChanges {
  lastSeq: number;
  serverTime: number;
  polling: PublicPolling;
  unchanged?: boolean;
  full?: boolean;
  race?: Partial<SharedRace>;
  categories?: SharedCategory[];
  riders?: Partial<SharedRider>[];
}

export class PublicApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API + path, { credentials: "omit", cache: "no-store" });
  } catch {
    throw new PublicApiError(0, "offline", "No connection to the server");
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new PublicApiError(r.status, body?.error?.code ?? "error", body?.error?.message ?? `Request failed (${r.status})`);
  }
  return (await r.json()) as T;
}

const enc = encodeURIComponent;
export const fetchPublicRace = (token: string) => get<PublicRace>(`/races/${enc(token)}`);
export const fetchPublicChanges = (token: string, afterSeq: number) => get<PublicChanges>(`/races/${enc(token)}/changes?afterSeq=${afterSeq}`);
