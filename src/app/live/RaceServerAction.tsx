/**
 * Info tab: the race's server panel. One compact card, always in the same place:
 *  - not on the server → orange accent + "Upload race to server" (or "Sign in to
 *    upload"). Uploading sends the race, its categories and riders and links it;
 *    from then on every change goes to the server through the sync bridge, and the
 *    account's other devices get the race and its updates live.
 *  - on the server → green accent + the live sync state, and (owner) the public
 *    link inline: Published / Not published, Publish / Unpublish, Copy link, Share.
 * Duplicate uploads: the button is disabled while uploading, and `publishRace`
 * itself runs once per race (in-tab map + Web Locks) and refuses a linked race.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { AlertTriangle, Check, CloudCheck, CloudUpload, Copy, Globe, Loader2, Lock, Share2 } from "lucide-react";
import {
  isPendingPublish,
  openLiveRace,
  saveRaceToServer,
  setRacePublished,
  shareLink,
  useLiveStore,
  type ShareInfo,
} from "@/services/live/liveClient";
import { isLiveRace, LIVE_ACCESS_EVENT } from "@/services/live/liveBridge";
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

export default function RaceServerAction({ raceUuid, raceName }: { raceUuid: string; raceName: string }) {
  const [, tick] = useState(0);
  // Linking caches the race's access and fires this event: re-check isLiveRace.
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener(LIVE_ACCESS_EVENT, on);
    return () => window.removeEventListener(LIVE_ACCESS_EVENT, on);
  }, []);
  return isLiveRace(raceUuid) ? (
    <OnServer raceUuid={raceUuid} raceName={raceName} />
  ) : (
    <UploadPrompt raceUuid={raceUuid} onUploaded={() => tick((n) => n + 1)} />
  );
}

/** A race only on this device: say so and upload it (the same flow everywhere). */
export function UploadPrompt({
  raceUuid,
  onUploaded,
  title = "Only on this device",
  message = "Upload it to open it on your other devices. After that, every change syncs automatically.",
}: {
  raceUuid: string;
  onUploaded: () => void;
  title?: string;
  message?: string;
}) {
  const navigate = useNavigate();
  const signedIn = useLiveStore((s) => !!s.user);
  const error = useLiveStore((s) => s.publishErrors[raceUuid]);
  const [saving, setSaving] = useState(false);
  const uploading = saving || (signedIn && isPendingPublish(raceUuid) && !error);

  const upload = async () => {
    if (!signedIn) {
      navigate(`/account?next=${encodeURIComponent(`/race/${raceUuid}`)}`);
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      await saveRaceToServer(raceUuid);
      toast.dismiss("race-storage");
      toast.success("Race uploaded. Every change now syncs to the server.", { toastId: "race-save" });
      onUploaded();
    } catch {
      /* the reason is in publishErrors and shown in the panel */
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.panel} data-tone="action" data-testid="race-server-action" data-state={uploading ? "uploading" : error ? "failed" : "local"}>
      <div className={styles.head}>
        <CloudUpload className={styles.icon} size={20} aria-hidden="true" />
        <div className={styles.text}>
          <div className={styles.title}>{uploading ? "Uploading to server…" : title}</div>
          <div className={styles.sub}>{uploading ? "Sending the race, its categories and riders." : message}</div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btnAction} onClick={() => void upload()} disabled={uploading} data-testid="race-upload-btn">
            {uploading ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : <CloudUpload size={15} aria-hidden="true" />}
            {uploading ? "Uploading…" : !signedIn ? "Sign in to upload" : error ? "Retry upload" : "Upload Race to Server"}
          </button>
        </div>
      </div>
      {error && !uploading && (
        <p className={styles.error} role="alert" dir="auto" data-testid="race-upload-error">
          <AlertTriangle size={14} aria-hidden="true" /> Not uploaded: {error}
        </p>
      )}
    </section>
  );
}

function OnServer({ raceUuid, raceName }: { raceUuid: string; raceName: string }) {
  const isOwner = useLiveStore((s) => !!s.access[raceUuid]?.isOwner);
  const sync = useLiveStore((s) => s.sync[raceUuid]);
  const connected = useLiveStore((s) => s.socketConnected);
  const online = useLiveStore((s) => s.online);

  // Join the race's live room, so this screen shows the real sync state.
  useEffect(() => {
    void openLiveRace(raceUuid);
  }, [raceUuid]);

  const pending = sync?.pending ?? 0;
  const syncText = sync?.revoked
    ? "No access to this race"
    : !online || !connected
      ? pending ? `Offline · ${pending} change(s) waiting` : "Offline · changes sync when back online"
      : pending
        ? `Sending ${pending} change(s)…`
        : "Synced · every change saves to the server";
  const syncOk = !sync?.revoked && online && connected && !pending;

  return (
    <section className={styles.panel} data-tone="ok" data-testid="race-server-action" data-state="on-server">
      <div className={styles.head}>
        <CloudCheck className={styles.icon} size={20} aria-hidden="true" />
        <div className={styles.text}>
          <div className={styles.title}>On server</div>
          <div className={styles.sub} data-testid="race-sync-state" data-ok={syncOk ? "true" : "false"}>
            {syncText}
          </div>
        </div>
      </div>
      {isOwner && <PublicLink raceUuid={raceUuid} raceName={raceName} />}
    </section>
  );
}

export function PublicLink({ raceUuid, raceName, embedded = false }: { raceUuid: string; raceName: string; embedded?: boolean }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
      await navigator.clipboard.writeText(info.url);
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
      await navigator.share({ title: raceName, text: `Follow ${raceName} live`, url: info.url });
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
            value={info.url}
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
