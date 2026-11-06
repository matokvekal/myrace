/**
 * Info tab: the race's server/sharing panel behind ONE icon (user request). The page shows only
 * the icon — tinted by state (orange: only on this device / needs action, green: on the server
 * and synced, amber: waiting to sync or offline, red: upload failed or no access). Tapping it
 * opens the existing panel (`RaceServerAction`: upload, sync state, publish / link / copy / share)
 * unchanged, in a modal that works on phone and desktop. Nothing about sharing itself changes.
 */
import React, { useEffect, useState } from "react";
import { CloudCheck, CloudUpload, X } from "lucide-react";
import { useLiveStore } from "@/services/live/liveClient";
import { isLiveRace, LIVE_ACCESS_EVENT } from "@/services/live/liveBridge";
import RaceServerAction from "./RaceServerAction";
import modal from "./shareRace.module.css";
import styles from "./raceServerButton.module.css";

type Tone = "action" | "ok" | "wait" | "error";

export default function RaceServerButton({ raceUuid, raceName }: { raceUuid: string; raceName: string }) {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener(LIVE_ACCESS_EVENT, on);
    return () => window.removeEventListener(LIVE_ACCESS_EVENT, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const linked = isLiveRace(raceUuid);
  const sync = useLiveStore((s) => s.sync[raceUuid]);
  const publishError = useLiveStore((s) => s.publishErrors[raceUuid]);
  const online = useLiveStore((s) => s.online);
  const connected = useLiveStore((s) => s.socketConnected);
  const tone: Tone = !linked
    ? publishError ? "error" : "action"
    : sync?.revoked ? "error" : !online || !connected || (sync?.pending ?? 0) > 0 ? "wait" : "ok";
  const label = !linked ? "Only on this device — upload and share" : "On server — sync and sharing";

  return (
    <>
      <button
        type="button"
        className={styles.iconBtn}
        data-tone={tone}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="race-server-open"
      >
        {linked ? <CloudCheck size={20} aria-hidden="true" /> : <CloudUpload size={20} aria-hidden="true" />}
      </button>
      {open && (
        <div className={modal.overlay} onClick={() => setOpen(false)}>
          <div
            className={modal.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="race-server-modal-title"
            onClick={(e) => e.stopPropagation()}
            data-testid="race-server-modal"
          >
            <button type="button" className={modal.close} onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
            <h3 id="race-server-modal-title" className={modal.title} dir="auto">Server & sharing</h3>
            <RaceServerAction raceUuid={raceUuid} raceName={raceName} />
          </div>
        </div>
      )}
    </>
  );
}
