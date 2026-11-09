/**
 * Info tab: the race's server panel. One compact card, always in the same place:
 *  - not on the server → orange accent + "Upload race to server" (or "Sign in to
 *    upload"). Uploading sends the race, its categories and riders and links it;
 *    from then on every change goes to the server through the sync bridge, and the
 *    account's other devices get the race and its updates live.
 *  - on the server → green accent + the live sync state, and (owner) one status
 *    button: red "Not published" / green "Published"; it opens a small modal with
 *    Publish / Unpublish, the link, Copy link and Share (PublishControl).
 * Duplicate uploads: the button is disabled while uploading, and `publishRace`
 * itself runs once per race (in-tab map + Web Locks) and refuses a linked race.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { AlertTriangle, CloudCheck, CloudUpload, Loader2 } from "lucide-react";
import { isPendingPublish, openLiveRace, saveRaceToServer, useLiveStore } from "@/services/live/liveClient";
import { isLiveRace, LIVE_ACCESS_EVENT } from "@/services/live/liveBridge";
import PublishControl from "./PublishControl";
import TrialLinks from "./TrialLinks";
import styles from "./raceServerAction.module.css";

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
      {isOwner && <PublishControl raceUuid={raceUuid} raceName={raceName} />}
      {isOwner && <TrialLinks raceUuid={raceUuid} />}
    </section>
  );
}
