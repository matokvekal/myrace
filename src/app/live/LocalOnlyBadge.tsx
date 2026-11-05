import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { isPendingPublish, publishPending, saveRaceToServer, useLiveStore } from "@/services/live/liveClient";
import styles from "./live.module.css";

/**
 * A race that exists only on this Device (not in the server database) says so,
 * so the owner is never surprised, and offers to save it: "Save to server" when
 * signed in, "Sign in" otherwise. Nothing is uploaded without that tap, except a
 * race created while signed in (queued by Create Race): that one says it is
 * uploading, or why it is not on the server yet, and is retried here as well.
 */
export default function LocalOnlyBadge({ raceUuid }: { raceUuid: string }) {
  const navigate = useNavigate();
  const signedIn = useLiveStore((s) => !!s.user);
  const error = useLiveStore((s) => s.publishErrors[raceUuid]);
  const pending = signedIn && isPendingPublish(raceUuid);
  const [saving, setSaving] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!pending) return;
    void publishPending().then(() => tick((n) => n + 1));
  }, [pending]);

  const save = async () => {
    setSaving(true);
    try {
      await saveRaceToServer(raceUuid);
      // Its own toast id: the Create Race "device only" toast may still be showing.
      toast.dismiss("race-storage");
      toast.success("Race saved to the server", { toastId: "race-save" });
    } catch (e) {
      toast.error(`Not saved to the server: ${e instanceof Error ? e.message : String(e)}`, { toastId: "race-save" });
    } finally {
      setSaving(false);
      tick((n) => n + 1);
    }
  };

  const state = !signedIn ? "signed-out" : pending ? (error ? "failed" : "uploading") : error ? "failed" : "local";
  const text = {
    "signed-out": "On this device only",
    uploading: "Uploading to server…",
    failed: `Not on server yet · ${error}`,
    local: "On this device only",
  }[state];

  return (
    <span
      className={styles.sync}
      data-testid="local-only-badge"
      data-state={state}
      title="This race is stored only in this browser until it is saved to the server"
    >
      <span className={styles.dotWarn} />
      <span dir="auto">{text}</span>
      {!signedIn ? (
        <button
          type="button"
          className={styles.syncAction}
          data-testid="local-only-signin"
          onClick={() => navigate(`/account?next=${encodeURIComponent(`/race/${raceUuid}`)}`)}
        >
          Sign in to save
        </button>
      ) : (
        (!pending || error) && (
          <button type="button" className={styles.syncAction} data-testid="local-only-save" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save to server"}
          </button>
        )
      )}
    </span>
  );
}
