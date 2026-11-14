import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { dismissRejected, rejectedActions, type RejectedAction } from "@/services/live/liveClient";
import useRiderStore from "@/stores/ridersStore";
import styles from "./live.module.css";

/**
 * Actions this device recorded that the server did not apply (0.2). They stay on the device
 * for review — e.g. a lap recorded offline after the judge's access was removed — and leave
 * only when the user dismisses them. Opened from the sync badge; never a modal during a race.
 */
export default function RejectedActions({ raceUuid, count, onClose, statusText }: { raceUuid: string; count: number; onClose: () => void; statusText?: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<RejectedAction[]>([]);
  const riders = useRiderStore((s) => s.riders);

  useEffect(() => {
    void rejectedActions(raceUuid).then(setItems);
  }, [raceUuid, count]);

  const bibOf = (uuid: string | null) => {
    if (!uuid) return null;
    const r = riders.find((x) => x.uuid === uuid);
    return r ? `#${r.bibNumber ?? "?"} ${[r.firstName, r.lastName].filter(Boolean).join(" ")}`.trim() : null;
  };
  const dismiss = async (ids: string[]) => {
    await dismissRejected(raceUuid, ids);
    setItems(await rejectedActions(raceUuid));
  };

  return (
    <div className={`${styles.card} ${styles.sheet}`} data-testid="rejected-actions" role="region" aria-label={t("live.notAppliedTitle", "Not applied")}>
      <div className={styles.spread}>
        <strong>{t("live.notAppliedTitle", "Not applied")}</strong>
        <button className={styles.link} onClick={onClose}>{t("live.close", "Close")}</button>
      </div>
      {/* Opened from the compact Live badge: the sync state it replaces, then the count. */}
      {statusText && (
        <p className={styles.muted} dir="auto" data-testid="rejected-status">
          {statusText} · {t("live.notAppliedCount", "{{n}} not applied", { n: count })}
        </p>
      )}
      <p className={styles.muted}>
        {t("live.notAppliedHelp", "The server refused these. They are kept here so nothing recorded is lost silently; dismiss them once checked.")}
      </p>
      <ul className={styles.list}>
        {items.map((r) => (
          <li key={r.actionId} className={styles.item} data-testid="rejected-item">
            <div className={styles.spread}>
              <span dir="auto">
                <strong>{r.type}</strong> {bibOf(r.riderUuid) ?? ""}
                <br />
                <span className={styles.muted}>{new Date(r.createdAt).toLocaleTimeString()} · {r.reasonText}</span>
              </span>
              <button className={styles.secondary} onClick={() => void dismiss([r.actionId])}>{t("live.dismiss", "Dismiss")}</button>
            </div>
          </li>
        ))}
      </ul>
      {items.length > 1 && (
        <button className={styles.secondary} onClick={() => void dismiss(items.map((r) => r.actionId))}>{t("live.dismissAll", "Dismiss all")}</button>
      )}
    </div>
  );
}
