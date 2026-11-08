/**
 * The spectator page's data (0.3.4): the public race + its refresh loop.
 * Plain GETs of the public endpoints only (no session, no socket, no IndexedDB).
 *
 *  - Refresh delay from publicRefresh.ts (≈60 s while a wave runs, 5 min between
 *    waves, none once guest polling has closed).
 *  - Never two requests at once: a refresh asked while one is in flight joins it.
 *  - Paused while the tab is hidden; returning revalidates if the data is older
 *    than 15 s. Manual Refresh is throttled (10 s).
 *  - 410 from /changes (window closed): load the race one last time, then stop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPublicChanges, fetchPublicRace, PublicApiError, type PublicPolling } from "@/services/live/publicRace";
import type { SharedCategory, SharedRace, SharedRider } from "../../shared/race/state";
import { PUBLIC_FOCUS_REVALIDATE_MIN_MS, PUBLIC_MANUAL_REFRESH_MIN_MS, publicRefreshDelay } from "./publicRefresh";

export type PublicRider = Partial<SharedRider>;

export function usePublicRaceFeed(token: string) {
  const [race, setRace] = useState<Partial<SharedRace> | null>(null);
  const [categories, setCategories] = useState<Map<string, SharedCategory>>(new Map());
  const [riders, setRiders] = useState<Map<string, PublicRider>>(new Map());
  const [polling, setPolling] = useState<PublicPolling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const seq = useRef(0);
  const loaded = useRef(false);
  const pollingOpen = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const lastRequest = useRef(0);

  const loadAll = useCallback(async () => {
    const r = await fetchPublicRace(token);
    seq.current = r.lastSeq;
    loaded.current = true;
    pollingOpen.current = !!r.polling?.open;
    setRace(r.race);
    setCategories(new Map(r.categories.map((c) => [c.uuid, c])));
    setRiders(new Map(r.riders.filter((x) => x.uuid).map((x) => [x.uuid!, x])));
    setPolling(r.polling);
  }, [token]);

  const loadChanges = useCallback(async () => {
    try {
      const ch = await fetchPublicChanges(token, seq.current);
      if (ch.full) {
        seq.current = ch.lastSeq;
        setRace(ch.race ?? null);
        setCategories(new Map((ch.categories ?? []).map((c) => [c.uuid, c])));
        setRiders(new Map((ch.riders ?? []).filter((x) => x.uuid).map((x) => [x.uuid!, x])));
      } else if (!ch.unchanged) {
        seq.current = ch.lastSeq;
        if (ch.race) setRace(ch.race);
        if (ch.categories?.length) setCategories((m) => { const n = new Map(m); for (const c of ch.categories!) n.set(c.uuid, c); return n; });
        if (ch.riders?.length) setRiders((m) => { const n = new Map(m); for (const r of ch.riders!) if (r.uuid) n.set(r.uuid, r); return n; });
      }
      pollingOpen.current = !!ch.polling?.open;
      setPolling(ch.polling);
    } catch (e) {
      if (e instanceof PublicApiError && e.status === 410) {
        // Live updates ended: the race one last time (always readable), then no more polling.
        await loadAll();
        pollingOpen.current = false;
        setPolling((p) => (p ? { ...p, open: false } : p));
        return;
      }
      throw e;
    }
  }, [token, loadAll]);

  /** One request at a time; a call while one runs returns that one. */
  const fetchNow = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    lastRequest.current = Date.now();
    setRefreshing(true);
    const p = (async () => {
      try {
        if (loaded.current && pollingOpen.current) await loadChanges();
        else await loadAll();
        setUpdatedAt(Date.now());
        setOffline(false);
        setError(null);
      } catch (e) {
        if (!loaded.current) {
          setError(e instanceof PublicApiError && e.status === 404 ? "This race link is not valid or the race was removed." : e instanceof Error ? e.message : String(e));
        } else setOffline(true); // keep showing the last results
      } finally {
        lastRequest.current = Date.now(); // throttles count from the answer, not the ask
        inFlight.current = null;
        setRefreshing(false);
      }
    })();
    inFlight.current = p;
    return p;
  }, [loadAll, loadChanges]);

  // Open the race (always allowed — also once it is finished).
  useEffect(() => {
    seq.current = 0;
    loaded.current = false;
    void fetchNow();
  }, [fetchNow]);

  const categoryList = useMemo(() => [...categories.values()], [categories]);
  const delay = publicRefreshDelay(polling?.open, race, categoryList);

  // Automatic refresh: paused while hidden, revalidate on return.
  useEffect(() => {
    if (delay == null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), delay);
    };
    const run = async () => {
      timer = null;
      if (stopped || document.visibilityState !== "visible") return; // hidden: wait for the tab to come back
      await fetchNow();
      if (!stopped) schedule();
    };
    const onVisible = () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (Date.now() - lastRequest.current >= PUBLIC_FOCUS_REVALIDATE_MIN_MS) {
        if (timer) clearTimeout(timer);
        void run();
      } else if (!timer) schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [delay, fetchNow]);

  /** Refresh button: throttled, never overlapping. Returns false when ignored. */
  const refresh = useCallback((): boolean => {
    if (inFlight.current || Date.now() - lastRequest.current < PUBLIC_MANUAL_REFRESH_MIN_MS) return false;
    void fetchNow();
    return true;
  }, [fetchNow]);

  return { race, categories: categoryList, riders, polling, error, offline, updatedAt, refreshing, live: delay != null, refresh };
}
