import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { syncRaceNow } from "@/services/live/liveClient";
import styles from "./live.module.css";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; pending: number } | { kind: "error"; message: string };

/**
 * Live screen, shared race: one tap sends what is queued, then reloads the race from the
 * server (the authoritative copy). Unsent changes stay queued; nothing is discarded.
 * The real-time socket keeps working on its own — this is for "my screen looks wrong".
 */
export default function SyncNowButton({ raceUuid }: { raceUuid: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "idle" });
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clearRef.current) clearTimeout(clearRef.current); }, []);

  const run = async () => {
    if (state.kind === "busy") return;
    if (clearRef.current) clearTimeout(clearRef.current);
    setState({ kind: "busy" });
    try {
      const res = await syncRaceNow(raceUuid);
      setState({ kind: "ok", pending: res.pending });
      clearRef.current = setTimeout(() => setState({ kind: "idle" }), 4000);
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.syncNow}
        data-testid="live-sync-now"
        onClick={() => void run()}
        disabled={state.kind === "busy"}
        aria-busy={state.kind === "busy"}
        title={t("live.syncNowHint", "Send what is waiting, then reload this race from the server")}
      >
        {state.kind === "busy" ? <span className={styles.syncNowSpin} aria-hidden="true" /> : <span aria-hidden="true">⟳</span>}
        {state.kind === "busy" ? t("live.syncNowBusy", "Syncing…") : t("live.syncNow", "Sync")}
      </button>
      <span role="status" aria-live="polite" dir="auto" data-testid="live-sync-now-status">
        {state.kind === "ok" && (
          <span className={styles.syncNowMsg}>
            {state.pending > 0
              ? t("live.syncNowPending", "Synced · {{n}} still waiting to send", { n: state.pending })
              : t("live.syncNowDone", "Synced")}
          </span>
        )}
        {state.kind === "error" && (
          <span className={styles.syncNowErr}>
            {t("live.syncNowFailed", "Sync failed: {{msg}}", { msg: state.message })}
          </span>
        )}
      </span>
    </>
  );
}
