import React, { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { openLiveRace, useLiveStore } from "@/services/live/liveClient";
import styles from "./live.module.css";

const RejectedActions = lazy(() => import("./RejectedActions"));

/**
 * Shared race on screen: joins its live room (leaving the previous race's) and
 * shows the sync state quietly — never a modal during a race (FR-31).
 *
 * `compact` (Live top bar): the state is a coloured dot (full text for screen readers and
 * on hover); anything that needs attention — not-applied Actions, offline, no access,
 * signed out — shows a warning icon (with the not-applied count) that opens the details.
 * Same data and the same review list as the full badge; nothing is hidden or dropped.
 */
export default function SyncBadge({ raceUuid, compact = false }: { raceUuid: string; compact?: boolean }) {
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
  const notAppliedText = t("live.notAppliedCount", "{{n}} not applied", { n: notApplied });

  if (compact) {
    const warn = state.cls === styles.dotWarn;
    const alert = notApplied > 0 || warn;
    const open = showRejected && alert;
    return (
      <>
        <span className={styles.syncCompact} data-testid="sync-badge" title={notApplied ? `${state.text} · ${notAppliedText}` : state.text}>
          <span className={state.cls} aria-hidden="true" />
          <span className={styles.srOnly}>{state.text}</span>
          {alert && (
            <button
              type="button"
              className={styles.alertBtn}
              data-testid={notApplied > 0 ? "not-applied-open" : "sync-alert-open"}
              data-tone={notApplied > 0 ? "error" : "warn"}
              aria-expanded={open}
              aria-haspopup="dialog"
              onClick={() => setShowRejected((v) => !v)}
            >
              <AlertTriangle size={18} aria-hidden="true" />
              {notApplied > 0 && <span className={styles.alertCount} aria-hidden="true">{notApplied > 99 ? "99+" : notApplied}</span>}
              <span className={styles.srOnly}>{notApplied > 0 ? notAppliedText : state.text}</span>
            </button>
          )}
        </span>
        {open && notApplied > 0 && (
          <Suspense fallback={null}>
            <RejectedActions raceUuid={raceUuid} count={notApplied} statusText={state.text} onClose={() => setShowRejected(false)} />
          </Suspense>
        )}
        {open && notApplied === 0 && (
          <div className={`${styles.card} ${styles.sheet}`} data-testid="sync-details" role="region" aria-label={t("live.syncTitle", "Sync")}>
            <div className={styles.spread}>
              <strong>{t("live.syncTitle", "Sync")}</strong>
              <button className={styles.link} onClick={() => setShowRejected(false)}>{t("live.close", "Close")}</button>
            </div>
            <p dir="auto">{state.text}</p>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <span className={styles.sync} data-testid="sync-badge" title={notApplied ? `${notApplied} not applied` : undefined}>
        <span className={state.cls} />
        {state.text}
        {notApplied > 0 && (
          // Kept on the device for review (0.2): one tap opens the list; never a modal mid-race.
          <button className={styles.link} data-testid="not-applied-open" onClick={() => setShowRejected((v) => !v)}>
            {" · "}{notAppliedText}
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
