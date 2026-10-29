/**
 * The seam between the app's stores and the multi-user client — tiny on purpose
 * (no dependencies), because every store imports it eagerly.
 *
 * Local races never touch it: `isLiveRace()` is false and the stores behave as
 * before. For a shared race the live client (services/live/liveClient.ts, loaded
 * on demand only when VITE_SERVER_URL is set) installs a bridge that turns store
 * writes into Actions, or blocks a write the member's role does not allow.
 */
import type { CategoryProps, RaceProps, RiderProps } from "@/types/types";

export interface LiveBridge {
  /**
   * Called by a store before it writes. Returns false to block the write (the
   * member may not do this). May assign `uuid`s on new records before the write.
   */
  beforeRiders(kind: "add" | "import" | "update" | "delete", before: RiderProps[], after: RiderProps[]): boolean;
  beforeCategories(kind: "upsert" | "delete", before: CategoryProps[], after: CategoryProps[]): boolean;
  beforeRace(before: RaceProps, after: RaceProps): boolean;
  /** May the member send this Action? (Warns the user when not.) */
  allows(localRaceUuid: string, type: string, payload: Record<string, unknown>): boolean;
}

/** localStorage key of the shared-race links: { [localRaceUuid]: LiveLink }. */
export const LIVE_LINKS_KEY = "commissaire.live.links";

export interface LiveLink {
  serverRaceUuid: string;
  /** Last Race sequence this Device has applied. */
  lastSeq: number;
  linkedAt: string;
}

export function readLinks(): Record<string, LiveLink> {
  try {
    return JSON.parse(localStorage.getItem(LIVE_LINKS_KEY) ?? "{}") as Record<string, LiveLink>;
  } catch {
    return {};
  }
}

/** True for a race shared through the server (synchronous, safe to call anywhere). */
export const isLiveRace = (localRaceUuid: string | null | undefined): boolean =>
  !!localRaceUuid && !!import.meta.env.VITE_SERVER_URL && !!readLinks()[localRaceUuid];

let bridge: LiveBridge | null = null;
let remoteDepth = 0;

/**
 * Writes on a shared race made before the live client finished loading (it is a
 * dynamic import): kept here and handed to the bridge once installed, so they
 * are sent instead of staying on this Device only. New records get their shared
 * uuid now, so what the store saves matches what is sent later.
 */
type Deferred = (b: LiveBridge) => void;
let deferred: Deferred[] = [];

const raceOf = (before: { raceUuid: string }[], after: { raceUuid: string }[]) => (after[0] ?? before[0])?.raceUuid;

const deferringBridge: LiveBridge = {
  beforeRiders(kind, before, after) {
    if (!isLiveRace(raceOf(before, after))) return true;
    if (kind === "add" || kind === "import") for (const r of after) r.uuid ??= crypto.randomUUID();
    deferred.push((b) => b.beforeRiders(kind, before, after));
    return true;
  },
  beforeCategories(kind, before, after) {
    if (!isLiveRace(raceOf(before, after))) return true;
    const prevById = new Map(before.map((c) => [c.id, c]));
    if (kind === "upsert") for (const c of after) c.uuid ??= prevById.get(c.id)?.uuid ?? crypto.randomUUID();
    deferred.push((b) => b.beforeCategories(kind, before, after));
    return true;
  },
  beforeRace(before, after) {
    if (!isLiveRace(after.uuid)) return true;
    deferred.push((b) => b.beforeRace(before, after));
    return true;
  },
  allows: () => true, // the server still decides; a refusal shows as "Not applied"
};

export const setLiveBridge = (b: LiveBridge | null) => {
  bridge = b;
  if (!b) return;
  const queued = deferred;
  deferred = [];
  for (const replay of queued) replay(b);
};

/**
 * The bridge, unless remote changes are being applied (those must not echo back
 * as Actions). Before the live client has loaded, a stand-in that defers writes.
 */
export const liveBridge = (): LiveBridge | null =>
  remoteDepth > 0 ? null : (bridge ?? (import.meta.env.VITE_SERVER_URL ? deferringBridge : null));

/** True while server changes are applied (the server, not the local lock, decides then). */
export const isApplyingRemote = () => remoteDepth > 0;

/**
 * Runs ONE store write that comes FROM the server, so it is not sent back.
 * Wrap each write on its own: the flag is up only while `write` starts, which is
 * where every store write consults the bridge and the finalized lock (before its
 * first await). Holding it across awaits would swallow a user's edit made while
 * the server's IndexedDB writes are still in flight.
 */
export function applyingRemote<T>(write: () => Promise<T>): Promise<T> {
  remoteDepth += 1;
  try {
    return write();
  } finally {
    remoteDepth -= 1;
  }
}

/** Live-screen Actions that have no store diff (laps, undo, finish, waves, finalize). */
export async function liveDispatch(
  localRaceUuid: string,
  type: string,
  payload: Record<string, unknown>,
  opts: { atMs?: number; actionId?: string } = {},
): Promise<string | null> {
  if (!isLiveRace(localRaceUuid)) return null;
  const { dispatchAction } = await import("./liveClient");
  return dispatchAction(localRaceUuid, type, payload, opts);
}

/**
 * For call sites that change local state AND send an Action (laps, waves):
 * false when this is a shared race and the member's role does not allow it.
 * Always true for local races.
 */
export const liveAllows = (localRaceUuid: string | null | undefined, type: string, payload: Record<string, unknown>): boolean =>
  !isLiveRace(localRaceUuid) || !bridge || bridge.allows(localRaceUuid!, type, payload);

export const LIVE_ACCESS_EVENT = "commissaire-live-access";

/** The member's screen access for a shared race (cached by the live client), or null. */
export function readLiveAccess(localRaceUuid: string): { isOwner: boolean; screens: Record<string, { view: boolean; create: boolean; update: boolean; delete: boolean }> } | null {
  if (!isLiveRace(localRaceUuid)) return null;
  try {
    return JSON.parse(localStorage.getItem(`commissaire.live.access.${localRaceUuid}`) ?? "null");
  } catch {
    return null;
  }
}

/** May the member see this screen? Always true for local races and before access is known. */
export const canViewScreen = (localRaceUuid: string, screen: string): boolean => {
  const a = readLiveAccess(localRaceUuid);
  return !a || !!a.screens[screen]?.view;
};

/** Synchronous id for an Action the caller wants to remember (e.g. a lap it can undo later). */
export const newActionId = (): string => globalThis.crypto.randomUUID();
