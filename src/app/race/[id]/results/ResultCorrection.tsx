import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { canOnScreen, isLiveRace, liveAllows, liveDispatch } from "@/services/live/liveBridge";
import useRaceStore from "@/stores/racesStore";
import { RiderProps } from "@/types/types";
import styles from "./results.module.css";

/**
 * Results judge (0.2) — correct a rider's lap count or out-status from the Results tab.
 * Shared races only, for members whose role updates Results (results judge, admin, owner).
 * Sends the Actions the server already checks (LapCountCorrection, StatusCorrection); offline
 * they wait in the outbox, and a refused one is kept for review, never lost.
 *
 * Hidden: local races, a final race (corrections then go through Amend), a rider whose wave
 * hasn't started. Every change asks first. "Clear" is offered only to undo DNF/DSQ/DNS — never
 * on a rider who finished or is still standing, because clearing puts a rider back on course.
 */
type OutStatus = "DNF" | "DSQ" | "DNS";
const OUT: OutStatus[] = ["DNF", "DSQ", "DNS"]; // project order: DNF → DSQ → DNS

export default function ResultCorrection({ raceUuid, rider }: { raceUuid: string; rider: RiderProps }) {
  const finalized = useRaceStore((s) => !!s.races.find((r) => r.uuid === raceUuid)?.finalized);
  if (!isLiveRace(raceUuid) || finalized || !rider.uuid || rider.raceStatus === "upcoming" || !canOnScreen(raceUuid, "results", "update")) return null;
  // Re-mount when the count or status changes on another device, so the form never shows stale values.
  return <CorrectionForm key={`${rider.lapsCounter}:${rider.status}`} raceUuid={raceUuid} rider={rider} />;
}

function CorrectionForm({ raceUuid, rider }: { raceUuid: string; rider: RiderProps }) {
  const { t } = useTranslation();
  const current = rider.lapsCounter ?? 0;
  const [laps, setLaps] = useState<number>(current);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const isOut = (OUT as string[]).includes(rider.status);

  const send = async (type: "LapCountCorrection" | "StatusCorrection", payload: Record<string, unknown>, confirmText: string, done: string) => {
    if (busy) return;
    if (!liveAllows(raceUuid, type, payload)) {
      setNote(t("results.correctNotAllowed", "Your role in this race doesn't allow this."));
      return;
    }
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      await liveDispatch(raceUuid, type, payload);
      setNote(done);
    } catch (e) {
      setNote(t("results.correctFailed", "Could not send: {{msg}}", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const name = `#${rider.bibNumber ?? "?"} ${rider.firstName ?? ""} ${rider.lastName ?? ""}`.trim();

  return (
    <div className={styles.correction} data-testid="result-correction" dir="auto">
      <div className={styles.correctionTitle}>{t("results.correctTitle", "Correct result")}</div>
      <div className={styles.correctionRow} role="group" aria-label={t("results.correctLaps", "Laps")}>
        <label htmlFor="correct-laps">{t("results.correctLaps", "Laps")}</label>
        <button type="button" disabled={busy} aria-label={t("results.lapLess", "One lap less")} onClick={() => setLaps((n) => Math.max(0, n - 1))}>−</button>
        <input
          id="correct-laps"
          type="number"
          min={0}
          inputMode="numeric"
          value={laps}
          disabled={busy}
          onChange={(e) => setLaps(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          data-testid="correct-laps"
        />
        <button type="button" disabled={busy} aria-label={t("results.lapMore", "One lap more")} onClick={() => setLaps((n) => n + 1)}>+</button>
        <button
          type="button"
          disabled={busy || laps === current}
          onClick={() =>
            void send(
              "LapCountCorrection",
              { riderUuid: rider.uuid, laps },
              t("results.confirmLaps", "Set {{name}} to {{laps}} laps (now {{current}})? Lap times after that count are dropped and a later correction won't bring them back; with more laps the rider is ranked by their last recorded crossing.", { name, laps, current }),
              t("results.lapsSent", "Laps set to {{laps}} — sent.", { laps }),
            )
          }
          data-testid="correct-laps-save"
        >
          {t("results.saveLaps", "Save laps")}
        </button>
      </div>
      <div className={styles.correctionRow} role="group" aria-label={t("results.correctStatus", "Status")}>
        <span>{t("results.correctStatus", "Status")}</span>
        {OUT.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy || rider.status === s}
            aria-pressed={rider.status === s}
            onClick={() => void send("StatusCorrection", { riderUuid: rider.uuid, status: s }, t("results.confirmStatus", "Mark {{name}} as {{status}}?", { name, status: s }), t("results.statusSent", "{{status}} — sent.", { status: s }))}
            data-testid={`correct-status-${s}`}
          >
            {s}
          </button>
        ))}
        {isOut && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void send(
                "StatusCorrection",
                { riderUuid: rider.uuid, status: "running" },
                t("results.confirmClear", "Remove {{status}} from {{name}}? The rider is counted again from their recorded laps.", { name, status: rider.status }),
                t("results.clearSent", "Status cleared — sent."),
              )
            }
            data-testid="correct-status-clear"
          >
            {t("results.clearStatus", "Clear {{status}}", { status: rider.status })}
          </button>
        )}
      </div>
      {note && <p className={styles.correctionNote} role="status">{note}</p>}
    </div>
  );
}
