/**
 * Share Race: publish the race and share its stable public link.
 * Only a PUBLISHED race is readable through the link (/share/:token) — info,
 * riders, categories, schedule, board and results, read-only, no account.
 * Unpublish revokes public access at once (the link answers "not available").
 * The link never grants any management permission; the server refuses every
 * write without the owner's sign-in (server/src/public/*).
 *
 * A race that is only on this device never calls the share API: the modal says
 * "Race not uploaded yet" and uploads it in place; once linked, the same modal
 * loads the link so the owner can publish and share without reopening it.
 * Shares its upload / public-link parts with the Info server panel.
 */
import React, { useEffect, useState } from "react";
import { Share2, X } from "lucide-react";
import { useLiveStore } from "@/services/live/liveClient";
import { isLiveRace, LIVE_ACCESS_EVENT } from "@/services/live/liveBridge";
import { PublicLink, UploadPrompt } from "./RaceServerAction";
import styles from "./shareRace.module.css";

export default function ShareRace({ raceUuid, raceName }: { raceUuid: string; raceName: string }) {
  const isOwner = useLiveStore((s) => !!s.access[raceUuid]?.isOwner);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener(LIVE_ACCESS_EVENT, on);
    return () => window.removeEventListener(LIVE_ACCESS_EVENT, on);
  }, []);

  const linked = isLiveRace(raceUuid);
  // A linked race is shared by its owner only; a local race belongs to this device.
  if (linked && !isOwner) return null;

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} data-testid="share-race-btn">
        <Share2 size={14} aria-hidden="true" /> Share Race
      </button>
      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-race-title"
            onClick={(e) => e.stopPropagation()}
            data-testid="share-race-modal"
            data-linked={linked ? "true" : "false"}
          >
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            <h3 id="share-race-title" className={styles.title} dir="auto">
              Share “{raceName}”
            </h3>
            {linked ? (
              <PublicLink raceUuid={raceUuid} raceName={raceName} embedded />
            ) : (
              <UploadPrompt
                raceUuid={raceUuid}
                title="Race not uploaded yet"
                message="To share this race with others, you first need to upload it to the server."
                onUploaded={() => tick((n) => n + 1)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
