import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { openLiveRace, useLiveStore } from "@/services/live/liveClient";
import styles from "./live.module.css";

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

  return (
    <span className={styles.sync} data-testid="sync-badge" title={sync?.notApplied.length ? `${sync.notApplied.length} not applied` : undefined}>
      <span className={state.cls} />
      {state.text}
    </span>
  );
}
