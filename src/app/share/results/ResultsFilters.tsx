/**
 * RESULTS filters (public page 2.0): Only Finishers + Filter by Wave (with a wave picker).
 * Presentation only — see resultFilterRules.ts. Native checkboxes/select: keyboard and screen
 * reader friendly; the active filters are summarised with a one-tap Clear.
 */
import React from "react";
import { waveLabel } from "../waves/activeWaves";
import type { ResultsFilterState } from "./resultFilterRules";
import styles from "./results.module.css";

export function ResultsFilters({
  value,
  waves,
  onChange,
}: {
  value: ResultsFilterState;
  waves: string[];
  onChange: (next: ResultsFilterState) => void;
}) {
  const active = value.onlyFinishers || (value.byWave && value.wave != null);
  const summary = [value.onlyFinishers ? "Finishers only" : null, value.byWave && value.wave != null ? waveLabel(value.wave) : null].filter(Boolean).join(" · ");
  return (
    <div className={styles.filters} role="group" aria-label="Result filters" data-testid="share-results-filters">
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={value.onlyFinishers}
          onChange={(e) => onChange({ ...value, onlyFinishers: e.target.checked })}
          data-testid="share-only-finishers"
        />
        <span>Only finishers</span>
      </label>
      {waves.length > 1 && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={value.byWave}
            onChange={(e) => onChange({ ...value, byWave: e.target.checked, wave: e.target.checked ? value.wave ?? waves[0] : value.wave })}
            data-testid="share-filter-by-wave"
          />
          <span>Filter by wave</span>
        </label>
      )}
      {value.byWave && waves.length > 1 && (
        <select
          className={styles.waveSelect}
          value={value.wave ?? waves[0]}
          onChange={(e) => onChange({ ...value, wave: e.target.value })}
          aria-label="Wave"
          data-testid="share-wave-filter"
        >
          {waves.map((w) => (
            <option key={w} value={w}>{waveLabel(w)}</option>
          ))}
        </select>
      )}
      {active && (
        <span className={styles.activeSummary} role="status">
          <span className={styles.activeDot} aria-hidden="true" /> {summary}
          <button type="button" className={styles.clear} onClick={() => onChange({ onlyFinishers: false, byWave: false, wave: null })} data-testid="share-filters-clear">
            Clear
          </button>
        </span>
      )}
    </div>
  );
}
