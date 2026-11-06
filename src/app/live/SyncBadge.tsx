import React, { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openLiveRace, useLiveStore } from "@/services/live/liveClient";
import styles from "./live.module.css";

const RejectedActions = lazy(() => import("./RejectedActions"));

/**
 * Shared race on screen: joins its live room (leaving the previous race's) and
 * shows the sync state quietly — never a modal during a race (FR-31).
 */
export default function SyncBadge({ raceUuid }: { raceUuid: string }) {
  const { t } = useTranslation();
  const sync = useLiveStore((s) => s.sync[raceUuid]);
  const connected = useLiveStore((s) => s.socketConnected);
  const online = useLiveStore((s) => s.online);
  const signedIn = useLiveStore((s) => !!s.user);
  const [showRejected, setShowRejected] = useState(false);

  useEffect(() => {
    void openLiveRace(raceUuid);
  }, [raceUuid]);

  const pending = sync?.pending ?? 0;
  const state = sync?.revoked
    ? { cls: styles.dotWarn, text: t("live.syncRevoked", "No access") }
    : !signedIn
      ? { cls: styles.dotWarn, text: t("live.syncSignedOut", "Sign in to sync") }
      : !online || !connected
        ? { cls: styles.dotWarn, text: pending ? t("live.syncOfflinePending", "Offline · {{n}} waiting", { n: pending }) : t("live.syncOffline", "Offline") }
        : pending
          ? { cls: styles.dot, text: t("live.syncSending", "Sending {{n}}", { n: pending }) }
          : { cls: styles.dotOk, text: t("live.synced", "Synced") };

  const notApplied = sync?.notApplied.length ?? 0;
  return (
    <>
      <span className={styles.sync} data-testid="sync-badge" title={notApplied ? `${notApplied} not applied` : undefined}>
        <span className={state.cls} />
        {state.text}
        {notApplied > 0 && (
          // Kept on the device for review (0.2): one tap opens the list; never a modal mid-race.
          <button className={styles.link} data-testid="not-applied-open" onClick={() => setShowRejected((v) => !v)}>
            {" · "}{t("live.notAppliedCount", "{{n}} not applied", { n: notApplied })}
          </button>
        )}
      </span>
      {showRejected && notApplied > 0 && (
        <Suspense fallback={null}>
          <RejectedActions raceUuid={raceUuid} count={notApplied} onClose={() => setShowRejected(false)} />
        </Suspense>
      )}
    </>
  );
}
