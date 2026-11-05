import React, { useMemo } from "react";
import type { RiderProps } from "@/types/types";
import { lapBreakdown, fmtDuration, fmtGapMs, fmtClock } from "@/utils/lapBreakdown";
import styles from "./riderLapTable.module.css";

interface Props {
  rider: RiderProps;
  /** Riders of the race (laps resolved); only the rider's own category is compared. */
  field: RiderProps[];
}

const OUT = ["DNF", "DSQ", "DNS"];

/** Rider performance in Results: summary + lap-by-lap table (recorded passages only; N/A when unknown). */
const RiderLapTable: React.FC<Props> = ({ rider, field }) => {
  const b = useMemo(() => lapBreakdown(rider, field), [rider, field]);
  const isOut = OUT.includes(rider.status);

  const finalGap =
    b.finalGap == null ? "N/A"
    : b.finalGap.kind === "leader" ? "Winner"
    : b.finalGap.kind === "laps" ? `+${b.finalGap.laps} lap${b.finalGap.laps > 1 ? "s" : ""}`
    : fmtGapMs(b.finalGap.ms);

  return (
    <section className={styles.wrap} data-testid="rider-performance">
      <h3 className={styles.title}>Performance</h3>
      <div className={styles.summary}>
        <Stat label="Category position" value={isOut ? rider.status : b.position != null ? String(b.position) : "N/A"} testId="perf-position" />
        <Stat label="Total time" value={fmtDuration(b.totalMs)} testId="perf-total" />
        <Stat label="Laps completed" value={String(b.completedLaps)} testId="perf-laps" />
        <Stat label="Gap to winner" value={isOut ? "N/A" : finalGap} testId="perf-gap" />
        <Stat label="Fastest lap" value={b.fastestLapMs != null ? `${fmtDuration(b.fastestLapMs)} (lap ${b.fastestLap})` : "N/A"} testId="perf-fastest" />
        <Stat label="Average lap" value={fmtDuration(b.averageLapMs)} testId="perf-average" />
      </div>
      {b.adminFinish && (
        <p className={styles.note}>Finished administratively: no finish-line time was recorded for the last lap.</p>
      )}

      {b.rows.length === 0 ? (
        <p className={styles.empty}>No passages recorded.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table} data-testid="lap-table">
            <thead>
              <tr>
                <th>Lap</th>
                <th>Lap time</th>
                <th>Crossing</th>
                <th title="Position in the category at this lap">Pos</th>
                <th title="Behind the category leader at this lap">Gap</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.lap} data-testid="lap-row" className={r.crossingMs == null ? styles.missing : undefined}>
                  <td>{r.lap}</td>
                  <td>{fmtDuration(r.durationMs)}</td>
                  <td>
                    {r.crossingMs == null ? <span title="No passage recorded for this lap">N/A</span> : fmtClock(r.crossingMs)}
                    {r.recovered && <span className={styles.recovered} title="Recovered passage: estimated time, entered after the fact">≈</span>}
                  </td>
                  <td>{r.position ?? "N/A"}</td>
                  <td>{r.gapMs == null ? "N/A" : r.gapMs === 0 ? "Leader" : fmtGapMs(r.gapMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.legend}>
        Position and gap compare riders of the same category at the same lap. N/A: not reliably known from the recorded passages. ≈ recovered passage (estimated time).
      </p>
    </section>
  );
};

const Stat = ({ label, value, testId }: { label: string; value: string; testId: string }) => (
  <div className={styles.stat}>
    <div className={styles.statLabel}>{label}</div>
    <div className={styles.statValue} data-testid={testId}>{value}</div>
  </div>
);

export default RiderLapTable;
