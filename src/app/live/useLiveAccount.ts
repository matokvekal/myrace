import { useEffect, useState } from "react";
import type { LiveUser } from "@/services/live/liveClient";

type LiveClient = typeof import("@/services/live/liveClient");

/** True when this build talks to the Commissaire server (accounts exist at all). */
export const accountsEnabled = !!import.meta.env.VITE_SERVER_URL;

/**
 * The signed-in account of the Commissaire server (the ONE sign-in system:
 * /account, liveClient's session), for eagerly loaded UI such as the side menu.
 * The live client is loaded on demand, so pages that only need "who is signed
 * in" don't pull it into their first load. Always null without a server.
 */
export function useLiveAccount(): { user: LiveUser | null; logout: () => Promise<void> } {
  const [client, setClient] = useState<LiveClient | null>(null);
  const [user, setUser] = useState<LiveUser | null>(null);

  useEffect(() => {
    if (!accountsEnabled) return;
    let unsub = () => {};
    let alive = true;
    void import("@/services/live/liveClient").then((m) => {
      if (!alive) return;
      setClient(m);
      setUser(m.useLiveStore.getState().user);
      unsub = m.useLiveStore.subscribe((s) => setUser(s.user));
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  // Signing out keeps every race on this device; only the session ends.
  const logout = async () => {
    if (client) await client.auth.logout();
  };
  return { user, logout };
}
