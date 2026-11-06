/**
 * Multi-user client for shared races (loaded on demand, only when VITE_SERVER_URL
 * is set). Local races never reach this module.
 *
 *  - Session: password / Google / email-code sign-in, access + refresh tokens.
 *  - Links: a local race ↔ its server race (localStorage, see liveBridge).
 *  - Outbox: every Action is written to IndexedDB (`live_outbox`) before it is
 *    sent; entries leave only when the server answered (AD-4). Each entry keeps
 *    its race, so switching races never mixes queues (AD-20).
 *  - Sync: HTTP batches up, Socket.IO down; a gap in the sequence or a reconnect
 *    fetches /changes. Server rows are applied through the stores with
 *    `applyingRemote` (no echo) and order-preserving `patchRiders` (AD-15).
 *  - Bridge: store writes on a shared race become Actions, after the shared
 *    access rules say the member may do them.
 */
import { io, type Socket } from "socket.io-client";
import { toast } from "react-toastify";
import { create } from "zustand";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import useRaceStore from "@/stores/racesStore";
import type { CategoryProps, RaceProps, RiderProps } from "@/types/types";
import { DEMO_RACE_UUID } from "@/utils/demoSeed";
import { authorizeAction, type EffectiveAccess, type MemberPermissions } from "../../../shared/race/access";
import { PROTOCOL_VERSION, type RaceAction } from "../../../shared/race/actions";
import type { MemberRole } from "../../../shared/race/roles";
import { RACE_INFO_FIELDS, RIDER_IDENTITY_FIELDS, type RaceState, type SharedCategory, type SharedRace, type SharedRider } from "../../../shared/race/state";
import { buildCategoriesFromRiders, riderCategoryKey } from "@/utils/categoriesFromRiders";
import { duplicateIds, newLocalId } from "@/utils/localId";
import { describeProblems, importProblems, type ImportProblem } from "./importCheck";
import { applyingRemote, LIVE_ACCESS_EVENT, LIVE_LINKS_KEY, readLinks, setLiveBridge, type LiveBridge, type LiveLink } from "./liveBridge";

const SERVER = String(import.meta.env.VITE_SERVER_URL ?? "").replace(/\/$/, "");
const API = `${SERVER}/api/v1`;
import { SESSION_EVENT, SESSION_KEY } from "../../live/sessionPresence";
const ACCESS_KEY_PREFIX = "commissaire.live.access.";
const ACCESS_KEY = (local: string) => `${ACCESS_KEY_PREFIX}${local}`;
/** The account last signed in on this device: a different one clears the per-account state. */
const LAST_USER_KEY = "commissaire.live.lastUserId";
const DEVICE_KEY = "commissaire.live.deviceId";

// ---------------------------------------------------------------------------
// State visible to the UI

export interface LiveUser {
  id: string;
  email: string | null;
  name: string;
  identities: { provider: string; email: string | null; emailVerified: boolean }[];
}

export interface AccessSummary {
  isOwner: boolean;
  /** 0.2: the race's original creator — the only one who deletes it for everyone (absent from older servers). */
  isCreator?: boolean;
  /** 0.2: members (judges) may change race data in this race (owner's per-race switch). */
  memberWrites?: boolean;
  roles: MemberRole[];
  permissions: MemberPermissions;
  screens: EffectiveAccess["screens"];
  waves: number[] | null;
  categories: string[] | null;
}

export interface RaceSync {
  pending: number;
  notApplied: { actionId: string; type: string; reason: string }[];
  revoked: boolean;
  lastSyncAt: number | null;
}

interface LiveState {
  user: LiveUser | null;
  online: boolean;
  socketConnected: boolean;
  needsUpdate: boolean;
  openRace: string | null;
  sync: Record<string, RaceSync>;
  access: Record<string, AccessSummary>;
  /** New races still waiting to upload: the last error, by local race uuid. */
  publishErrors: Record<string, string>;
  /** Bumped when the signed-in account's race list changes (My Races filter). */
  accountRacesVersion: number;
}

export const useLiveStore = create<LiveState>(() => ({
  user: null,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  socketConnected: false,
  needsUpdate: false,
  openRace: null,
  sync: {},
  access: {},
  publishErrors: {},
  accountRacesVersion: 0,
}));

const syncOf = (local: string): RaceSync => useLiveStore.getState().sync[local] ?? { pending: 0, notApplied: [], revoked: false, lastSyncAt: null };
const setSync = (local: string, patch: Partial<RaceSync>) =>
  useLiveStore.setState((s) => ({ sync: { ...s.sync, [local]: { ...syncOf(local), ...patch } } }));

// ---------------------------------------------------------------------------
// Session and HTTP

interface Session {
  accessToken: string;
  refreshToken: string;
  user: LiveUser;
}

/**
 * The account the access token was issued to (JWT `sub`): the only identity the
 * server ever acts as. The displayed user must always be this account; a profile
 * for any other id is stale (e.g. a cached GET /me from a previous account) and is
 * never shown. Null when the token is not a JWT (tests) or can't be read.
 */
export function tokenSubject(token: string | undefined | null): string | null {
  try {
    const part = token?.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="))) as { sub?: unknown };
    return typeof json.sub === "string" || typeof json.sub === "number" ? String(json.sub) : null;
  } catch {
    return null;
  }
}
/** Does this profile belong to the account the session's token was issued to? */
const profileMatchesToken = (s: Session | null, u: { id: string } | null | undefined): boolean => {
  const sub = tokenSubject(s?.accessToken);
  return !sub || (!!u && String(u.id) === sub);
};

let session: Session | null = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    // A session whose stored profile is another account's (written from a cached
    // /me before this fix): keep the tokens, drop the wrong profile; /me refills it.
    if (s && !profileMatchesToken(s, s.user)) {
      const fixed: Session = { ...s, user: { id: tokenSubject(s.accessToken)!, email: null, name: "", identities: [] } };
      localStorage.setItem(SESSION_KEY, JSON.stringify(fixed));
      return fixed;
    }
    return s;
  } catch {
    return null;
  }
})();
useLiveStore.setState({ user: session?.user ?? null });
if (session) localStorage.setItem(LAST_USER_KEY, String(session.user.id));

function saveSession(s: Session | null) {
  session = s;
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
  useLiveStore.setState({ user: s?.user ?? null });
  window.dispatchEvent(new Event(SESSION_EVENT)); // route guards (live/sessionPresence.ts)
}

export class LiveApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refreshTokens(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${API}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: session!.refreshToken }),
      });
      if (!r.ok) {
        saveSession(null);
        return false;
      }
      const t = (await r.json()) as { accessToken: string; refreshToken: string };
      saveSession({ ...session!, accessToken: t.accessToken, refreshToken: t.refreshToken });
      return true;
    } catch {
      return false; // offline: keep the session, try later
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  let r: Response;
  try {
    r = await fetch(API + path, {
      method,
      headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store", // account data: never from the HTTP cache
    });
  } catch {
    throw new LiveApiError(0, "offline", "No connection to the server");
  }
  if (r.status === 401 && retry && session && (await refreshTokens())) return api<T>(method, path, body, false);
  const text = await r.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // An HTML error page from a proxy (502, maintenance) instead of the API's JSON.
    throw new LiveApiError(r.status, "bad_response", `The server isn't answering properly (${r.status}). Try again in a minute.`);
  }
  if (!r.ok) {
    const e = (data as { error?: { code?: string; message?: string } })?.error;
    throw new LiveApiError(r.status, e?.code ?? "error", e?.message ?? `Request failed (${r.status})`);
  }
  return data as T;
}

type AuthResponse = { accessToken: string; refreshToken: string; user: LiveUser };
export type CodeSent = { sent: boolean; remainingToday: number; resendAfterSeconds: number };
const signedIn = (r: AuthResponse) => {
  // Another account than the last one on this device: drop the previous account's
  // per-race state (owner flags, sync, upload errors, open race) before anything loads.
  const prev = localStorage.getItem(LAST_USER_KEY);
  if (prev && prev !== String(r.user.id)) clearAccountState();
  localStorage.setItem(LAST_USER_KEY, String(r.user.id));
  saveSession({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
  void purgeApiCache();
  void flushAll();
  void publishPending();
  return r.user;
};

/**
 * Removes every cached API response from Cache Storage. The service worker of
 * 0.1.14 and older cached same-origin GETs, /api/* included, whoever was signed
 * in (a previous account's /me, race list and snapshots). Run at start-up, sign-in,
 * sign-out and before every race-list sync, so no account gets another's response.
 */
export async function purgeApiCache(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        if (/\/(api|socket\.io)\//.test(new URL(req.url).pathname)) await cache.delete(req);
      }
    }
  } catch {
    /* Cache Storage unavailable (private mode): nothing is cached there either */
  }
}

/** Per-account state that must not survive a switch to another account. Races on the device stay. */
function clearAccountState() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith(ACCESS_KEY_PREFIX)) localStorage.removeItem(k);
  }
  socket?.disconnect();
  socket = null;
  useLiveStore.setState({ access: {}, sync: {}, publishErrors: {}, openRace: null });
}

export const deviceId = (): string => {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
};

export const auth = {
  register: async (email: string, password: string, name: string) =>
    signedIn(await api<AuthResponse>("POST", "/auth/register", { email, password, name, deviceId: deviceId() })),
  login: async (email: string, password: string) =>
    signedIn(await api<AuthResponse>("POST", "/auth/login", { email, password, deviceId: deviceId() })),
  google: async (idToken: string) => signedIn(await api<AuthResponse>("POST", "/auth/google", { idToken, deviceId: deviceId() })),
  requestEmailCode: (email: string) => api<CodeSent>("POST", "/auth/email-code", { email }),
  /** Forgot password: emails a code to a registered address (3 a day, 60 s apart). */
  requestPasswordReset: (email: string) => api<CodeSent>("POST", "/auth/password-reset", { email }),
  /** Sets the new password with the emailed code, and signs in. */
  confirmPasswordReset: async (email: string, code: string, password: string) =>
    signedIn(await api<AuthResponse>("POST", "/auth/password-reset/confirm", { email, code, password, deviceId: deviceId() })),
  verifyEmailCode: async (email: string, code: string, name?: string) =>
    signedIn(await api<AuthResponse>("POST", "/auth/email-code/verify", { email, code, name, deviceId: deviceId() })),
  smsEnabled: async () => (await api<{ enabled: boolean }>("GET", "/auth/sms-code/enabled")).enabled,
  logout: async () => {
    try {
      await api("POST", "/auth/logout");
    } catch {
      /* offline or expired: still sign out locally */
    }
    socket?.disconnect();
    socket = null;
    saveSession(null);
    await purgeApiCache();
  },
  /** Refreshes the profile: only ever the token's own account (a stale cached /me is refused). */
  me: async () => {
    await purgeApiCache();
    const u = await api<LiveUser>("GET", "/me");
    if (!profileMatchesToken(session, u)) throw new LiveApiError(409, "stale_profile", "Profile does not match the signed-in account");
    if (session) saveSession({ ...session, user: u });
    return u;
  },
  updateName: async (name: string) => {
    const u = await api<LiveUser>("PATCH", "/me", { name });
    if (!profileMatchesToken(session, u)) throw new LiveApiError(409, "stale_profile", "Profile does not match the signed-in account");
    if (session) saveSession({ ...session, user: u });
    return u;
  },
};

export const isSignedIn = () => !!session;

// ---------------------------------------------------------------------------
// Links

const writeLinks = (links: Record<string, LiveLink>) => localStorage.setItem(LIVE_LINKS_KEY, JSON.stringify(links));
const linkOf = (local: string): LiveLink | undefined => readLinks()[local];
function setLink(local: string, patch: Partial<LiveLink> & { serverRaceUuid?: string }) {
  const links = readLinks();
  const isNew = !links[local];
  const cur = links[local] ?? { serverRaceUuid: patch.serverRaceUuid!, lastSeq: 0, linkedAt: new Date().toISOString() };
  links[local] = { ...cur, ...patch };
  writeLinks(links);
  // A race linked while signed in is one of this account's races (created, published or downloaded).
  const known = accountRaces();
  if (isNew && session) rememberAccountRaces([...(known ?? []), links[local].serverRaceUuid]);
}

// ---------------------------------------------------------------------------
// Which races on this device belong to the signed-in account. A device can be
// used by several accounts: My Races lists only this account's server races
// (plus races that were never uploaded). Learned from GET /races and from every
// race this account links; unknown (never synced here) = show them all.

const ACCOUNT_RACES_KEY = (userId: string) => `commissaire.live.accountRaces.${userId}`;
function accountRaces(): string[] | null {
  const uid = session?.user.id;
  if (!uid) return null;
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_RACES_KEY(uid)) ?? "null") as string[] | null;
  } catch {
    return null;
  }
}
function rememberAccountRaces(serverUuids: string[]) {
  const uid = session?.user.id;
  if (!uid) return;
  localStorage.setItem(ACCOUNT_RACES_KEY(uid), JSON.stringify([...new Set(serverUuids)]));
  useLiveStore.setState((s) => ({ accountRacesVersion: s.accountRacesVersion + 1 }));
}

/** May this local race be listed for the signed-in account? Signed out: no race is listed. */
export function raceVisibleToAccount(local: string): boolean {
  if (!session) return false;
  const link = readLinks()[local];
  if (!link) return true; // only on this device (never uploaded)
  // Unknown (this account never synced here): none of the device's server races,
  // they may be another account's, until the server's list arrives.
  const mine = accountRaces();
  return mine !== null && mine.includes(link.serverRaceUuid);
}

export interface ShareInfo {
  url: string;
  published: boolean;
}
const shareUrl = (token: string) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/share/${token}`;

/** The race's public read-only share link and whether it is published (owner only). The link works only while published. */
export async function shareLink(local: string): Promise<ShareInfo> {
  const link = readLinks()[local];
  if (!link) throw new LiveApiError(400, "not_shared", "Save this race to the server first, then share it.");
  const r = await api<{ token: string; published: boolean }>("GET", `/races/${link.serverRaceUuid}/share-link`);
  return { url: shareUrl(r.token), published: r.published };
}

/** Publish / unpublish the race (owner only). Unpublishing revokes public access at once. */
export async function setRacePublished(local: string, published: boolean): Promise<ShareInfo> {
  const link = readLinks()[local];
  if (!link) throw new LiveApiError(400, "not_shared", "Save this race to the server first.");
  const r = await api<{ token: string; published: boolean }>("PUT", `/races/${link.serverRaceUuid}/publication`, { published });
  return { url: shareUrl(r.token), published: r.published };
}

// ---------------------------------------------------------------------------
// Deleting a shared race. The server never removes rows: the owner's delete of an
// active race soft-deletes it for everyone; a finished race (or a member's delete)
// is hidden for this user only. Offline, the delete is queued and the local copy
// goes at once; sync never re-downloads a race with a queued delete.

const PENDING_DELETES_KEY = () => `commissaire.live.pendingDeletes.${session?.user.id ?? "anon"}`;
function readPendingDeletes(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_DELETES_KEY()) ?? "[]") as string[];
  } catch {
    return [];
  }
}
const writePendingDeletes = (list: string[]) => localStorage.setItem(PENDING_DELETES_KEY(), JSON.stringify([...new Set(list)]));

const isRaceDeleted = (err: unknown) => err instanceof LiveApiError && err.status === 410 && err.code === "race_deleted";

/** Remove a deleted (or hidden) shared race from this device: link, queued Actions, access cache and local data. */
export async function removeDeletedRace(local: string): Promise<void> {
  const queued = await outboxAll(local);
  await outboxDelete(queued.map((e) => e.actionId));
  detachRace(local);
  localStorage.removeItem(ACCESS_KEY(local));
  const cats = useCategoryStore.getState().categories.filter((c) => c.raceUuid === local);
  // Not linked any more, so the sync bridge sends nothing for these deletes. Race first (lifts a finalized lock).
  await useRaceStore.getState().deleteRace(local);
  for (const c of cats) await useCategoryStore.getState().deleteCategory(c.id);
  await useRiderStore.getState().deleteRidersByRace(local);
}

/** Delete (owner, active race) or hide (finished race / member) a shared race; works offline (queued). */
export async function deleteSharedRace(local: string): Promise<"race" | "hidden" | "queued"> {
  const link = readLinks()[local];
  if (!link) return "hidden";
  let outcome: "race" | "hidden" | "queued";
  try {
    const r = await api<{ deleted: "race" | "hidden" }>("DELETE", `/races/${link.serverRaceUuid}`);
    outcome = r.deleted;
  } catch (err) {
    if (isRaceDeleted(err) || (err instanceof LiveApiError && err.status === 404)) outcome = "race";
    else if (err instanceof LiveApiError && err.status === 0) {
      writePendingDeletes([...readPendingDeletes(), link.serverRaceUuid]);
      outcome = "queued";
    } else throw err;
  }
  await removeDeletedRace(local);
  return outcome;
}

let flushingDeletes: Promise<void> | null = null;
function flushPendingDeletes(): Promise<void> {
  if (!session) return Promise.resolve();
  flushingDeletes ??= (async () => {
    try {
      for (const serverUuid of readPendingDeletes()) {
        try {
          await api("DELETE", `/races/${serverUuid}`);
        } catch (err) {
          if (err instanceof LiveApiError && err.status === 0) return; // still offline: keep the queue
        }
        writePendingDeletes(readPendingDeletes().filter((u) => u !== serverUuid));
      }
    } finally {
      flushingDeletes = null;
    }
  })();
  return flushingDeletes;
}
export const localUuidOf = (serverRaceUuid: string): string | null =>
  Object.entries(readLinks()).find(([, l]) => l.serverRaceUuid === serverRaceUuid)?.[0] ?? null;

/** Stop sharing this race on this Device (detach). Local data and queued Actions stay. */
export function detachRace(local: string) {
  const links = readLinks();
  delete links[local];
  writeLinks(links);
  if (useLiveStore.getState().openRace === local) useLiveStore.setState({ openRace: null });
}

function cacheAccess(local: string, access: AccessSummary) {
  localStorage.setItem(ACCESS_KEY(local), JSON.stringify(access));
  useLiveStore.setState((s) => ({ access: { ...s.access, [local]: access } }));
  window.dispatchEvent(new CustomEvent(LIVE_ACCESS_EVENT, { detail: local }));
}
export function accessFor(local: string): AccessSummary | null {
  const inStore = useLiveStore.getState().access[local];
  if (inStore) return inStore;
  try {
    const a = JSON.parse(localStorage.getItem(ACCESS_KEY(local)) ?? "null") as AccessSummary | null;
    if (a) useLiveStore.setState((s) => ({ access: { ...s.access, [local]: a } }));
    return a;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Clock alignment (AD-9)

const CLOCK_KEY = "commissaire.live.clock";
/** Last measured offset to the server clock; kept so laps taken offline after a reload still use it. */
let clockOffsetMs: number = (() => {
  try {
    return Number(JSON.parse(localStorage.getItem(CLOCK_KEY) ?? "{}").offsetMs) || 0;
  } catch {
    return 0;
  }
})();
async function measureClock() {
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      const t0 = Date.now();
      const { now } = socket?.connected
        ? ((await socket.timeout(3000).emitWithAck("time", {})) as { now: number })
        : await api<{ now: number }>("GET", "/time");
      const t1 = Date.now();
      samples.push(now - (t0 + t1) / 2);
    } catch {
      /* keep the last offset */
    }
  }
  if (samples.length) {
    clockOffsetMs = Math.round(samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
    localStorage.setItem(CLOCK_KEY, JSON.stringify({ offsetMs: clockOffsetMs, measuredAt: new Date().toISOString() }));
  }
}

/** ISO time with the Device's local offset (the server shows wave starts on this clock). */
function localIso(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

// ---------------------------------------------------------------------------
// Outbox

interface OutboxEntry {
  actionId: string;
  localRaceUuid: string;
  serverRaceUuid: string;
  userId: string | null;
  createdAt: number;
  action: RaceAction;
  /**
   * 0.2: the server answered "not applied". The entry is KEPT (never silently dropped) for
   * the user to review; it is never sent again and leaves only when the user dismisses it
   * (or the race itself is removed from this device).
   */
  rejected?: { reason: string; seq: number | null; at: number };
}

async function outboxPut(e: OutboxEntry) {
  const db = await initIndexedDB();
  await db.put("live_outbox", e);
  db.close();
}
/** Every entry of a race, sent-pending and rejected. */
async function outboxAll(local: string): Promise<OutboxEntry[]> {
  const db = await initIndexedDB();
  const rows = (await db.getAllFromIndex("live_outbox", "byRace", local)) as OutboxEntry[];
  db.close();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}
/** Entries still waiting to be sent (rejected ones are kept apart, never re-sent). */
async function outboxList(local: string): Promise<OutboxEntry[]> {
  return (await outboxAll(local)).filter((e) => !e.rejected);
}

/** An Action the server did not apply, kept on this device for review (0.2). */
export interface RejectedAction {
  actionId: string;
  type: string;
  reason: string;
  reasonText: string;
  riderUuid: string | null;
  createdAt: number;
  rejectedAt: number;
}
const mine = (e: OutboxEntry) => e.userId === null || e.userId === session?.user.id;
/** This account's rejected Actions for a race, oldest first (another account's are never shown). */
export async function rejectedActions(local: string): Promise<RejectedAction[]> {
  return (await outboxAll(local)).filter((e) => e.rejected && mine(e)).map((e) => ({
    actionId: e.actionId,
    type: e.action.type,
    reason: e.rejected!.reason,
    reasonText: REASON_TEXT[e.rejected!.reason] ?? e.rejected!.reason,
    riderUuid: (e.action.payload as { riderUuid?: string }).riderUuid ?? null,
    createdAt: Math.floor(e.createdAt / 1000),
    rejectedAt: e.rejected!.at,
  }));
}
const toNotApplied = (list: RejectedAction[]): RaceSync["notApplied"] => list.map((r) => ({ actionId: r.actionId, type: r.type, reason: r.reason }));
/** The user reviewed these and lets them go. Only rejected entries of this account are removed. */
export async function dismissRejected(local: string, actionIds: string[]): Promise<void> {
  const ids = new Set(actionIds);
  const gone = (await outboxAll(local)).filter((e) => e.rejected && mine(e) && ids.has(e.actionId)).map((e) => e.actionId);
  await outboxDelete(gone);
  setSync(local, { notApplied: toNotApplied(await rejectedActions(local)) });
}
async function outboxDelete(ids: string[]) {
  if (!ids.length) return;
  const db = await initIndexedDB();
  const tx = db.transaction("live_outbox", "readwrite");
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
  db.close();
}

/** Riders with queued Actions: remote rows don't overwrite them until the queue is sent. */
const pendingRiders = new Map<string, Set<string>>();
const markPending = (local: string, action: RaceAction) => {
  const uuid = (action.payload as { riderUuid?: string }).riderUuid;
  if (!uuid) return;
  const set = pendingRiders.get(local) ?? new Set<string>();
  set.add(uuid);
  pendingRiders.set(local, set);
};

let seqCounter = 0;
/**
 * Queues one Action for a shared race: written to IndexedDB first, then sent.
 * Returns the actionId (callers keep it to undo a lap later).
 */
export async function dispatchAction(
  local: string,
  type: string,
  payload: Record<string, unknown>,
  opts: { atMs?: number; actionId?: string } = {},
): Promise<string> {
  const link = linkOf(local);
  if (!link) throw new Error("Not a shared race");
  const actionId = opts.actionId ?? crypto.randomUUID();
  const action = {
    actionId,
    raceUuid: link.serverRaceUuid,
    type,
    payload,
    deviceTime: localIso(opts.atMs ?? Date.now()),
    clockOffsetMs,
    deviceId: deviceId(),
    protocolVersion: PROTOCOL_VERSION,
  } as RaceAction;
  await outboxPut({ actionId, localRaceUuid: local, serverRaceUuid: link.serverRaceUuid, userId: session?.user.id ?? null, createdAt: Date.now() * 1000 + (seqCounter++ % 1000), action });
  markPending(local, action);
  setSync(local, { pending: syncOf(local).pending + 1 });
  scheduleFlush(local);
  return actionId;
}

const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const flushing = new Set<string>();
function scheduleFlush(local: string, delay = 50) {
  clearTimeout(flushTimers.get(local));
  flushTimers.set(local, setTimeout(() => void flush(local), delay));
}

const REASON_TEXT: Record<string, string> = {
  forbidden: "not allowed for your role",
  out_of_scope: "outside your waves/categories",
  locked: "locked (already started or finished)",
  invalid: "not valid any more",
  race_official: "the race is final — the owner can include it in an amendment",
  not_member: "you are no longer a member of this race",
  stale: "a newer correction of this rider replaced it",
};

/** Sends a race's queue in local order, one batch at a time. */
export async function flush(local: string): Promise<void> {
  if (flushing.has(local) || !session || !navigator.onLine) return;
  const link = linkOf(local);
  if (!link) return;
  flushing.add(local);
  try {
    for (;;) {
      // Only this account's entries (and ones queued while signed out) go with this account's token.
      const entries = (await outboxList(local)).filter((e) => e.userId === null || e.userId === session!.user.id).slice(0, 100);
      if (entries.length === 0) break;
      let results: { actionId: string | null; seq: number | null; applied: boolean; reason: string | null }[];
      try {
        ({ results } = await api<{ results: typeof results }>("POST", `/races/${link.serverRaceUuid}/actions`, { actions: entries.map((e) => e.action) }));
      } catch (err) {
        if (err instanceof LiveApiError && err.status === 426) useLiveStore.setState({ needsUpdate: true });
        if (err instanceof LiveApiError && err.status === 404) setSync(local, { revoked: true });
        if (isRaceDeleted(err)) {
          await removeDeletedRace(local); // deleted by its owner: nothing queued here can bring it back
          return;
        }
        break; // keep everything queued; retry later
      }
      const done: string[] = [];
      const rejected: RaceSync["notApplied"] = [];
      const kept: OutboxEntry[] = [];
      results.forEach((r, i) => {
        const e = entries[i];
        if (!e) return;
        if (r.applied) done.push(e.actionId);
        else {
          rejected.push({ actionId: e.actionId, type: e.action.type, reason: r.reason ?? "invalid" });
          kept.push({ ...e, rejected: { reason: r.reason ?? "invalid", seq: r.seq, at: Date.now() } });
        }
      });
      // Not applied ≠ lost: kept on the device (marked, never re-sent) until the user dismisses it.
      for (const e of kept) await outboxPut(e);
      await outboxDelete(done);
      if (rejected.length) {
        setSync(local, { notApplied: toNotApplied(await rejectedActions(local)) });
        const first = rejected[0];
        toast.warn(`Not applied: ${first.type} — ${REASON_TEXT[first.reason] ?? first.reason}`, { toastId: `na-${first.actionId}` });
      }
    }
    const left = await outboxList(local);
    pendingRiders.set(local, new Set(left.map((e) => (e.action.payload as { riderUuid?: string }).riderUuid).filter((u): u is string => !!u)));
    setSync(local, { pending: left.length, lastSyncAt: Date.now() });
    if (left.length === 0 && fallbackNeeded(local)) await catchUp(local);
  } finally {
    flushing.delete(local);
  }
}

export async function flushAll() {
  for (const local of Object.keys(readLinks())) await flush(local);
}

export const pendingCount = async (local: string) => (await outboxList(local)).length;

/** What stays on this phone for a race: Actions still to send, and refused ones kept for review. */
export async function outboxCounts(local: string): Promise<{ pending: number; rejected: number }> {
  const all = await outboxAll(local);
  return { pending: all.filter((e) => !e.rejected).length, rejected: all.filter((e) => e.rejected).length };
}

// ---------------------------------------------------------------------------
// Local ↔ server records

const toDate = (v: unknown) => (typeof v === "string" ? new Date(v) : v);

const RIDER_DEFAULTS: Omit<RiderProps, "id" | "raceUuid"> = {
  bibNumber: 0, category: "", subCategory: null, checked: false, distance: null, elapsedLastLap: null, elapsedTimeFromStart: null,
  timeStartRace: null, timeArrive: null, firstName: "", middleName: null, flag: null, lapsCounter: 0, lapsDetails: [], lastName: "",
  position_start: null, position_category: 0, position_race: 0, standing: null, raceStatus: "upcoming", status: "standing",
  team: null, viewOrder: 0, totalLaps: 0, heat: 0, color: null, image: null, comment: null,
};

function toLocalRider(s: Partial<SharedRider>, local: string, existing?: RiderProps): RiderProps {
  const { raceUuid: _r, createdAt: _c, updatedAt: _u, ...fields } = s;
  const r = { ...RIDER_DEFAULTS, ...(existing ?? {}), ...fields, raceUuid: local, id: existing?.id ?? newLocalId() } as RiderProps;
  if (s.lapsDetails) r.lapsDetails = s.lapsDetails.map((l) => ({ ...l, startTime: toDate(l.startTime) as Date, endTime: toDate(l.endTime) as Date }));
  if (r.bibNumber == null) r.bibNumber = 0;
  if (r.heat == null) r.heat = 0;
  return r;
}

function toLocalCategory(s: SharedCategory, local: string, existing?: CategoryProps): CategoryProps {
  return {
    lapsCounter: 0, riders: null, isConnected: false, ...(existing ?? {}),
    uuid: s.uuid, raceUuid: local, name: s.name, subCategory: s.subCategory, laps: s.laps, startTime: s.startTime, color: s.color,
    heat: s.heat, status: s.status ?? "upcoming", linkedFinish: s.linkedFinish ?? undefined, linkGroup: s.linkGroup ?? undefined,
    ignored: s.ignored ?? false, bibColor: s.bibColor ?? null, bibTextColor: s.bibTextColor ?? null,
    finishedAt: s.finishedAt ?? undefined, importOrder: s.importOrder ?? undefined, id: existing?.id ?? newLocalId(),
  } as CategoryProps;
}

const RACE_FROM_SERVER = [...RACE_INFO_FIELDS, "status", "autoColor", "leaderFinishAll", "minLapSeconds"] as const;

function mergeRace(existing: RaceProps, s: Partial<SharedRace>): RaceProps {
  const out = { ...existing } as unknown as Record<string, unknown>;
  for (const f of RACE_FROM_SERVER) if (f in s) out[f] = (s as Record<string, unknown>)[f] ?? undefined;
  return out as unknown as RaceProps;
}

function toNewRider(r: RiderProps) {
  return {
    uuid: r.uuid!, firstName: r.firstName ?? "", middleName: r.middleName ?? null, lastName: r.lastName ?? "",
    bibNumber: Number.isFinite(r.bibNumber) && r.bibNumber > 0 ? r.bibNumber : null, team: r.team ?? null,
    chipNumber: r.chipNumber ?? null, federation: r.federation ?? null, points: r.points ?? null, category: r.category,
    subCategory: r.subCategory ?? null, heat: r.heat ?? null, standing: r.standing ?? null, flag: r.flag ?? null,
    uciPoints: r.uciPoints ?? null, uciNumber: r.uciNumber ?? null, image: r.image ?? null, comment: r.comment ?? null,
    bibColor: r.bibColor ?? null, bibTextColor: r.bibTextColor ?? null,
  };
}

const toNewCategory = (c: CategoryProps) => ({
  uuid: c.uuid!, name: c.name, subCategory: c.subCategory ?? null, laps: c.laps ?? null, heat: c.heat ?? null,
  startTime: c.startTime ?? null, color: c.color ?? null, linkGroup: c.linkGroup ?? null, importOrder: c.importOrder ?? null,
  bibColor: c.bibColor ?? null, bibTextColor: c.bibTextColor ?? null,
});

/** Shared-shape state of a local race, for checking permissions on the Device. */
function sharedStateOf(local: string, extraRiders: RiderProps[] = []): RaceState {
  const link = linkOf(local)!;
  const race = useRaceStore.getState().races.find((r) => r.uuid === local);
  const cats = useCategoryStore.getState().categories.filter((c) => c.raceUuid === local && c.uuid);
  const riders = [...useRiderStore.getState().riders.filter((r) => r.raceUuid === local), ...extraRiders].filter((r) => r.uuid);
  return {
    race: { ...(race as unknown as SharedRace), uuid: link.serverRaceUuid, ownerUserId: "" },
    categories: Object.fromEntries(cats.map((c) => [c.uuid!, { ...c, raceUuid: link.serverRaceUuid } as unknown as SharedCategory])),
    riders: Object.fromEntries(riders.map((r) => [r.uuid!, { ...r, raceUuid: link.serverRaceUuid } as unknown as SharedRider])),
  };
}

function allowed(local: string, actions: RaceAction[], extraRiders: RiderProps[] = []): boolean {
  const access = accessFor(local);
  if (!access) return true; // not known yet (offline from the start): the server decides
  const eff: EffectiveAccess = { isOwner: access.isOwner, screens: access.screens, waves: access.waves, categories: access.categories };
  const state = sharedStateOf(local, extraRiders);
  for (const a of actions) {
    const r = authorizeAction(eff, a, state);
    if (!r.ok) {
      toast.warn(r.reason === "out_of_scope" ? "That rider or wave is outside your access" : "Your role in this race does not allow this", { toastId: "live-denied" });
      return false;
    }
  }
  return true;
}

const draft = (local: string, type: string, payload: Record<string, unknown>) =>
  ({ actionId: "draft", raceUuid: linkOf(local)!.serverRaceUuid, type, payload, deviceTime: new Date().toISOString(), clockOffsetMs: 0, deviceId: "", protocolVersion: PROTOCOL_VERSION }) as RaceAction;

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Store writes on a shared race → Actions (or a refusal). Derived fields are left to the server. */
const bridge: LiveBridge = {
  beforeRiders(kind, before, after) {
    const local = (after[0] ?? before[0])?.raceUuid;
    if (!local || !linkOf(local)) return true;
    const actions: RaceAction[] = [];
    let newCategories: CategoryProps[] = [];
    if (kind === "import") {
      // The server refuses the whole import for one bad rider: refuse it here, by row, before any write.
      const problems = importProblems(after, [], useRiderStore.getState().riders.filter((r) => r.raceUuid === local));
      if (problems.length) {
        toast.error(describeProblems(problems), { toastId: "import-refused", autoClose: false });
        return false;
      }
      // The categories the riders need go in the same Action (the store's category builders skip shared races).
      const race = useRaceStore.getState().races.find((r) => r.uuid === local);
      const have = new Set(useCategoryStore.getState().categories.filter((c) => c.raceUuid === local).map((c) => riderCategoryKey({ category: c.name, subCategory: c.subCategory })));
      newCategories = buildCategoriesFromRiders(after, local, race?.autoColor !== false)
        .filter((c) => !have.has(riderCategoryKey({ category: c.name, subCategory: c.subCategory })))
        .map((c) => ({ ...c, uuid: crypto.randomUUID() }));
    }
    if (kind === "add" || kind === "import") {
      for (const r of after) r.uuid ??= crypto.randomUUID();
      if (kind === "add") actions.push(...after.map((r) => draft(local, "RiderAdded", { rider: toNewRider(r) })));
      else actions.push(draft(local, "RidersImported", { riders: after.map(toNewRider), categories: newCategories.map(toNewCategory) }));
    } else if (kind === "delete") {
      for (const r of before) if (r.uuid) actions.push(draft(local, "RiderDeleted", { riderUuid: r.uuid }));
    } else {
      const cats = useCategoryStore.getState().categories.filter((c) => c.raceUuid === local);
      after.forEach((next, i) => {
        const prev = before[i];
        if (!prev || !next.uuid) return;
        const changes: Record<string, unknown> = {};
        for (const f of RIDER_IDENTITY_FIELDS) {
          if (sameValue(prev[f as keyof RiderProps], next[f as keyof RiderProps])) continue;
          // A category rename or wave change is one CategoryEdited; the riders follow on the server.
          if ((f === "category" || f === "subCategory") && !cats.some((c) => c.name === prev.category && (c.subCategory ?? null) === (prev.subCategory ?? null))) continue;
          if (f === "heat" && cats.some((c) => c.name === next.category && c.heat === next.heat)) continue;
          changes[f] = next[f as keyof RiderProps] ?? null;
        }
        if (Object.keys(changes).length) actions.push(draft(local, "RiderEdited", { riderUuid: next.uuid, changes }));
        if (prev.checked !== next.checked) actions.push(draft(local, "RiderCheckedIn", { riderUuid: next.uuid, checked: !!next.checked }));
        if ((prev.comment ?? null) !== (next.comment ?? null)) actions.push(draft(local, "CommentSet", { riderUuid: next.uuid, comment: next.comment ?? null }));
        if (prev.status !== next.status && next.status !== "finished") {
          actions.push(draft(local, "StatusCorrection", { riderUuid: next.uuid, status: next.status }));
        }
      });
    }
    if (!actions.length) return true;
    if (!allowed(local, actions, kind === "add" || kind === "import" ? after : [])) return false;
    for (const a of actions) void dispatchAction(local, a.type, a.payload as Record<string, unknown>);
    // Locally too, as the server will create them (not sent again: they are in the Action).
    if (newCategories.length) void applyingRemote(() => useCategoryStore.getState().upsertCategories(newCategories));
    return true;
  },

  beforeCategories(kind, before, after) {
    const local = (after[0] ?? before[0])?.raceUuid;
    if (!local || !linkOf(local)) return true;
    const actions: RaceAction[] = [];
    if (kind === "delete") {
      for (const c of before) if (c.uuid) actions.push(draft(local, "CategoryDeleted", { categoryUuid: c.uuid }));
    } else {
      const byId = new Map(before.map((c) => [c.id, c]));
      for (const next of after) {
        const prev = byId.get(next.id);
        if (!prev || !prev.uuid) {
          next.uuid ??= crypto.randomUUID();
          actions.push(draft(local, "CategoryAdded", { category: toNewCategory(next) }));
          continue;
        }
        next.uuid ??= prev.uuid;
        const changes: Record<string, unknown> = {};
        for (const f of ["name", "laps", "heat", "startTime", "color", "linkGroup", "linkedFinish", "isConnected", "bibColor", "bibTextColor"] as const) {
          if (!sameValue(prev[f], next[f])) changes[f] = next[f] ?? null;
        }
        if (!!prev.ignored !== !!next.ignored) changes.ignored = !!next.ignored;
        if (Object.keys(changes).length) actions.push(draft(local, "CategoryEdited", { categoryUuid: prev.uuid, changes }));
      }
    }
    if (!actions.length) return true;
    if (!allowed(local, actions)) return false;
    for (const a of actions) void dispatchAction(local, a.type, a.payload as Record<string, unknown>);
    return true;
  },

  beforeRace(before, after) {
    const local = after.uuid;
    if (!linkOf(local)) return true;
    const info: Record<string, unknown> = {};
    for (const f of RACE_INFO_FIELDS) {
      const k = f as keyof RaceProps;
      if (!sameValue(before[k], after[k])) info[f] = after[k] ?? null;
    }
    const settings: Record<string, unknown> = {};
    for (const f of ["leaderFinishAll", "autoColor"] as const) if (!sameValue(before[f], after[f])) settings[f] = after[f] !== false;
    if (after.minLapSeconds != null && !sameValue(before.minLapSeconds, after.minLapSeconds)) settings.minLapSeconds = after.minLapSeconds;
    const actions: RaceAction[] = [];
    if (Object.keys(info).length) actions.push(draft(local, "RaceEdited", { changes: info }));
    if (Object.keys(settings).length) actions.push(draft(local, "SettingChanged", { changes: settings }));
    if (!actions.length) return true;
    if (!allowed(local, actions)) return false;
    for (const a of actions) void dispatchAction(local, a.type, a.payload as Record<string, unknown>);
    return true;
  },

  allows(local, type, payload) {
    if (!linkOf(local)) return true;
    return allowed(local, [draft(local, type, payload)]);
  },
};

// ---------------------------------------------------------------------------
// Applying server changes

interface ChangeSet {
  seq?: number;
  lastSeq?: number;
  access?: AccessSummary;
  race?: Partial<SharedRace>;
  categories?: SharedCategory[];
  riders?: Partial<SharedRider>[];
  removedRiders?: string[];
  removedCategories?: string[];
}

async function applyChanges(local: string, ch: ChangeSet) {
  if (ch.access) cacheAccess(local, ch.access);
  // Each write is wrapped on its own (see applyingRemote): a user's edit between them is still sent.
  const rs = useRiderStore.getState();
  if (rs.lastFetchedRaceUuid !== local) await rs.getRiders(local);
  await useCategoryStore.getState().getCategories(local);

  if (ch.race) {
    const existing = useRaceStore.getState().races.find((r) => r.uuid === local);
    if (existing) await applyingRemote(() => useRaceStore.getState().updateRace(mergeRace(existing, ch.race!)));
  }
  if (ch.categories?.length) {
    const current = useCategoryStore.getState().categories.filter((c) => c.raceUuid === local);
    const cats = ch.categories.map((c) => toLocalCategory(c, local, current.find((x) => x.uuid === c.uuid)));
    await applyingRemote(() => useCategoryStore.getState().upsertCategories(cats));
  }
  for (const uuid of ch.removedCategories ?? []) {
    const c = useCategoryStore.getState().categories.find((x) => x.raceUuid === local && x.uuid === uuid);
    if (c) await applyingRemote(() => useCategoryStore.getState().deleteCategory(c.id));
  }
  if (ch.riders?.length) {
    const pending = pendingRiders.get(local) ?? new Set<string>();
    const current = useRiderStore.getState().riders.filter((r) => r.raceUuid === local);
    const byUuid = new Map(current.filter((r) => r.uuid).map((r) => [r.uuid!, r]));
    const patches: RiderProps[] = [];
    const added: RiderProps[] = [];
    for (const s of ch.riders) {
      if (!s.uuid || pending.has(s.uuid)) continue; // our queued change wins until the server has it
      const existing = byUuid.get(s.uuid);
      (existing ? patches : added).push(toLocalRider(s, local, existing));
    }
    if (patches.length) await applyingRemote(() => useRiderStore.getState().patchRiders(patches));
    if (added.length) await applyingRemote(() => useRiderStore.getState().insertRiders(added));
  }
  for (const uuid of ch.removedRiders ?? []) {
    const r = useRiderStore.getState().riders.find((x) => x.raceUuid === local && x.uuid === uuid);
    if (r) await applyingRemote(() => useRiderStore.getState().deleteRider(r.id));
  }
  const seq = ch.seq ?? ch.lastSeq;
  if (typeof seq === "number") setLink(local, { lastSeq: Math.max(seq, linkOf(local)?.lastSeq ?? 0) });
  setSync(local, { lastSyncAt: Date.now() });
  if (ch.race?.status === "finished") void adoptOfficial(local);
}

/** The race became official on the server: stamp the local copy with the latest version (read-only from now on). */
async function adoptOfficial(local: string) {
  const access = accessFor(local);
  if (access && !access.screens.results.view) return;
  try {
    const { versions } = await team.official(local);
    const o = versions[versions.length - 1] as Record<string, unknown> | undefined;
    const race = useRaceStore.getState().races.find((r) => r.uuid === local);
    if (!o || !race || race.finalized?.token === o.token) return;
    await applyingRemote(() =>
      useRaceStore.getState().updateRace({
        ...race,
        finalized: {
          version: String(o.version), algo: "SHA-256", at: new Date(String(o.at)).toISOString(), by: String(o.by), nonce: String(o.nonce),
          payload: String(o.payload), token: String(o.token), riderCount: Number(o.riderCount), categoryCount: Number(o.categoryCount),
        },
      }),
    );
  } catch {
    /* retried on the next change */
  }
}

/**
 * Everything since the last applied sequence (or a fresh snapshot when far behind).
 * One request per race at a time: calls made while one runs share ONE follow-up
 * (a burst of gap messages or Refresh taps costs two requests, not one each).
 */
const catchUpRuns = new Map<string, Promise<void>>();
const catchUpAgain = new Set<string>();
export function catchUp(local: string): Promise<void> {
  const running = catchUpRuns.get(local);
  if (running) {
    catchUpAgain.add(local);
    return running;
  }
  const run = (async () => {
    try {
      do {
        catchUpAgain.delete(local);
        await catchUpOnce(local);
      } while (catchUpAgain.has(local));
    } finally {
      catchUpRuns.delete(local);
    }
  })();
  catchUpRuns.set(local, run);
  return run;
}

/** Nothing more can happen in this race: finalized, or every category finished. */
function raceComplete(local: string): boolean {
  if (useRaceStore.getState().races.find((r) => r.uuid === local)?.finalized) return true;
  const cats = useCategoryStore.getState().categories.filter((c) => c.raceUuid === local && !c.ignored);
  return cats.length > 0 && cats.every((c) => c.status === "finished");
}

/** Without the live socket, fall back to HTTP only when someone is looking and the race can still change. */
const fallbackNeeded = (local: string) =>
  !socket?.connected && document.visibilityState === "visible" && useLiveStore.getState().openRace === local && !raceComplete(local);

/** Manual Refresh: what changed since the last applied sequence (one request, deduplicated). */
export async function refreshRace(local: string): Promise<boolean> {
  if (!linkOf(local) || !session) return false;
  await catchUp(local);
  return true;
}

const ID_REPAIR_VERSION = 1;

async function catchUpOnce(local: string): Promise<void> {
  const link = linkOf(local);
  if (!link || !session) return;
  try {
    if (link.idRepair !== ID_REPAIR_VERSION && syncOf(local).pending === 0) {
      // Once per race: older builds could give two riders the same local id, which
      // hid one of them (overwritten in IndexedDB, one card on Live). A full reload
      // from the server puts every rider back exactly once.
      await loadSnapshot(local);
      setLink(local, { idRepair: ID_REPAIR_VERSION });
    } else {
      const ch = await api<ChangeSet & { snapshot?: boolean }>("GET", `/races/${link.serverRaceUuid}/changes?afterSeq=${link.lastSeq}`);
      if (ch.snapshot) await loadSnapshot(local);
      else await applyChanges(local, ch);
    }
    await api("POST", `/races/${link.serverRaceUuid}/sync`, { deviceId: deviceId(), lastSeq: linkOf(local)!.lastSeq, pendingCount: syncOf(local).pending });
  } catch (err) {
    if (err instanceof LiveApiError && err.status === 404) setSync(local, { revoked: true });
    if (isRaceDeleted(err)) await removeDeletedRace(local);
  }
}

interface Snapshot extends ChangeSet {
  lastSeq: number;
  access: AccessSummary;
  race: Partial<SharedRace>;
  categories: SharedCategory[];
  riders: Partial<SharedRider>[];
}

/** Replaces the local copy of a shared race with the server's snapshot (filtered for this member). */
async function loadSnapshot(local: string): Promise<void> {
  const link = linkOf(local)!;
  const snap = await api<Snapshot>("GET", `/races/${link.serverRaceUuid}/snapshot`);
  cacheAccess(local, snap.access);
  const races = useRaceStore.getState();
  const existing = races.races.find((r) => r.uuid === local);
  if (!existing) {
    const base = { id: newLocalId(), uuid: local, owner: "", name: "", location: "", time: "", date: "", image: "", heat: "", type: "", level: "",
      orgenizer: "", manager: "", phone: "", takanon: "", site: "", map: "", distance: 0, isActive: true, createdAt: new Date(), lastUpdateAt: new Date() } as RaceProps;
    await applyingRemote(() => races.insertRace(mergeRace(base, snap.race)));
  } else {
    await applyingRemote(() => races.updateRace(mergeRace(existing, snap.race)));
  }
  // Keep local ids for records we already have; drop anything the server no longer shows us.
  const rs = useRiderStore.getState();
  if (rs.lastFetchedRaceUuid !== local) await rs.getRiders(local);
  const currentRiders = useRiderStore.getState().riders.filter((r) => r.raceUuid === local);
  const keep = new Set(snap.riders.map((r) => r.uuid));
  // Riders sharing a local id (older builds) can't be told apart by the store: drop them
  // here and let the snapshot add each one back once, with a unique id.
  // Never one with a queued change: the snapshot skips those, so it would not come back.
  const pendingUuids = pendingRiders.get(local) ?? new Set<string>();
  const dupIds = duplicateIds(currentRiders);
  for (const r of currentRiders) if (dupIds.has(r.id) && (!r.uuid || pendingUuids.has(r.uuid) || !keep.has(r.uuid))) dupIds.delete(r.id);
  for (const id of dupIds) await applyingRemote(() => useRiderStore.getState().deleteRider(id));
  for (const r of currentRiders) {
    if (dupIds.has(r.id)) continue;
    if (!r.uuid || !keep.has(r.uuid)) await applyingRemote(() => useRiderStore.getState().deleteRider(r.id));
  }
  await useCategoryStore.getState().getCategories(local);
  const currentCats = useCategoryStore.getState().categories.filter((c) => c.raceUuid === local);
  const keepCats = new Set(snap.categories.map((c) => c.uuid));
  const dupCatIds = duplicateIds(currentCats);
  for (const id of dupCatIds) await applyingRemote(() => useCategoryStore.getState().deleteCategory(id));
  for (const c of currentCats) {
    if (dupCatIds.has(c.id)) continue;
    if (!c.uuid || !keepCats.has(c.uuid)) await applyingRemote(() => useCategoryStore.getState().deleteCategory(c.id));
  }
  await applyChanges(local, { ...snap, seq: snap.lastSeq });
  setLink(local, { lastSeq: snap.lastSeq });
}

// ---------------------------------------------------------------------------
// Socket

let socket: Socket | null = null;

function ensureSocket(): Socket | null {
  if (!session) return null;
  if (socket) return socket;
  socket = io(`${SERVER}/race`, {
    auth: (cb) => cb({ token: session?.accessToken ?? "" }),
    transports: ["websocket", "polling"],
    reconnectionDelayMax: 10_000,
  });
  socket.on("connect", async () => {
    useLiveStore.setState({ socketConnected: true });
    await measureClock();
    const open = useLiveStore.getState().openRace;
    if (open) await joinRoom(open);
    void flushAll();
  });
  socket.on("disconnect", () => useLiveStore.setState({ socketConnected: false }));
  socket.on("connect_error", async (err) => {
    if (err.message === "unauthorized" && (await refreshTokens())) socket?.connect();
  });
  socket.on("race:changes", async (msg: ChangeSet & { raceUuid: string; seq: number; results?: unknown[] }) => {
    const local = localUuidOf(msg.raceUuid);
    if (!local) return;
    const last = linkOf(local)?.lastSeq ?? 0;
    if (msg.seq <= last) return;
    if (msg.seq > last + 1) await catchUp(local); // a gap: fetch what we missed
    else await applyChanges(local, msg);
  });
  socket.on("race:access", (msg: { raceUuid: string; access: AccessSummary }) => {
    const local = localUuidOf(msg.raceUuid);
    if (local) {
      cacheAccess(local, msg.access);
      toast.info("Your access to this race was updated", { toastId: `access-${local}` });
      void loadSnapshot(local); // waves or screens may have changed what we may hold
    }
  });
  socket.on("race:revoked", (msg: { raceUuid: string; deleted?: boolean }) => {
    const local = localUuidOf(msg.raceUuid);
    if (!local) return;
    setSync(local, { revoked: true });
    toast.warn(msg.deleted ? "The owner deleted this race." : "Your access to this shared race was removed.", { toastId: `revoked-${local}` });
    if (msg.deleted) void removeDeletedRace(local);
  });
  return socket;
}

async function joinRoom(local: string) {
  const link = linkOf(local);
  if (!link || !socket?.connected) return;
  const r = (await socket.emitWithAck("join", { raceUuid: link.serverRaceUuid })) as { ok: boolean; lastSeq?: number; access?: AccessSummary; error?: string };
  if (!r.ok) {
    setSync(local, { revoked: true });
    if (r.error === "race_deleted") await removeDeletedRace(local);
    return;
  }
  if (r.access) cacheAccess(local, r.access);
  await catchUp(local);
}

/**
 * The race now on screen. Leaves the previous race's live room (other races'
 * queues keep being sent over HTTP) and catches up this one (AD-20).
 */
export async function openLiveRace(local: string | null): Promise<void> {
  const prev = useLiveStore.getState().openRace;
  if (prev === local) return;
  useLiveStore.setState({ openRace: local });
  const prevLink = prev ? linkOf(prev) : null;
  if (prevLink && socket?.connected) socket.emit("leave", { raceUuid: prevLink.serverRaceUuid });
  if (!local || !linkOf(local)) return;
  setSync(local, { pending: await pendingCount(local), notApplied: toNotApplied(await rejectedActions(local)) });
  if (ensureSocket()?.connected) await joinRoom(local);
  else await catchUp(local);
  void flush(local);
}

// ---------------------------------------------------------------------------
// Publish, My Races, join

/**
 * Shares a local race (before any wave started). The Device's ids become the shared ones.
 * A new race (`allowEmpty`) may go up with no categories yet: they follow as Actions.
 */
export function publishRace(local: string, opts: { allowEmpty?: boolean } = {}): Promise<string> {
  // One upload per race at a time — in this tab (the retry timer and "Save to server"
  // can meet) and across tabs (Web Locks). The server cannot tell two uploads of an
  // empty race apart, so a second one would create a duplicate race.
  const running = publishingRaces.get(local);
  if (running) return running;
  const once = async () => {
    const link = linkOf(local);
    if (link && opts.allowEmpty) return link.serverRaceUuid; // another upload just finished
    return publishRaceOnce(local, opts);
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // (this TS lib types request() as Promise<Promise<T>>; .then flattens it)
  const locked = locks ? locks.request(`commissaire.publish.${local}`, once).then((v) => v) : once();
  const run = locked.finally(() => publishingRaces.delete(local));
  publishingRaces.set(local, run);
  return run;
}
const publishingRaces = new Map<string, Promise<string>>();

async function publishRaceOnce(local: string, { allowEmpty = false }: { allowEmpty?: boolean }): Promise<string> {
  if (!session) throw new LiveApiError(401, "unauthorized", "Sign in to share a race");
  if (linkOf(local)) throw new LiveApiError(409, "already_published", "This race is already shared");
  if (local === DEMO_RACE_UUID) throw new LiveApiError(400, "demo_race", "The demo race can't be shared — create a race for your event");
  const race = useRaceStore.getState().races.find((r) => r.uuid === local);
  if (!race) throw new Error("Race not found");
  await useRiderStore.getState().getRiders(local);
  await useCategoryStore.getState().getCategories(local);
  const cats = useCategoryStore.getState().categories.filter((c) => c.raceUuid === local);
  const riders = useRiderStore.getState().riders.filter((r) => r.raceUuid === local);
  if (cats.some((c) => c.status && c.status !== "upcoming")) throw new LiveApiError(409, "already_started", "Share the race before the first wave starts");
  if (cats.length === 0 && !allowEmpty) throw new LiveApiError(400, "no_categories", "Add categories before sharing the race");
  // Give every record its shared id, locally first (not through the bridge: the race is not linked yet).
  const catsWithUuid = cats.map((c) => ({ ...c, uuid: c.uuid ?? crypto.randomUUID() }));
  const ridersWithUuid = riders.map((r) => ({ ...r, uuid: r.uuid ?? crypto.randomUUID() }));
  await useCategoryStore.getState().upsertCategories(catsWithUuid);
  await useRiderStore.getState().patchRiders(ridersWithUuid);
  const info: Record<string, unknown> = {};
  for (const f of RACE_INFO_FIELDS) {
    const v = (race as unknown as Record<string, unknown>)[f];
    if (v !== undefined) info[f] = v;
  }
  info.autoColor = race.autoColor ?? null;
  info.leaderFinishAll = race.leaderFinishAll ?? null;
  info.minLapSeconds = race.minLapSeconds ?? null;
  const res = await api<{ race: SharedRace }>("POST", "/races/publish", {
    race: { ...info, name: race.name || "Race" },
    categories: catsWithUuid.map(toNewCategory),
    riders: ridersWithUuid.map((r) => ({ ...toNewRider(r), checked: !!r.checked, status: r.status === "DNS" ? "DNS" : "standing" })),
  });
  setLink(local, { serverRaceUuid: res.race.uuid, lastSeq: 0, linkedAt: new Date().toISOString() });
  await openLiveRace(null);
  await openLiveRace(local);
  return res.race.uuid;
}

// ---------------------------------------------------------------------------
// New races go to the server automatically

/**
 * Races created on this Device while signed in that still have to be published,
 * with the account that created them. Only Create Race adds to it, so existing
 * local races (and races created signed out) are never uploaded without the
 * owner asking — they get "Save to server" on the race page instead. A queued
 * race is only ever published under the account that created it.
 *
 * The older key (`commissaire.live.pendingPublish`, plain uuids, filled signed
 * out too) is no longer read: those races are offered "Save to server".
 */
export const PENDING_PUBLISH_KEY = "commissaire.live.pendingPublish.v2";
type PendingEntry = { local: string; userId: string };
const readPendingEntries = (): PendingEntry[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_PUBLISH_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x?.local === "string" && typeof x?.userId === "string") : [];
  } catch {
    return [];
  }
};
const writePendingEntries = (list: PendingEntry[]) =>
  localStorage.setItem(PENDING_PUBLISH_KEY, JSON.stringify(list.filter((e, i) => list.findIndex((o) => o.local === e.local) === i)));
const removePending = (local: string) => writePendingEntries(readPendingEntries().filter((e) => e.local !== local));
/** The queued races of the signed-in account (uuids). */
const readPending = (): string[] => (session ? readPendingEntries().filter((e) => e.userId === session!.user.id).map((e) => e.local) : []);
export const isPendingPublish = (local: string) => readPending().includes(local);

/** Why a queued new race is not on the server yet (the last failed upload), shown on the race page. */
const setPublishError = (local: string, message: string | null) =>
  useLiveStore.setState((s) => {
    const publishErrors = { ...s.publishErrors };
    if (message) publishErrors[local] = message;
    else delete publishErrors[local];
    return { publishErrors };
  });

/** Where a new race is stored after Create Race. Only "server" means it is in the database. */
export type NewRaceStorage =
  | { stored: "server"; serverRaceUuid: string }
  | { stored: "device"; reason: "signed_out" | "failed" | "timeout"; message: string };

/**
 * A new race persists to the server when the user is signed in (retried in the
 * background after a failure). Signed out it stays on this device until the
 * owner taps "Save to server" after signing in. Resolves with where the race
 * actually is, never "server" unless the server answered with the created race.
 */
export async function persistNewRace(local: string, timeoutMs = 20_000): Promise<NewRaceStorage> {
  const done = (): NewRaceStorage | null => {
    const l = linkOf(local);
    return l ? { stored: "server", serverRaceUuid: l.serverRaceUuid } : null;
  };
  if (local === DEMO_RACE_UUID) return { stored: "device", reason: "failed", message: "The demo race stays on this device" };
  const linked = done();
  if (linked) return linked;
  if (!session) return { stored: "device", reason: "signed_out", message: "Sign in, then use Save to server on the race page" };
  writePendingEntries([...readPendingEntries(), { local, userId: session.user.id }]);
  const attempt = (async () => {
    await publishPending();
    // An upload already in progress may have started before this race was queued.
    if (!done()) await publishPending();
  })();
  const timedOut = await Promise.race([attempt.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), timeoutMs))]);
  const now = done();
  if (now) return now;
  if (timedOut) return { stored: "device", reason: "timeout", message: "The server did not answer in time; still trying" };
  if (!session) return { stored: "device", reason: "signed_out", message: "Your session ended. Sign in, then use Save to server on the race page" };
  return { stored: "device", reason: "failed", message: useLiveStore.getState().publishErrors[local] ?? "The server did not save the race" };
}

/**
 * "Save to server" on a local race (created signed out, or before this
 * existed): the owner's explicit choice, so nothing is uploaded without it.
 * The local race and its data stay as they are; it only becomes linked.
 */
export async function saveRaceToServer(local: string): Promise<string> {
  try {
    const serverRaceUuid = await publishRace(local, { allowEmpty: true });
    removePending(local);
    setPublishError(local, null);
    return serverRaceUuid;
  } catch (e) {
    const message = e instanceof TypeError ? "No connection to the server" : e instanceof Error ? e.message : String(e);
    setPublishError(local, message);
    throw new Error(message);
  }
}

let publishing: Promise<void> | null = null;
/** Publishes the queued new races (signed in only). A failure keeps the race queued for the next try. */
export function publishPending(): Promise<void> {
  if (publishing) return publishing;
  publishing = (async () => {
    if (!session || readPending().length === 0) return;
    if (useRaceStore.getState().races.length === 0) await useRaceStore.getState().getRaces();
    for (const local of readPending()) {
      if (linkOf(local)) {
        removePending(local);
        continue;
      }
      if (!useRaceStore.getState().races.some((r) => r.uuid === local)) continue; // not loaded here — keep it
      try {
        await publishRace(local, { allowEmpty: true });
        removePending(local);
        setPublishError(local, null);
      } catch (e) {
        // Offline / server down: retried by the sync timer. A race that started
        // before it could be published can no longer be (the owner is told on the race page).
        const message = e instanceof Error ? e.message : String(e);
        setPublishError(local, e instanceof TypeError ? "No connection to the server" : message);
        console.warn("[live] new race not published yet", local, message);
      }
    }
  })().finally(() => {
    publishing = null;
  });
  return publishing;
}

// ---------------------------------------------------------------------------
// Start-list import into a shared race

/** The import was refused before anything was written or sent; `problems` name the rows. */
export class ImportRefused extends Error {
  constructor(readonly problems: ImportProblem[], message = describeProblems(problems)) {
    super(message);
  }
}

/** Last import sent per race: a retry of the same file reuses its actionId (the server answers it once). */
const lastImport = new Map<string, { fingerprint: string; actionId: string }>();

/**
 * Imports a start list into a SHARED race as ONE `RidersImported` Action that
 * carries the riders AND the categories they need (only the missing ones), and
 * waits for the server. Nothing is written on this device until the server
 * applied it; then the race is caught up, so riders and categories arrive here
 * exactly as every other device gets them. A refusal names the rows.
 */
export async function importIntoSharedRace(local: string, riders: RiderProps[], rowNumbers: number[]): Promise<{ riders: number; categories: number }> {
  const link = linkOf(local);
  if (!link) throw new Error("Not a shared race");
  if (!session) throw new ImportRefused([], "Nothing was imported. Sign in to import into this race.");

  const fingerprint = JSON.stringify(riders.map((r) => [r.bibNumber, r.firstName, r.lastName, r.category, r.heat]));
  const retry = lastImport.get(local)?.fingerprint === fingerprint ? lastImport.get(local)!.actionId : null;

  await flush(local); // earlier changes first, in order
  await catchUp(local); // check against what the server has now
  const existingRiders = useRiderStore.getState().riders.filter((r) => r.raceUuid === local);
  if (!retry) {
    const problems = importProblems(riders, rowNumbers, existingRiders);
    if (problems.length) throw new ImportRefused(problems);
  }

  const withUuid = riders.map((r) => ({ ...r, uuid: r.uuid ?? crypto.randomUUID() }));
  const race = useRaceStore.getState().races.find((r) => r.uuid === local);
  const haveCategory = new Set(useCategoryStore.getState().categories.filter((c) => c.raceUuid === local).map((c) => riderCategoryKey({ category: c.name, subCategory: c.subCategory })));
  const categories = buildCategoriesFromRiders(withUuid, local, race?.autoColor !== false)
    .filter((c) => !haveCategory.has(riderCategoryKey({ category: c.name, subCategory: c.subCategory })))
    .map((c) => ({ ...c, uuid: crypto.randomUUID() }));

  const actionId = retry ?? crypto.randomUUID();
  lastImport.set(local, { fingerprint, actionId });
  const action = {
    actionId, raceUuid: link.serverRaceUuid, type: "RidersImported",
    payload: { riders: withUuid.map(toNewRider), categories: categories.map(toNewCategory) },
    deviceTime: localIso(Date.now()), clockOffsetMs, deviceId: deviceId(), protocolVersion: PROTOCOL_VERSION,
  } as RaceAction;

  let result: { applied: boolean; reason: string | null } | undefined;
  try {
    ({ results: [result] } = await api<{ results: { applied: boolean; reason: string | null }[] }>("POST", `/races/${link.serverRaceUuid}/actions`, { actions: [action] }));
  } catch (e) {
    if (e instanceof LiveApiError && e.status === 426) useLiveStore.setState({ needsUpdate: true });
    // Unanswered: it may or may not have arrived. A retry of the same file reuses this actionId.
    const why = e instanceof TypeError ? "No connection to the server" : e instanceof Error ? e.message : String(e);
    throw new ImportRefused([], `Nothing was imported. ${why}. Try again.`);
  }
  if (!result?.applied) {
    lastImport.delete(local);
    const why = REASON_TEXT[result?.reason ?? ""] ?? result?.reason ?? "refused";
    throw new ImportRefused([], `Nothing was imported. The server refused the import (${why}).`);
  }
  lastImport.delete(local);
  await catchUp(local);
  return { riders: withUuid.length, categories: categories.length };
}

export interface MyRace {
  race: Partial<SharedRace>;
  access: AccessSummary;
  localRaceUuid: string | null;
}

export async function myRaces(): Promise<MyRace[]> {
  return (await myRacesWithRemoved()).races;
}
async function myRacesWithRemoved(): Promise<{ races: MyRace[]; removed: string[] }> {
  const r = await api<{ races: { race: Partial<SharedRace>; access: AccessSummary }[]; removed?: string[] }>("GET", "/races");
  return { races: r.races.map((x) => ({ ...x, localRaceUuid: localUuidOf(x.race.uuid!) })), removed: r.removed ?? [] };
}

/** Downloads a shared race onto this Device (or refreshes it) and returns its local uuid. */
export async function openSharedRace(serverRaceUuid: string): Promise<string> {
  let local = localUuidOf(serverRaceUuid);
  if (!local) {
    local = serverRaceUuid; // a race joined from the server keeps the server's id locally
    setLink(local, { serverRaceUuid, lastSeq: 0, linkedAt: new Date().toISOString() });
  }
  await loadSnapshot(local);
  return local;
}

/**
 * Owner: finish a shared race on the server (closes every wave, signs the result),
 * then bring the local copy up to date and stamp it with the official record.
 */
export async function finalizeShared(local: string): Promise<number> {
  await flush(local); // send queued laps first, so they are in the official result
  const { official } = await team.finalize(local);
  await catchUp(local);
  const race = useRaceStore.getState().races.find((r) => r.uuid === local);
  const o = official as unknown as Record<string, unknown>;
  if (race) {
    await applyingRemote(() =>
      useRaceStore.getState().updateRace({
        ...race,
        finalized: {
          version: String(o.version), algo: "SHA-256", at: String(o.at), by: String(o.by), nonce: String(o.nonce),
          payload: String(o.payload), token: String(o.token), riderCount: Number(o.riderCount), categoryCount: Number(o.categoryCount),
        },
      }),
    );
  }
  return Number(o.riderCount);
}

// --- members, invitations, directory (thin wrappers for the Team screens) ---

export const team = {
  members: (local: string) => api<{ members: Member[] }>("GET", `/races/${linkOf(local)!.serverRaceUuid}/members`),
  updateMember: (local: string, userId: string, body: { roles?: MemberRole[]; permissions?: MemberPermissions }) =>
    api("PATCH", `/races/${linkOf(local)!.serverRaceUuid}/members/${userId}`, body),
  removeMember: (local: string, userId: string) => api("DELETE", `/races/${linkOf(local)!.serverRaceUuid}/members/${userId}`),
  invite: (local: string, body: Record<string, unknown>) =>
    api<{ invitations: { id: string; email: string | null; userId: string | null; link: boolean; url: string; qrSvg: string }[] }>(
      "POST", `/races/${linkOf(local)!.serverRaceUuid}/invitations`, body),
  invitations: (local: string) => api<{ invitations: Record<string, unknown>[] }>("GET", `/races/${linkOf(local)!.serverRaceUuid}/invitations`),
  revokeInvitation: (local: string, id: string) => api("DELETE", `/races/${linkOf(local)!.serverRaceUuid}/invitations/${id}`),
  devices: (local: string) => api<{ devices: Record<string, unknown>[] }>("GET", `/races/${linkOf(local)!.serverRaceUuid}/devices`),
  history: (local: string, riderUuid?: string) =>
    api<{ events: Record<string, unknown>[] }>("GET", `/races/${linkOf(local)!.serverRaceUuid}/history${riderUuid ? `?riderUuid=${riderUuid}` : ""}`),
  finalize: (local: string) => api<{ official: Record<string, unknown> }>("POST", `/races/${linkOf(local)!.serverRaceUuid}/finalize`),
  amend: (local: string, reason: string, includeActionIds: string[]) =>
    api<{ official: Record<string, unknown> }>("POST", `/races/${linkOf(local)!.serverRaceUuid}/amend`, { reason, includeActionIds }),
  official: (local: string) => api<{ versions: Record<string, unknown>[]; publicKey: string | null }>("GET", `/races/${linkOf(local)!.serverRaceUuid}/official`),
  deleteRace: (local: string) => api("DELETE", `/races/${linkOf(local)!.serverRaceUuid}`),
  /** 0.2: owner switches judges' writes on/off for this race; access arrives over the socket. */
  setMemberWrites: async (local: string, enabled: boolean) => {
    const r = await api<{ memberWrites: boolean }>("PUT", `/races/${linkOf(local)!.serverRaceUuid}/member-writes`, { enabled });
    const a = accessFor(local);
    if (a) cacheAccess(local, { ...a, memberWrites: r.memberWrites }); // the owner's socket gets no refresh
    return r;
  },
};

export interface Member {
  userId: string;
  name: string;
  email: string | null;
  roles: MemberRole[];
  permissions: MemberPermissions;
  isOwner: boolean;
  revokedAt: string | null;
}

export const invitations = {
  preview: (token: string) =>
    api<{ id: string; raceUuid: string; raceName: string; raceDate: string; invitedBy: string; roles: MemberRole[]; waves: number[] | null; status: string; forEmail: string | null; canAccept: boolean }>(
      "GET", `/invitations/${token}`),
  accept: (token: string) => api<{ raceUuid: string }>("POST", `/invitations/${token}/accept`),
  mine: () => api<{ invitations: { id: string; raceUuid: string; raceName: string; raceDate: string; invitedBy: string; roles: MemberRole[]; waves: number[] | null }[] }>("GET", "/me/invitations"),
  acceptMine: (id: string) => api<{ raceUuid: string }>("POST", `/me/invitations/${id}/accept`),
  decline: (id: string) => api("POST", `/me/invitations/${id}/decline`),
};

export const directory = {
  contacts: () => api<{ contacts: { id: string; name: string; email: string | null; userId: string | null; groupIds: string[] }[] }>("GET", "/me/contacts"),
  addContact: (name: string, email: string) => api("POST", "/me/contacts", { name, email }),
  removeContact: (id: string) => api("DELETE", `/me/contacts/${id}`),
  groups: () => api<{ groups: { id: string; name: string; contactIds: string[] }[] }>("GET", "/me/groups"),
  addGroup: (name: string) => api<{ group: { id: string; name: string } }>("POST", "/me/groups", { name }),
  removeGroup: (id: string) => api("DELETE", `/me/groups/${id}`),
  setGroupContacts: (id: string, contactIds: string[]) => api("PUT", `/me/groups/${id}/contacts`, { contactIds }),
  lookupUser: (email: string) => api<{ user: { id: string; name: string } }>("GET", `/me/users/lookup?email=${encodeURIComponent(email)}`),
};

// ---------------------------------------------------------------------------
// Start

let started = false;
/** Installs the bridge and starts background sync. Called once from App when a server is configured. */
export function startLive() {
  if (started) return;
  started = true;
  setLiveBridge(bridge);
  window.addEventListener("online", () => {
    useLiveStore.setState({ online: true });
    void flushPendingDeletes();
    void flushAll();
  });
  window.addEventListener("offline", () => useLiveStore.setState({ online: false }));
  // Back on a hidden tab: catch up only if the live socket missed something meanwhile.
  document.addEventListener("visibilitychange", () => {
    const open = useLiveStore.getState().openRace;
    if (open && linkOf(open) && fallbackNeeded(open)) void catchUp(open);
  });
  setInterval(() => {
    void flushAll();
    void publishPending();
    void flushPendingDeletes();
  }, 15_000);
  if (session) {
    void auth.me().catch(() => {});
    void flushAll();
    void publishPending();
  }
}

// ---------------------------------------------------------------------------
// Create Race (signed in): sync first, server-only new races

/**
 * Brings every server race of the signed-in account onto this device before a
 * new race is created: races not here yet are downloaded and linked; races
 * already here (linked) are caught up — matched by server uuid, so nothing is
 * downloaded twice and local queued changes are kept. Throws when the list
 * can't be fetched or a race can't be downloaded.
 */
export interface SyncResult {
  downloaded: number;
  updated: number;
  /** Races of this account on the server (after removed / pending deletes). */
  total: number;
  /** Races that could not be downloaded or caught up (the rest still synced). */
  failed: { serverRaceUuid: string; name: string; reason: string }[];
}

let syncing: Promise<SyncResult> | null = null;
/** One race-list sync at a time (sign-in, main screen and Create Race share it). */
export function syncMyRaces(): Promise<SyncResult> {
  syncing ??= syncMyRacesOnce().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function syncMyRacesOnce(): Promise<SyncResult> {
  if (!session) throw new LiveApiError(401, "signed_out", "Sign in first");
  const account = session.user.id;
  await purgeApiCache(); // never a race list cached under another account
  await flushPendingDeletes();
  const { races: all, removed } = await myRacesWithRemoved();
  if (session?.user.id !== account) throw new LiveApiError(409, "account_changed", "The account changed during sync");
  // Deleted by the owner, or hidden by me: remove this device's copy (never re-download it).
  for (const serverUuid of removed) {
    const local = localUuidOf(serverUuid);
    if (local) await removeDeletedRace(local);
  }
  const pendingDel = new Set(readPendingDeletes());
  const list = all.filter((r) => !pendingDel.has(r.race.uuid ?? ""));
  rememberAccountRaces(list.map((r) => r.race.uuid).filter((u): u is string => !!u));
  const result: SyncResult = { downloaded: 0, updated: 0, total: list.length, failed: [] };
  for (const r of list) {
    const serverRaceUuid = r.race.uuid;
    if (!serverRaceUuid) continue;
    if (session?.user.id !== account) break; // signed out / switched meanwhile
    const local = localUuidOf(serverRaceUuid);
    try {
      if (local) {
        // Matched by server uuid: no duplicate; queued local changes are kept and sent.
        await catchUp(local);
        result.updated++;
      } else {
        await openSharedRace(serverRaceUuid);
        result.downloaded++;
      }
    } catch (e) {
      result.failed.push({ serverRaceUuid, name: r.race.name ?? "Race", reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

/**
 * A new race the server did not take: remove it from this device and from the
 * upload queue, so no local-only race is left behind (Create Race needs the cloud).
 */
export async function discardUnsavedNewRace(local: string): Promise<void> {
  if (linkOf(local)) return; // it did reach the server after all: keep it
  removePending(local);
  // Not linked, so the sync bridge sends nothing for these deletes. Race before
  // riders (deleting the race lifts any lock for the cleanup — see CLAUDE.md).
  const cats = useCategoryStore.getState().categories.filter((c) => c.raceUuid === local);
  for (const c of cats) await useCategoryStore.getState().deleteCategory(c.id);
  await useRaceStore.getState().deleteRace(local);
  await useRiderStore.getState().deleteRidersByRace(local);
}
