"use client";

import { useState } from "react";
import type { ImportProgress, ValidationIssue, RiderFieldKey } from "@/types/csv.types";
import styles from "./importProgressStep.module.css";

interface ImportProgressStepProps {
  progress: ImportProgress;
  skippedIssues: ValidationIssue[];
  onClose: () => void;
}

// Group issues by row number
function groupByRow(issues: ValidationIssue[]): Map<number, ValidationIssue[]> {
  const map = new Map<number, ValidationIssue[]>();
  for (const issue of issues) {
    if (!map.has(issue.row)) map.set(issue.row, []);
    map.get(issue.row)!.push(issue);
  }
  return map;
}

const FIELD_LABELS: Record<RiderFieldKey | "general", string> = {
  bibNumber: "Bib #",
  firstName: "First Name",
  middleName: "Middle Name",
  lastName: "Last Name",
  firstNameEnglish: "First Name (English)",
  lastNameEnglish: "Last Name (English)",
  fullName: "Full Name",
  category: "Category",
  subCategory: "Sub-Category",
  team: "Team",
  gender: "Gender",
  heat: "Heat",
  startTime: "Start Time",
  totalLaps: "Laps",
  position: "Position",
  standing: "Standing",
  raceDay: "Race Day",
  points: "Points",
  federation: "Federation",
  uciNumber: "UCI #",
  idNumber: "ID #",
  birthDate: "Birth Date",
  federationNumber: "Federation #",
  federationChip: "Federation Chip",
  roadNumber: "Road #",
  chip: "Chip",
  notes: "Notes",
  general: "General"
};

export default function ImportProgressStep({
  progress,
  skippedIssues,
  onClose
}: ImportProgressStepProps) {
  const [showLog, setShowLog] = useState(false);

  const isComplete = progress.status === "completed";
  const hasSkipped = progress.failed > 0;
  const percentage =
    progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;

  const rowGroups = groupByRow(skippedIssues);
  const sortedRows = [...rowGroups.keys()].sort((a, b) => a - b);

  return (
    <div className={styles.progressStep}>
      {!isComplete ? (
        <>
          <div className={styles.header}>
            <h3>Importing Riders...</h3>
            <p>Please wait while riders are saved.</p>
          </div>
          <div className={styles.progressContainer}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${percentage}%` }} />
            </div>
            <div className={styles.progressText}>
              {progress.processed} / {progress.total} ({percentage}%)
            </div>
          </div>
        </>
      ) : (
        <>
          {/* ── Headline ── */}
          <div className={styles.completedHeader}>
            <div className={styles.successIcon}>{hasSkipped ? "⚠️" : "✅"}</div>
            <h3 className={hasSkipped ? styles.headlineWarn : styles.headlineOk}>
              Imported {progress.successful} of {progress.total} riders
              {hasSkipped && ` (${progress.failed} skipped)`}
            </h3>
          </div>

          {/* ── Stats row ── */}
          <div className={styles.completedStats}>
            <div className={styles.completedStat}>
              <span className={styles.completedLabel}>In file</span>
              <span className={styles.completedValue}>{progress.total}</span>
            </div>
            <div className={styles.completedStat}>
              <span className={styles.completedLabel}>Imported</span>
              <span className={`${styles.completedValue} ${styles.success}`}>
                {progress.successful}
              </span>
            </div>
            {hasSkipped && (
              <div className={styles.completedStat}>
                <span className={styles.completedLabel}>Skipped</span>
                <span className={`${styles.completedValue} ${styles.error}`}>
                  {progress.failed}
                </span>
              </div>
            )}
          </div>

          {/* ── Error log ── */}
          {hasSkipped && (
            <div className={styles.logSection}>
              <button
                className={styles.toggleLog}
                onClick={() => setShowLog((v) => !v)}
              >
                {showLog ? "▾ Hide error log" : "▸ Show error log"} ({skippedIssues.length} issue{skippedIssues.length !== 1 ? "s" : ""})
              </button>

              {showLog && (
                <div className={styles.logTable}>
                  <table>
                    <thead>
                      <tr>
                        <th className={styles.colRow}>Row</th>
                        <th className={styles.colField}>Field</th>
                        <th className={styles.colValue}>Value</th>
                        <th className={styles.colMsg}>Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((rowNum) =>
                        rowGroups.get(rowNum)!.map((issue, i) => (
                          <tr key={`${rowNum}-${i}`} className={styles.logRow}>
                            {i === 0 && (
                              <td
                                className={styles.colRow}
                                rowSpan={rowGroups.get(rowNum)!.length}
                              >
                                #{rowNum}
                              </td>
                            )}
                            <td className={styles.colField}>
                              {FIELD_LABELS[issue.field] ?? issue.field}
                            </td>
                            <td className={styles.colValue} dir="auto">
                              {issue.value || <span className={styles.empty}>(empty)</span>}
                            </td>
                            <td className={styles.colMsg}>{issue.message}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className={styles.completedActions}>
            <button onClick={onClose} className={styles.closeButton}>
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}
