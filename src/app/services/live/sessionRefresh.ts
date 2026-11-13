/**
 * One refresh of the shared server session at a time, across every tab of this origin.
 *
 * Why (production, 2026-11-13 15:31 UTC): the server rotates the refresh token on every
 * use and treats an already-rotated token as stolen — it revokes EVERY session of the
 * account (laptop and phone alike). Each tab used to keep its own in-memory copy of the
 * session, so tab B refreshed with the token tab A had already rotated, and everyone was
 * signed out. Now:
 *   1. a Web Lock (`navigator.locks`) lets only one tab refresh at a time;
 *   2. inside the lock the LATEST stored session is read first — if another tab already
 *      rotated the token this tab held, this tab adopts it instead of refreshing;
 *   3. a random `requestId` is saved with the session BEFORE the request is sent; a retry
 *      after a lost answer sends the same token + requestId and the server replays its
 *      answer (server/src/auth/tokens.ts) instead of calling it reuse;
 *   4. only the server's refusal (401; 403 trial_ended ends a trial) ends the session; offline, 5xx, 429 and a
 *      garbled answer keep it (and the requestId) for the next try.
 *
 * Kept free of liveClient so it can be tested with fake tabs, storage and server.
 */

export interface RefreshableSession {
  accessToken: string;
  refreshToken: string;
  /** Saved before a refresh is sent; makes a retry after a lost answer provable. */
  refreshRequestId?: string;
}

/**
 * refreshed  — this call rotated the token (stored)
 * adopted    — another tab already had a newer token (stored); use it
 * signedOut  — the server refused the session, or another tab signed out (storage cleared)
 * trialEnded — 403 trial_ended (the caller ends the trial)
 * transient  — offline / 5xx / 429 / bad answer: session kept, try again later
 */
export type RefreshOutcome = "refreshed" | "adopted" | "signedOut" | "trialEnded" | "transient";

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface RefreshDeps<S extends RefreshableSession> {
  /** The latest session in shared storage (what every tab sees). */
  read(): S | null;
  /** Store (and publish to this tab) a session, or null to sign out. */
  write(s: S | null): void;
  /** POST /auth/refresh. Throws when there is no connection. */
  post(body: { refreshToken: string; requestId: string }): Promise<Response>;
  /** navigator.locks when the browser has it; without it the stored-token check still applies. */
  locks?: LockManagerLike | null;
  newRequestId?: () => string;
}

export const REFRESH_LOCK = "commissaire.auth.refresh";

export function newRefreshRequestId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Refreshes the session whose refresh token this tab holds (`heldRefreshToken`) —
 * unless another tab already did, in which case the newer stored session is adopted.
 */
export async function refreshSharedSession<S extends RefreshableSession>(heldRefreshToken: string, deps: RefreshDeps<S>): Promise<RefreshOutcome> {
  const run = () => refreshLocked(heldRefreshToken, deps);
  return deps.locks ? deps.locks.request(REFRESH_LOCK, run) : run();
}

async function refreshLocked<S extends RefreshableSession>(held: string, deps: RefreshDeps<S>): Promise<RefreshOutcome> {
  const latest = deps.read();
  if (!latest) return "signedOut"; // signed out in another tab meanwhile
  if (latest.refreshToken !== held) return "adopted"; // another tab rotated it: never send the old one

  // Reuse the requestId of an earlier unanswered try of THIS token (lost answer), else a new one,
  // saved before sending so a reload or another tab retries with the same proof.
  let requestId = latest.refreshRequestId;
  if (!requestId) {
    requestId = (deps.newRequestId ?? newRefreshRequestId)();
    deps.write({ ...latest, refreshRequestId: requestId });
  }

  let res: Response;
  try {
    res = await deps.post({ refreshToken: latest.refreshToken, requestId });
  } catch {
    return "transient"; // offline / connection dropped: the answer may be lost, keep the requestId
  }

  if (res.ok) {
    const t = (await res.json().catch(() => null)) as { accessToken?: unknown; refreshToken?: unknown } | null;
    const accessToken = t?.accessToken;
    const refreshToken = t?.refreshToken;
    if (typeof accessToken !== "string" || typeof refreshToken !== "string") return "transient"; // answer lost in transit
    // Signed out or switched account in another tab while this was in flight: never bring the old session back.
    const now = deps.read();
    if (!now) return "signedOut";
    if (now.refreshToken !== latest.refreshToken) return "adopted";
    const next = { ...now, accessToken, refreshToken } as S;
    delete next.refreshRequestId;
    deps.write(next);
    return "refreshed";
  }

  if (res.status === 403) {
    const code = ((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code;
    // The API's only 403 here is trial_ended; any other 403 comes from a proxy, not a verdict on the session.
    return code === "trial_ended" ? "trialEnded" : "transient";
  }

  if (res.status === 401) {
    // Only end the session this request was about: a newer one stored meanwhile stays.
    const now = deps.read();
    if (now && now.refreshToken !== latest.refreshToken) return "adopted";
    if (now) deps.write(null);
    return "signedOut";
  }

  return "transient"; // 5xx, 429, a proxy error page…: the session is not in question
}
