"use client";

import { useEffect } from "react";
import { Info } from "lucide-react";
import type { RiderProps } from "@/types/types";
import useRaceStore from "@/stores/racesStore";
import { importFixFor, useCheckInChanges } from "@/stores/checkInChangesStore";
import styles from "./riderDetailModal.module.css";

/**
 * Phase 2: "Bib changed at import" — the audited renumbering of a duplicate bib
 * (original → corrected, reason, who, when). Read from the same log as Check-In
 * changes (server history for a shared race, the device audit log for a local one),
 * so the two never disagree. Loads that log once if another race's is in memory.
 */
export default function ImportBibNote({ rider }: { rider: Pick<RiderProps, "id" | "uuid" | "raceUuid"> }) {
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === rider.raceUuid));
  const loadedFor = useCheckInChanges((s) => s.raceUuid);
  const changes = useCheckInChanges((s) => s.changes);

  useEffect(() => {
    if (race && loadedFor !== race.uuid) void useCheckInChanges.getState().load(race);
  }, [race, loadedFor]);

  if (loadedFor !== rider.raceUuid) return null;
  const note = importFixFor(changes, rider);
  if (!note?.importFix) return null;
  const { originalBib, correctedBib, reason } = note.importFix;
  const when = note.timestamp ? new Date(note.timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
  return (
    <div className={styles.importNote} data-testid="rider-import-bib-note" role="note">
      <Info size={14} aria-hidden />
      <span dir="auto">
        <b>Bib changed at import: {originalBib} → {correctedBib}.</b> {reason}
        {(note.by && note.by !== "UNKNOWN") || when ? (
          <span className={styles.importNoteMeta}> — {[note.by !== "UNKNOWN" ? note.by : "", when].filter(Boolean).join(", ")}</span>
        ) : null}
      </span>
    </div>
  );
}
