/**
 * Share Race (owner only): publish the race and share its stable public link.
 * Only a PUBLISHED race is readable through the link (/share/:token) — info,
 * riders, categories, schedule, board and results, read-only, no account.
 * Unpublish revokes public access at once (the link answers "not available").
 * The link never grants any management permission; the server refuses every
 * write without the owner's sign-in (server/src/public/*).
 */
import React, { useState } from "react";
import { Check, Copy, Globe, Link2, Lock, Share2, X } from "lucide-react";
import { setRacePublished, shareLink, useLiveStore, type ShareInfo } from "@/services/live/liveClient";
import styles from "./shareRace.module.css";

export default function ShareRace({ raceUuid, raceName }: { raceUuid: string; raceName: string }) {
  const isOwner = useLiveStore((s) => !!s.access[raceUuid]?.isOwner);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!isOwner) return null;

  const show = async () => {
    setOpen(true);
    setError(null);
    try {
      setInfo(await shareLink(raceUuid));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const togglePublished = async () => {
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      setInfo(await setRacePublished(raceUuid, !info.published));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
    } catch {
      const input = document.getElementById("share-race-url") as HTMLInputElement | null;
      input?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const share = async () => {
    if (!info) return;
    try {
      await navigator.share({ title: raceName, text: `Follow ${raceName} live`, url: info.url });
    } catch {
      /* cancelled */
    }
  };

  const published = !!info?.published;
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
              When published, anyone with the link can follow the race — info, riders, categories, schedule, board and
              results — without an account. It is <strong>read-only</strong>: nobody can change the race through it.
            </p>
            {error && <p className={styles.error} role="alert" dir="auto">{error}</p>}
            {!info && !error && <p className={styles.note}>Getting the link…</p>}
            {info && (
              <>
                <div className={styles.publishRow} data-testid="share-race-status" data-published={published ? "true" : "false"}>
                  <span className={published ? styles.statusOn : styles.statusOff}>
                    {published ? <Globe size={15} /> : <Lock size={15} />} {published ? "Published — the link is public" : "Not published — the link does not open"}
                  </span>
                  <button type="button" className={published ? styles.secondary : styles.primary} onClick={() => void togglePublished()} disabled={busy} data-testid="share-race-publish">
                    {busy ? "…" : published ? "Unpublish" : "Publish"}
                  </button>
                </div>
                <input id="share-race-url" className={styles.url} readOnly value={info.url} onFocus={(e) => e.currentTarget.select()} data-testid="share-race-url" />
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} onClick={() => void copy()} disabled={!published} data-testid="share-race-copy">
                    {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy link"}
                  </button>
                  {typeof navigator !== "undefined" && "share" in navigator && (
                    <button type="button" className={styles.secondary} onClick={() => void share()} disabled={!published}>
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
