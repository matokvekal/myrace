/**
 * Info tab: the race's server/sharing panel behind ONE icon (user request). The page shows only
 * the icon — tinted by state (orange: only on this device / needs action, green: on the server
 * and synced, amber: waiting to sync or offline, red: upload failed or no access). Tapping it
 * opens the existing panel (`RaceServerAction`: upload, sync state, publish / link / copy / share)
 * unchanged, in a modal that works on phone and desktop. Nothing about sharing itself changes.
 */
import React, { useEffect, useRef, useState } from "react";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener(LIVE_ACCESS_EVENT, on);
    return () => window.removeEventListener(LIVE_ACCESS_EVENT, on);
  }, []);
  // Focus moves into the dialog, Tab stays inside it, and returns to the icon on close.
  // Escape closes only the top-most dialog (the nested publish modal handles its own).
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const dlg = dialogRef.current;
      if (!dlg) return;
      const nested = dlg.querySelector('[role="dialog"]');
      if (e.key === "Escape") {
        if (!nested) setOpen(false);
        return;
      }
      if (e.key !== "Tab" || nested) return;
      const items = [...dlg.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  const linked = isLiveRace(raceUuid);
  const sync = useLiveStore((s) => s.sync[raceUuid]);
  const publishError = useLiveStore((s) => s.publishErrors[raceUuid]);
  const online = useLiveStore((s) => s.online);
  const connected = useLiveStore((s) => s.socketConnected);
  const tone: Tone = !linked
    ? publishError ? "error" : "action"
    : sync?.revoked ? "error" : !online || !connected || (sync?.pending ?? 0) > 0 ? "wait" : "ok";
  const label = {
    action: "Only on this device — upload and share",
    error: !linked ? "Upload failed — retry and share" : "No access to this race on the server",
    wait: "On server — waiting to sync",
    ok: "On server — synced; sharing",
  }[tone];

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
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
            ref={dialogRef}
            className={modal.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="race-server-modal-title"
            onClick={(e) => e.stopPropagation()}
            data-testid="race-server-modal"
          >
            <button ref={closeRef} type="button" className={modal.close} onClick={() => setOpen(false)} aria-label="Close">
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
