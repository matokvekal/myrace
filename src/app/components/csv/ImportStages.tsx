"use client";

import styles from "./importStages.module.css";

/** What the import is doing right now (Phase 2: immediate, meaningful feedback). */
export type ImportStage = "reading" | "mapping" | "validating" | "duplicates" | "saving";

export const IMPORT_STAGES: { key: ImportStage; label: string }[] = [
  { key: "reading", label: "Reading" },
  { key: "mapping", label: "Mapping" },
  { key: "validating", label: "Validating" },
  { key: "duplicates", label: "Resolving duplicates" },
  { key: "saving", label: "Saving" },
];

interface Props {
  stage: ImportStage;
  /** One line under the stages ("Sending 240 riders to the server…"). */
  detail?: string;
  /** Only when progress is really measurable; otherwise the bar is indeterminate. */
  progress?: { done: number; total: number };
}

/**
 * Stage list + bar. The bar is a real percentage only when the caller can count
 * (`progress`); reading a file, one IndexedDB transaction or one server request
 * can't be measured, so they get an indeterminate bar instead of a fake 0 %.
 */
export default function ImportStages({ stage, detail, progress }: Props) {
  const current = IMPORT_STAGES.findIndex((s) => s.key === stage);
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;
  return (
    <div className={styles.stages} role="status" aria-live="polite" data-testid="import-stage" data-stage={stage}>
      <ol className={styles.list}>
        {IMPORT_STAGES.map((s, i) => (
          <li key={s.key} data-state={i < current ? "done" : i === current ? "active" : "todo"}>
            {s.label}
          </li>
        ))}
      </ol>
      <div
        className={styles.bar}
        data-indeterminate={pct == null ? "true" : undefined}
        role="progressbar"
        aria-label={IMPORT_STAGES[current]?.label ?? "Importing"}
        {...(pct != null ? { "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100 } : {})}
      >
        <span style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
      <p className={styles.detail} dir="auto">
        {detail ?? `${IMPORT_STAGES[current]?.label ?? "Working"}…`}
        {pct != null && ` ${pct}%`}
      </p>
    </div>
  );
}
