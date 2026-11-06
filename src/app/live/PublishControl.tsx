/**
 * Owner's publish status as ONE button: red "Not published" / green "Published"
 * (grey while checking or when the state can't be read). Tapping it opens a small
 * modal with all the logic — Publish / Unpublish, the link, Copy link, Share — and
 * the button follows every change made there.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Globe, Loader2, Lock, X, AlertTriangle } from "lucide-react";
import { shareLink, type ShareInfo } from "@/services/live/liveClient";
import { PublicLink, shareErrorText } from "./PublicLink";
import modal from "./shareRace.module.css";
import styles from "./publishControl.module.css";

export default function PublishControl({ raceUuid, raceName, compact = false }: { raceUuid: string; raceName: string; compact?: boolean }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Escape closes this (top-most) dialog only; the Info modal around it ignores Escape while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setInfo(await shareLink(raceUuid));
    } catch (e) {
      setError(shareErrorText(e));
    }
  }, [raceUuid]);
  useEffect(() => {
    void load();
  }, [load]);

  const state = info ? (info.published ? "on" : "off") : error ? "error" : "loading";
  const label = { on: "Published", off: "Not published", error: "Publish status", loading: "Checking…" }[state];
  const Icon = state === "on" ? Globe : state === "off" ? Lock : state === "error" ? AlertTriangle : Loader2;

  return (
    <>
      <button
        type="button"
        className={styles.status}
        data-state={state}
        data-compact={compact ? "true" : undefined}
        onClick={() => {
          setOpen(true);
          if (!info) void load();
        }}
        title={state === "on" ? "Public, read-only link is open — tap to manage" : state === "off" ? "The public link is closed — tap to publish" : undefined}
        data-testid="race-publish-status"
      >
        <Icon size={compact ? 13 : 15} className={state === "loading" ? styles.spin : undefined} aria-hidden="true" />
        {label}
      </button>
      {open && (
        <div className={modal.overlay} onClick={() => setOpen(false)}>
          <div
            className={modal.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-modal-title"
            onClick={(e) => e.stopPropagation()}
            data-testid="race-publish-modal"
          >
            <button type="button" className={modal.close} onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            <h3 id="publish-modal-title" className={modal.title} dir="auto">
              Share “{raceName}”
            </h3>
            <PublicLink raceUuid={raceUuid} raceName={raceName} embedded initial={info} onChange={setInfo} />
          </div>
        </div>
      )}
    </>
  );
}
