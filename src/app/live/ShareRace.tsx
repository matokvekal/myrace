/**
 * Share Race (owner only): the race's stable public link. Anyone who opens it
 * follows THIS race read-only, without an account (/share/:token) — info,
 * riders, categories, schedule, board and results. The link never grants any
 * management permission; the server refuses every write without the owner's
 * sign-in (server/src/public/*).
 */
import React, { useState } from "react";
import { Check, Copy, Link2, Share2, X } from "lucide-react";
import { shareLink, useLiveStore } from "@/services/live/liveClient";
import styles from "./shareRace.module.css";

export default function ShareRace({ raceUuid, raceName }: { raceUuid: string; raceName: string }) {
  const isOwner = useLiveStore((s) => !!s.access[raceUuid]?.isOwner);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!isOwner) return null;

  const show = async () => {
    setOpen(true);
    setError(null);
    if (url) return;
    try {
      setUrl(await shareLink(raceUuid));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.getElementById("share-race-url") as HTMLInputElement | null;
      input?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({ title: raceName, text: `Follow ${raceName} live`, url });
    } catch {
      /* cancelled */
    }
  };

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => void show()} data-testid="share-race-btn">
        <Share2 size={14} aria-hidden="true" /> Share Race
      </button>
      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="share-race-title" onClick={(e) => e.stopPropagation()} data-testid="share-race-modal">
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            <div className={styles.icon}><Link2 size={22} /></div>
            <h3 id="share-race-title" className={styles.title} dir="auto">Share “{raceName}”</h3>
            <p className={styles.lead}>
              Anyone with this link can follow the race — info, riders, categories, schedule, board and results —
              without an account. It is <strong>read-only</strong>: nobody can change the race through it.
            </p>
            {error ? (
              <p className={styles.error} role="alert" dir="auto">{error}</p>
            ) : (
              <>
                <input id="share-race-url" className={styles.url} readOnly value={url ?? "Getting the link…"} onFocus={(e) => e.currentTarget.select()} data-testid="share-race-url" />
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} onClick={() => void copy()} disabled={!url} data-testid="share-race-copy">
                    {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy link"}
                  </button>
                  {typeof navigator !== "undefined" && "share" in navigator && (
                    <button type="button" className={styles.secondary} onClick={() => void share()} disabled={!url}>
                      <Share2 size={16} /> Share…
                    </button>
                  )}
                </div>
                <p className={styles.note}>Live updates for guests stop when the race is finished, or 24 hours after its start.</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
