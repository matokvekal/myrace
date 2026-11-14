"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  bibCorrectionsFrom,
  initialBibChoices,
  validateBibChoices,
  type BibConflictGroup,
  type BibCorrection,
  type ExistingBibRider,
  type ImportBibRow,
} from "@/utils/bibConflicts";
import styles from "./bibConflictStep.module.css";

interface BibConflictStepProps {
  groups: BibConflictGroup[];
  /** Every rider of the batch (not only the conflicting ones): a new number must not hit any of them. */
  rows: ImportBibRow[];
  existing: ExistingBibRider[];
  busy?: boolean;
  /** Called with the confirmed renumbering only. Nothing is saved before. */
  onConfirm: (corrections: BibCorrection[]) => void;
  onCancel: () => void;
}

const wave = (h: number | null | undefined) => (h ? `Wave ${h}` : "No wave");

/**
 * Phase 2: duplicate bibs of an import, resolved by the organizer BEFORE anything is
 * saved. Each conflicting row shows the proposed free number; every number can be
 * edited, and the import goes on only after the explicit confirm, once every bib of
 * the race is unique. Back = cancel, nothing changes.
 */
export default function BibConflictStep({ groups, rows, existing, busy, onConfirm, onCancel }: BibConflictStepProps) {
  const [choices, setChoices] = useState<Map<number, number | null>>(() => initialBibChoices(groups));
  const errors = useMemo(() => validateBibChoices(rows, existing, choices), [rows, existing, choices]);
  const changed = useMemo(() => bibCorrectionsFrom(groups, choices), [groups, choices]);
  const conflictRows = groups.reduce((n, g) => n + g.rows.length, 0);

  const setChoice = (index: number, raw: string) => {
    const t = raw.trim();
    const n = /^\d+$/.test(t) ? Number(t) : null;
    setChoices((prev) => new Map(prev).set(index, n));
  };

  return (
    <div className={styles.step} data-testid="bib-conflicts">
      <div className={styles.intro}>
        <h3>
          <AlertTriangle size={18} aria-hidden /> Duplicate bib numbers
        </h3>
        <p>
          A bib must be unique in the whole race, across every wave. {groups.length} bib
          {groups.length === 1 ? "" : "s"} clash ({conflictRows} rows). We propose a free number for each
          extra rider — change any number you like. Nothing is saved until you confirm.
        </p>
      </div>

      <div className={styles.groups}>
        {groups.map((g) => (
          <section key={g.bib} className={styles.group} data-testid={`bib-group-${g.bib}`}>
            <header className={styles.groupHead}>
              <span className={styles.bib}>#{g.bib}</span>
              <span dir="auto">
                {g.kind === "existing"
                  ? `Already in this race: ${g.existing?.name || "a rider"}${g.existing?.heat ? ` · ${wave(g.existing.heat)}` : ""}`
                  : `${g.rows.length} rows in the file`}
              </span>
            </header>
            {g.rows.map((r) => {
              const value = choices.get(r.index);
              const err = errors.get(r.index);
              const keeps = value === r.bib;
              return (
                <div key={r.index} className={styles.row} data-error={err ? "true" : undefined}>
                  <span className={styles.who}>
                    <span className={styles.name} dir="auto">
                      Row {r.row} · {r.name || "no name"}
                    </span>
                    <span className={styles.meta} dir="auto">
                      {[r.category, wave(r.heat)].filter(Boolean).join(" · ")}
                    </span>
                    {err && <span className={styles.error} role="alert">{err}</span>}
                  </span>
                  <span className={styles.tag} data-keep={keeps ? "true" : undefined}>
                    {keeps ? "Original" : "New"}
                  </span>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    aria-label={`Bib for row ${r.row}`}
                    data-testid={`bib-choice-${r.index}`}
                    value={value == null ? "" : String(value)}
                    onChange={(e) => setChoice(r.index, e.target.value)}
                  />
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.backButton} onClick={onCancel} disabled={busy}>
          Back
        </button>
        <button
          type="button"
          className={styles.confirmButton}
          data-testid="bib-conflicts-confirm"
          disabled={busy || errors.size > 0}
          onClick={() => onConfirm(changed)}
        >
          {errors.size > 0
            ? `Fix ${errors.size} number${errors.size === 1 ? "" : "s"} first`
            : `Confirm ${changed.length} new number${changed.length === 1 ? "" : "s"} and import`}
        </button>
      </div>
    </div>
  );
}
