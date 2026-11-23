/**
 * "My riders" on the public LIVE tab: a spectator stars riders to follow them (star + subtle
 * row highlight; rows keep their real positions).
 * Per browser and per share link (localStorage `commissaire.myRiders.v1.<token>`), never sent
 * anywhere. Every read/write is guarded: private mode or blocked storage just means the
 * stars last for this visit only.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const MY_RIDERS_MAX = 50;
const key = (token: string) => `commissaire.myRiders.v1.${token}`;

export function loadMyRiders(token: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(token)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, MY_RIDERS_MAX) : [];
  } catch {
    return [];
  }
}

function saveMyRiders(token: string, ids: string[]): void {
  try {
    if (ids.length) localStorage.setItem(key(token), JSON.stringify(ids));
    else localStorage.removeItem(key(token));
  } catch {
    /* storage unavailable: kept in memory for this visit */
  }
}

/** Toggle in starring order (newest last); the oldest drops off past the maximum. */
export function toggleId(ids: readonly string[], uuid: string): string[] {
  return ids.includes(uuid) ? ids.filter((x) => x !== uuid) : [...ids, uuid].slice(-MY_RIDERS_MAX);
}

export interface MyRiders {
  ids: string[];
  has: (uuid: string | undefined | null) => boolean;
  toggle: (uuid: string) => void;
}

export function useMyRiders(token: string): MyRiders {
  const [ids, setIds] = useState<string[]>(() => loadMyRiders(token));
  useEffect(() => setIds(loadMyRiders(token)), [token]);
  const toggle = useCallback(
    (uuid: string) =>
      setIds((prev) => {
        const next = toggleId(prev, uuid);
        saveMyRiders(token, next);
        return next;
      }),
    [token],
  );
  const set = useMemo(() => new Set(ids), [ids]);
  const has = useCallback((uuid: string | undefined | null) => !!uuid && set.has(uuid), [set]);
  return useMemo(() => ({ ids, has, toggle }), [ids, has, toggle]);
}

const NONE: MyRiders = { ids: [], has: () => false, toggle: () => {} };
export const MyRidersContext = createContext<MyRiders>(NONE);
export const useMyRidersContext = () => useContext(MyRidersContext);

