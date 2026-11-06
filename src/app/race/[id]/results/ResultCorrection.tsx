import React, { useState } from "react";
import { canOnScreen, isLiveRace, liveAllows, liveDispatch } from "@/services/live/liveBridge";
import useRaceStore from "@/stores/racesStore";
import { RiderProps } from "@/types/types";
import styles from "./results.module.css";

/**
 * Results judge (0.2) — correct a rider's lap count or status from the Results tab.
 * Shared races only, for members whose role updates Results (results judge, admin, owner).
 * Sends the same Actions the server already checks (LapCountCorrection, StatusCorrection);
 * offline they wait in the outbox, and a refused one is kept for review, never lost.
 * Hidden for local races and once the race is final (corrections then go through Amend).
 */
const STATUS_CHOICES: { value: "DNF" | "DSQ" | "DNS" | "running"; label: string }[] = [
  { value: "DNF", label: "DNF" },
  { value: "DSQ", label: "DSQ" },
  { value: "DNS", label: "DNS" },
  { value: "running", label: "Clear status" },
];

export default function ResultCorrection({ raceUuid, rider }: { raceUuid: string; rider: RiderProps }) {
  const finalized = useRaceStore((s) => !!s.races.find((r) => r.uuid === raceUuid)?.finalized);
  const [laps, setLaps] = useState<number>(rider.lapsCounter ?? 0);
  const [note, setNote] = useState<string | null>(null);

  if (!isLiveRace(raceUuid) || finalized || !rider.uuid || !canOnScreen(raceUuid, "results", "update")) return null;

  const send = async (type: "LapCountCorrection" | "StatusCorrection", payload: Record<string, unknown>, done: string) => {
    if (!liveAllows(raceUuid, type, payload)) {
      setNote("Your role in this race doesn't allow this.");
      return;
    }
    await liveDispatch(raceUuid, type, payload);
    setNote(done);
  };

  return (
    <div className={styles.correction} data-testid="result-correction">
      <div className={styles.correctionTitle}>Correct result</div>
      <div className={styles.correctionRow}>
        <label htmlFor="correct-laps">Laps</label>
        <button type="button" aria-label="One lap less" onClick={() => setLaps((n) => Math.max(0, n - 1))}>−</button>
        <input
          id="correct-laps"
          type="number"
          min={0}
          inputMode="numeric"
          value={laps}
          onChange={(e) => setLaps(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          data-testid="correct-laps"
        />
        <button type="button" aria-label="One lap more" onClick={() => setLaps((n) => n + 1)}>+</button>
        <button
          type="button"
          disabled={laps === (rider.lapsCounter ?? 0)}
          onClick={() => void send("LapCountCorrection", { riderUuid: rider.uuid, laps }, `Laps set to ${laps} — sent.`)}
          data-testid="correct-laps-save"
        >
          Save laps
        </button>
      </div>
      <div className={styles.correctionRow}>
        <span>Status</span>
        {STATUS_CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => void send("StatusCorrection", { riderUuid: rider.uuid, status: c.value }, `${c.label} — sent.`)}
            data-testid={`correct-status-${c.value}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {note && <p className={styles.correctionNote} role="status">{note}</p>}
    </div>
  );
}
