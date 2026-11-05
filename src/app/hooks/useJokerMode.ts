import { useState, useEffect } from 'react';

const KEY = 'commissaire.jokerEnabled';

/**
 * Side-menu opt-in for the "Joker" button on the live wave screen — lets a
 * commissaire stamp a tap's time+arrival slot before they've identified the
 * rider, then resolve it to a bib afterward. Off by default so it can't
 * change behavior for anyone who hasn't turned it on.
 */
export function useJokerMode() {
  const [jokerEnabled, setJokerEnabledState] = useState<boolean>(() => {
    return localStorage.getItem(KEY) === 'true';
  });

  useEffect(() => {
    localStorage.setItem(KEY, String(jokerEnabled));
  }, [jokerEnabled]);

  const setJokerEnabled = (v: boolean) => setJokerEnabledState(v);
  const toggleJokerEnabled = () => setJokerEnabledState((v) => !v);

  return { jokerEnabled, setJokerEnabled, toggleJokerEnabled };
}
