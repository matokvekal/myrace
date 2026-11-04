/**
 * Confirmation for the one irreversible action in the app.
 *
 * The impact shown here comes from `planFinalization` (shared/race/finalPlan.ts),
 * the SAME rule the local finalize and the server transaction apply: riders still
 * on course finish on the laps they completed, riders of waves that never started
 * become DNS, DNF/DSQ/DNS stay. Each group expands to list its riders.
 *
 * It is deliberately NOT a generic "are you sure?". Finishing a race rewrites
 * every rider still on the road and then locks the whole race, so the modal
 * shows the actual counts FIRST — a commissaire who forgot a wave is still out
 * on course should see "12 riders still on the road" before they type anything,
 * not discover it in the results afterwards.
 *
 * The typed confirmation is the same pattern as DeleteConfirmModal, with a
 * different word so muscle memory from deleting a race can't fire here.
 */
import React, { useMemo, useState } from "react";
import styles from "./finishRaceModal.module.css";
import { AlertTriangle, Flag, Lock } from "lucide-react";
import type { CategoryProps, RiderProps } from "@/types/types";
import { planFinalization } from "../../../../shared/race/finalPlan";

interface Props {
  raceName: string;
  riders: RiderProps[];
  categories: CategoryProps[];
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

const CONFIRM_WORD = "FINISH";

const FinishRaceModal: React.FC<Props> = ({
  raceName,
  riders,
  categories,
  onConfirm,
  onCancel,
}) => {
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(() => planFinalization(riders, categories), [riders, categories]);
  const stats = {
    onRoad: plan.toFinish.length,
    toDNS: plan.toDNS.length,
    out: plan.kept.DNF.length + plan.kept.DSQ.length + plan.kept.DNS.length,
    openCats: plan.toClose.length,
    neverStarted: plan.notStarted.length,
  };

  const isValid = input.trim().toUpperCase() === CONFIRM_WORD;

  const handleConfirm = async () => {
    if (!isValid || working) return;
    setWorking(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish the race.");
      setWorking(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={working ? undefined : onCancel}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-race-title"
        data-testid="finish-race-modal"
      >
        <div className={styles.icon}>
          <Flag size={26} />
        </div>
        <h3 className={styles.title} id="finish-race-title">
          Finish “{raceName}”?
        </h3>
        <p className={styles.lead}>
          This closes the race for good and publishes the final classification.
        </p>

        {/* What this will actually do to the data — the same plan finalize applies. */}
        <div className={styles.summary}>
          <SummaryRow testId="finish-race-finished" value={plan.finished.length} label="finished — results kept" riders={plan.finished} />
          {stats.onRoad > 0 && (
            <SummaryRow
              testId="finish-race-onroad"
              value={stats.onRoad}
              label="still on course — become FINISHED on the laps they completed"
              riders={plan.toFinish}
              warn
            />
          )}
          {stats.toDNS > 0 && (
            <SummaryRow
              testId="finish-race-dns"
              value={stats.toDNS}
              label="never started — become DNS"
              riders={plan.toDNS}
              warn
            />
          )}
          {stats.out > 0 && (
            <SummaryRow
              testId="finish-race-kept"
              value={stats.out}
              label={`keep their status (${[["DNF", plan.kept.DNF.length], ["DSQ", plan.kept.DSQ.length], ["DNS", plan.kept.DNS.length]].filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ")})`}
              riders={[...plan.kept.DNF, ...plan.kept.DSQ, ...plan.kept.DNS]}
            />
          )}
          {stats.openCats > 0 && (
            <SummaryRow
              testId="finish-race-categories"
              value={stats.openCats}
              label={stats.neverStarted > 0 ? `categories will be closed (${stats.neverStarted} never started)` : "categories will be closed"}
              items={plan.toClose.map((c) => `${c.name}${c.subCategory ? ` ${c.subCategory}` : ""}${plan.notStarted.includes(c) ? " — not started" : ""}`)}
              warn={stats.neverStarted > 0}
            />
          )}
        </div>

        <div className={styles.lockNote}>
          <Lock size={14} className={styles.lockIcon} />
          <div>
            Afterwards the race becomes <strong>read-only</strong>: no live timing, no
            check-in, no imports, no edits to riders, categories or race details. Results
            stay viewable and exportable, and the export is signed so anyone can verify
            it wasn’t changed.
          </div>
        </div>

        {stats.onRoad > 0 && (
          <div className={styles.warning} data-testid="finish-race-onroad-warning">
            <AlertTriangle size={14} />
            <span>
              {stats.onRoad} rider{stats.onRoad === 1 ? " is" : "s are"} still shown as
              racing. If a wave is genuinely still out on course, cancel and finish that
              wave first.
            </span>
          </div>
        )}

        <div className={styles.confirmGroup}>
          <label className={styles.label} htmlFor="finish-race-input">
            Type <strong>{CONFIRM_WORD}</strong> to confirm
          </label>
          <input
            id="finish-race-input"
            className={styles.input}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
            placeholder={CONFIRM_WORD}
            autoFocus
            disabled={working}
            autoComplete="off"
          />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel} disabled={working}>
            Cancel
          </button>
          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={!isValid || working}
            data-testid="finish-race-confirm"
          >
            {working ? "Finishing…" : "Finish Race"}
          </button>
        </div>
      </div>
    </div>
  );
};

const riderLine = (r: RiderProps) =>
  `${r.bibNumber != null ? `#${r.bibNumber} ` : ""}${[r.firstName, r.lastName].filter(Boolean).join(" ")}${r.category ? ` · ${r.category}` : ""}${["DNF", "DSQ", "DNS"].includes(r.status) ? ` · ${r.status}` : ""}`;

const SummaryRow: React.FC<{
  value: number;
  label: string;
  warn?: boolean;
  testId: string;
  riders?: RiderProps[];
  items?: string[];
}> = ({ value, label, warn, testId, riders, items }) => {
  const lines = items ?? (riders ?? []).map(riderLine);
  const row = (
    <>
      <span className={styles.summaryValue}>{value}</span>
      <span className={styles.summaryLabel}>{label}</span>
    </>
  );
  if (lines.length === 0)
    return <div className={`${styles.summaryRow} ${warn ? styles.summaryWarn : ""}`} data-testid={testId}>{row}</div>;
  return (
    <details className={`${styles.summaryGroup} ${warn ? styles.summaryWarn : ""}`} data-testid={testId}>
      <summary className={styles.summaryRow}>{row}</summary>
      <ul className={styles.summaryList}>
        {lines.map((l, i) => (
          <li key={i} dir="auto">{l}</li>
        ))}
      </ul>
    </details>
  );
};

export default FinishRaceModal;
