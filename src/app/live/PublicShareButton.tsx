/**
 * Share Public Results (0.3.2) — the Share icon at the top of BOARD and RESULTS.
 * A read-only link for parents, riders and spectators: no sign-in, opens that screen
 * (`/share/<token>?tab=race|results` — Board opens RACE since 0.3.4), served only by the guest endpoints
 * (`/api/v1/public/*`, GET only, published races only). Grants NO judge access —
 * that is Invite Judges.
 *
 * Owner: the existing PublicLink (Publish → link → Share / Copy). Anyone else in the race:
 * only the owner can publish, so they are told to ask the organizer.
 * Local (not uploaded) race: upload first.
 */
import React, { useEffect, useState } from "react";
import { Share2, X } from "lucide-react";
import { useLiveStore } from "@/services/live/liveClient";
import { isLiveRace, LIVE_ACCESS_EVENT } from "@/services/live/liveBridge";
import { UploadPrompt } from "./RaceServerAction";
import { PublicLink } from "./PublicLink";
import styles from "./shareRace.module.css";

export default function PublicShareButton({ raceUuid, raceName, screen }: { raceUuid: string; raceName: string; screen: "board" | "results" }) {
  const isOwner = useLiveStore((s) => !!s.access[raceUuid]?.isOwner);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener(LIVE_ACCESS_EVENT, on);
    return () => window.removeEventListener(LIVE_ACCESS_EVENT, on);
  }, []);
  const linked = isLiveRace(raceUuid);
  const what = screen === "board" ? "Board" : "Results";

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-label={`Share public ${what}`}
        title={`Share public ${what}`}
        data-testid={`public-share-${screen}`}
      >
        <Share2 size={16} aria-hidden="true" /> Share
      </button>
      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="public-share-title" onClick={(e) => e.stopPropagation()} data-testid="public-share-modal">
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            <h3 id="public-share-title" className={styles.title} dir="auto">Share public {what}</h3>
            <p style={{ margin: 0 }} dir="auto">
              Anyone with this link can follow the {what.toLowerCase()} — no sign-in, view only.
            </p>
            {!linked ? (
              <UploadPrompt
                raceUuid={raceUuid}
                title="Race not uploaded yet"
                message="To share results publicly, first upload the race to the server."
                onUploaded={() => tick((n) => n + 1)}
              />
            ) : isOwner ? (
              <PublicLink raceUuid={raceUuid} raceName={raceName} screen={screen} embedded />
            ) : (
              <p style={{ margin: 0 }} data-testid="public-share-ask-owner" dir="auto">
                Only the organizer can publish this race. Ask them for the public link.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
