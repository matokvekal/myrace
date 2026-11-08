/**
 * Main screen: brings the signed-in account's races from the server, every time
 * the screen opens and whenever the account changes — never "once per session",
 * so a failed or stale sync can't leave the list empty until the tab is closed.
 * syncMyRaces matches races by server uuid (no duplicates), keeps local queued
 * changes (catch-up sends them first) and never deletes a never-uploaded race.
 * The state is always visible: syncing / synced (N races) / failed + Retry.
 */
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { syncMyRaces, useLiveStore, type SyncResult } from "@/services/live/liveClient";
import styles from "./accountSync.module.css";

type State = { kind: "idle" } | { kind: "syncing" } | { kind: "done"; result: SyncResult } | { kind: "error"; message: string };

export default function AccountSync() {
  const userId = useLiveStore((s) => s.user?.id ?? null);
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = useCallback(async () => {
    setState({ kind: "syncing" });
    try {
      setState({ kind: "done", result: await syncMyRaces() });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    if (!userId) return setState({ kind: "idle" });
    void run();
  }, [userId, run]);

  // 0.3: sync runs silently on every visit; only a real failure is shown (with Retry).
  if (!userId || state.kind !== "error") return null;
  return (
    <div className={styles.bar} data-state="error" data-testid="account-sync" role="alert">
      <AlertTriangle size={15} aria-hidden="true" />
      <span dir="auto">Couldn't sync your races: {state.message}</span>
      <button type="button" className={styles.retry} onClick={() => void run()} data-testid="account-sync-retry">
        <RefreshCw size={13} aria-hidden="true" /> Retry
      </button>
    </div>
  );
}
