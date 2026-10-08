import React, { useState } from "react";
import styles from "./riderLiveModal.module.css";
import { RiderProps } from "@/types/types";
import { riderTotalTime } from "@/utils/timeUtils";

interface Props {
  rider: RiderProps;
  catColor: string;
  /** "+M:SS" / "+NL" behind the category leader, or "—" for the leader themself. */
  gapToLeader?: string;
  onClose: () => void;
  onRevertLap: (rider: RiderProps) => void;
  onStatusChange: (rider: RiderProps, status: RiderProps["status"]) => void;
  onSaveComment: (rider: RiderProps, comment: string) => void;
}

const RiderLiveModal: React.FC<Props> = ({
  rider,
  catColor,
  gapToLeader,
  onClose,
  onRevertLap,
  onStatusChange,
  onSaveComment,
}) => {
  const [comment, setComment] = useState(rider.comment ?? "");
  const [commentSaved, setCommentSaved] = useState(false);

  const isOut = ["DNF", "DSQ", "DNS"].includes(rider.status);
  const hasLaps = (rider.lapsDetails ?? []).length > 0;
  const hasSpeed = (rider.lapsDetails ?? []).some((l) => l.speed_kph != null);

  const handleSaveComment = () => {
    onSaveComment(rider, comment);
    setCommentSaved(true);
    setTimeout(() => setCommentSaved(false), 1500);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className={styles.header} style={{ borderTopColor: catColor }}>
          <div className={styles.headerLeft}>
            <span className={styles.bib}>#{rider.bibNumber}</span>
            <div className={styles.identity}>
              <span className={styles.name}>
                {rider.lastName} {rider.firstName}
              </span>
              <span className={styles.catTag}>
                <span className={styles.catDot} style={{ background: catColor }} />
                {rider.category}
                {rider.subCategory && <span className={styles.sub}> · {rider.subCategory}</span>}
              </span>
              {rider.team && (
                <span className={styles.club} dir="auto">🏳️ {rider.team}</span>
              )}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* ── Race stats ── */}
        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Laps</span>
            <span className={styles.statVal}>{rider.lapsCounter ?? 0} / {rider.totalLaps ?? "?"}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Position</span>
            <span className={styles.statVal}>P{rider.position_category ?? "—"}</span>
          </div>
          {gapToLeader && (
            <div className={styles.stat}>
              <span className={styles.statLabel}>Gap</span>
              <span className={styles.statVal}>{gapToLeader}</span>
            </div>
          )}
          <div className={styles.stat}>
            <span className={styles.statLabel}>Last lap</span>
            <span className={styles.statVal}>{rider.elapsedLastLap || "—"}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Total</span>
            <span className={styles.statVal}>{riderTotalTime(rider)}</span>
          </div>
          {isOut && (
            <div className={`${styles.stat} ${styles.statOut}`}>
              <span className={styles.statLabel}>Status</span>
              <span className={styles.statVal}>{rider.status}</span>
            </div>
          )}
        </div>

        {/* ── Lap history ── */}
        {hasLaps && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Lap History</div>
            <div className={styles.lapTable}>
              <div className={styles.lapHead}>
                <span>#</span>
                <span>Time</span>
                <span>Pos</span>
                {hasSpeed && <span>km/h</span>}
              </div>
              {(rider.lapsDetails ?? []).map((l) => (
                <div key={l.lap} className={styles.lapRow}>
                  <span className={styles.lapNum}>{l.lap}</span>
                  <span className={styles.lapTime}>{l.lapTime}</span>
                  <span className={styles.lapPos}>{l.position != null ? `P${l.position}` : "—"}</span>
                  {hasSpeed && (
                    <span className={styles.lapSpeed}>
                      {l.speed_kph != null ? l.speed_kph.toFixed(1) : "—"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Comment ── */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Note / Comment</div>
          <textarea
            className={styles.commentBox}
            value={comment}
            onChange={(e) => { setComment(e.target.value); setCommentSaved(false); }}
            placeholder="Add a note about this rider…"
            rows={2}
          />
          <button
            className={`${styles.saveComment} ${commentSaved ? styles.saved : ""}`}
            onClick={handleSaveComment}
          >
            {commentSaved ? "✓ Saved" : "Save Note"}
          </button>
        </div>

        {/* ── Actions ── */}
        <div className={styles.actions}>
          {(rider.lapsCounter ?? 0) > 0 && (
            <button className={styles.revertBtn} onClick={() => { onRevertLap(rider); onClose(); }}>
              ↩ Revert Last Lap
            </button>
          )}
          {rider.status !== "DNF" && (
            <button className={`${styles.actionBtn} ${styles.dnf}`} onClick={() => { onStatusChange(rider, "DNF"); onClose(); }}>
              DNF
            </button>
          )}
          {rider.status !== "DSQ" && (
            <button className={`${styles.actionBtn} ${styles.dsq}`} onClick={() => { onStatusChange(rider, "DSQ"); onClose(); }}>
              DSQ
            </button>
          )}
          {rider.status !== "DNS" && (
            <button className={`${styles.actionBtn} ${styles.dns}`} onClick={() => { onStatusChange(rider, "DNS"); onClose(); }}>
              DNS
            </button>
          )}
          {isOut && (
            <button className={`${styles.actionBtn} ${styles.clear}`} onClick={() => { onStatusChange(rider, "standing"); onClose(); }}>
              ✓ Clear
            </button>
          )}
        </div>

      </div>
    </div>
  );
};

export default RiderLiveModal;
