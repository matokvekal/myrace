import { useEffect, useRef, useState } from "react";

/**
 * A "Joker" is an unidentified rider's tap — captured instantly (time +
 * arrival order) when the commissaire can't read a bib fast enough, resolved
 * to a real rider afterward via `recordLap(rider, "click", new Date(capturedAt))`
 * in useLapRecording. Kept out of the riders store entirely: nothing here is
 * a RiderProps, so calculatePositions/results/standing never see it until
 * (if ever) it's resolved.
 */
export interface JokerEntry {
  id: string;
  /** 1, 2, 3... within this wave — shown on the card so order is obvious at a glance. */
  sequence: number;
  /** ISO timestamp, captured the instant the Joker button is tapped. */
  capturedAt: string;
}

const STORAGE_PREFIX = "commissaire.jokers.";

function loadPersistedJokers(key: string | null): JokerEntry[] {
  if (!key || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JokerEntry[]) : [];
  } catch {
    return [];
  }
}

export function useJokerQueue(persistKey: string | null) {
  const [jokers, setJokers] = useState<JokerEntry[]>(() => loadPersistedJokers(persistKey));

  // Same hydrate-on-key-change / guard-against-stale-write pattern as the
  // action log in useLapRecording.ts, so switching waves never bleeds one
  // wave's pending jokers into another's storage key.
  const persistKeyRef = useRef<string | null>(persistKey);
  const pendingHydrationRef = useRef<JokerEntry[] | null>(null);
  const sequenceRef = useRef(0);

  useEffect(() => {
    persistKeyRef.current = persistKey;
    const loaded = loadPersistedJokers(persistKey);
    sequenceRef.current = loaded.reduce((max, j) => Math.max(max, j.sequence), 0);
    pendingHydrationRef.current = loaded;
    setJokers(loaded);
  }, [persistKey]);

  useEffect(() => {
    if (pendingHydrationRef.current === jokers) {
      pendingHydrationRef.current = null;
      return;
    }
    if (pendingHydrationRef.current !== null) return;
    const key = persistKeyRef.current;
    if (!key || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(jokers));
    } catch {
      /* quota / serialization — pending jokers are a convenience queue, never block recording. */
    }
  }, [jokers]);

  const addJoker = (): void => {
    sequenceRef.current += 1;
    const entry: JokerEntry = {
      id: `joker-${Date.now()}-${sequenceRef.current}`,
      sequence: sequenceRef.current,
      capturedAt: new Date().toISOString(),
    };
    setJokers((prev) => [...prev, entry]);
  };

  const removeJoker = (id: string): void => {
    setJokers((prev) => prev.filter((j) => j.id !== id));
  };

  return { jokers, addJoker, removeJoker };
}
