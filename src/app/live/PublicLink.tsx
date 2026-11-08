/**
 * The race's public link (owner): Published / Not published, Publish / Unpublish,
 * the link, Copy link and Share. Shown inside the publish modal (PublishControl)
 * and the Share Race modal. Share API errors are in plain words (shareErrorText).
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { AlertTriangle, Check, Copy, Globe, Loader2, Lock, Share2 } from "lucide-react";
import { setRacePublished, shareLink, type ShareInfo } from "@/services/live/liveClient";
import styles from "./raceServerAction.module.css";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Share API errors in plain words — never a bare "Not found". */
export function shareErrorText(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 404) return "The server could not open sharing for this race. It may not have the latest update yet. Try again in a few minutes.";
  if (status === 403) return "Only the race owner can share this race.";
  if (status === 401) return "Your session ended. Sign in again to share this race.";
  if (e instanceof TypeError) return "No connection to the server.";
  return errText(e);
}

export function PublicLink({
  raceUuid,
  raceName,
  embedded = false,
  initial = null,
  onChange,
  screen,
}: {
  /** Open the spectator page on RESULTS (`?tab=results`) or, from Board, on RACE (`?tab=race`, 0.3.4). */
  screen?: "board" | "results";
  raceUuid: string;
  raceName: string;
  embedded?: boolean;
  /** Already-loaded state (the status button loaded it): no second request. */
  initial?: ShareInfo | null;
  /** Called whenever the published state is loaded or changed. */
  onChange?: (info: ShareInfo) => void;
}) {
  const [info, setInfoState] = useState<ShareInfo | null>(initial);
  const setInfo = (i: ShareInfo) => {
    setInfoState(i);
    onChange?.(i);
  };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = info ? (screen ? `${info.url}${info.url.includes("?") ? "&" : "?"}tab=${screen === "board" ? "race" : "results"}` : info.url) : "";

  const load = useCallback(async () => {
    setError(null);
    try {
      setInfo(await shareLink(raceUuid));
    } catch (e) {
      setError(shareErrorText(e));
    }
  }, [raceUuid]);
  useEffect(() => {
    if (!initial) void load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    if (!info || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setRacePublished(raceUuid, !info.published);
      setInfo(next);
      toast.success(next.published ? "Published. Anyone with the link can follow the race." : "Unpublished. The link no longer opens.", { toastId: "race-publish" });
    } catch (e) {
      setError(shareErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.getElementById("race-share-url") as HTMLInputElement | null;
      input?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const share = async () => {
    if (!info) return;
    try {
      await navigator.share({ title: raceName, text: `Follow ${raceName} live`, url });
    } catch {
      /* cancelled */
    }
  };

  const published = !!info?.published;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <div className={styles.share} data-embedded={embedded ? "true" : undefined} data-testid="race-share" data-published={info ? String(published) : undefined}>
      <div className={styles.shareHead}>
        <span className={styles.shareLabel}>
          <Share2 size={14} aria-hidden="true" /> Share Race
        </span>
        {info && (
          <span className={styles.status} data-on={published ? "true" : "false"} data-testid="race-share-status">
            {published ? <Globe size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />}
            {published ? "Published · public, read-only" : "Not published · link closed"}
          </span>
        )}
      </div>

      {!info && !error && (
        <p className={styles.sub}>
          <Loader2 size={13} className={styles.spin} aria-hidden="true" /> Getting the link…
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert" dir="auto">
          <AlertTriangle size={14} aria-hidden="true" /> {error}
          {!info && (
            <button type="button" className={styles.linkBtn} onClick={() => void load()}>
              Retry
            </button>
          )}
        </p>
      )}

      {info && (
        <>
          <input
            id="race-share-url"
            className={styles.url}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            data-testid="race-share-url"
            data-off={published ? undefined : "true"}
          />
          <div className={styles.shareActions}>
            <button
              type="button"
              className={published ? styles.btnSecondary : styles.btnPrimary}
              onClick={() => void toggle()}
              disabled={busy}
              data-testid="race-share-publish"
            >
              {busy ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : published ? <Lock size={15} aria-hidden="true" /> : <Globe size={15} aria-hidden="true" />}
              {published ? "Unpublish" : "Publish"}
            </button>
            <button
              type="button"
              className={published ? styles.btnPrimary : styles.btnSecondary}
              onClick={() => void copy()}
              disabled={!published}
              title={published ? undefined : "Publish first: the link opens only while published"}
              data-testid="race-share-copy"
            >
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </button>
            {canShare && (
              <button type="button" className={styles.btnSecondary} onClick={() => void share()} disabled={!published}>
                <Share2 size={15} aria-hidden="true" /> Share…
              </button>
            )}
          </div>
          <p className={styles.note}>
            Guests see info, riders, categories, schedule, board and results without an account. Live updates for them stop when the race
            finishes or 24 h after its start.
          </p>
        </>
      )}
    </div>
  );
}
