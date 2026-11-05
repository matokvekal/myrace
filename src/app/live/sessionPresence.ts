/**
 * Is someone signed in on this device? Read from the stored server session, so
 * route guards can decide without loading the whole live client. liveClient
 * dispatches SESSION_EVENT whenever it signs in, refreshes or signs out.
 */
import { useEffect, useState } from "react";

export const SESSION_KEY = "commissaire.live.session";
export const SESSION_EVENT = "commissaire:session";

export function hasSession(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null")?.accessToken;
  } catch {
    return false;
  }
}

export function useHasSession(): boolean {
  const [signedIn, setSignedIn] = useState(hasSession);
  useEffect(() => {
    const update = () => setSignedIn(hasSession());
    window.addEventListener(SESSION_EVENT, update);
    window.addEventListener("storage", update); // signed in / out in another tab
    return () => {
      window.removeEventListener(SESSION_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return signedIn;
}
