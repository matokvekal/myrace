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

export const setLiveBridge = (b: LiveBridge | null) => {
  bridge = b;
};

/** The bridge, unless remote changes are being applied (those must not echo back as Actions). */
export const liveBridge = (): LiveBridge | null => (remoteDepth > 0 ? null : bridge);

/** True while server changes are applied (the server, not the local lock, decides then). */
export const isApplyingRemote = () => remoteDepth > 0;

/** Runs store writes that come FROM the server, so they are not sent back. */
export async function applyingRemote<T>(fn: () => Promise<T>): Promise<T> {
  remoteDepth += 1;
  try {
    return await fn();
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
