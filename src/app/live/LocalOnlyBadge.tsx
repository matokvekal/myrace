import React, { useEffect, useState } from "react";
import { isPendingPublish, publishPending, useLiveStore } from "@/services/live/liveClient";
import styles from "./live.module.css";

/**
 * A race that exists only on this Device (not in the server database) says so,
 * so the owner is never surprised. A new race waiting to upload says that
 * instead, and is retried here as well.
 */
export default function LocalOnlyBadge({ raceUuid }: { raceUuid: string }) {
  const signedIn = useLiveStore((s) => !!s.user);
  const pending = isPendingPublish(raceUuid);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!pending || !signedIn) return;
    void publishPending().then(() => tick((n) => n + 1));
  }, [pending, signedIn]);

  const text = !pending
    ? "Local only · not on server"
    : signedIn
      ? "Uploading to server…"
      : "Sign in to save to server";
  return (
    <span
      className={styles.sync}
      data-testid="local-only-badge"
      title={pending ? "This new race is saved to the server as soon as possible" : "This race is stored only in this browser; share it from Team to save it on the server"}
    >
      <span className={styles.dotWarn} />
      {text}
    </span>
  );
}
