import React, { useEffect, useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import type { CategoryProps, RiderProps } from "@/types/types";
import { groupRidersByWaveAndCategory, matchesRiderSearch } from "@/utils/riderList";
import { withCategoryLaps } from "../../schedule/Schedule";
import { STATUS_LABEL } from "@/utils/statusLabels";
import styles from "./riderLookupModal.module.css";

interface Props {
  /** Every rider of THIS race (all waves). */
  riders: RiderProps[];
  categories: CategoryProps[];
  onClose: () => void;
}

interface Row {
  rider: RiderProps;
  wave: number | null;
  category: string;
  color: string | null;
}

const OUT = new Set(["DNF", "DSQ", "DNS"]);

/** Rider status in the words the race screens use; laps only once they are racing. */
export function lookupStatus(r: Pick<RiderProps, "status" | "raceStatus" | "lapsCounter" | "totalLaps">): string {
  if (OUT.has(r.status)) return r.status;
  if (r.raceStatus === "finished") return STATUS_LABEL.finished;
  if (r.raceStatus === "running") {
    const laps = r.lapsCounter ?? 0;
    return r.totalLaps > 0 ? `${STATUS_LABEL.running} · lap ${laps}/${r.totalLaps}` : `${STATUS_LABEL.running} · lap ${laps}`;
  }
  return STATUS_LABEL.upcoming;
}

/**
 * Live screen: "who is bib 150?" — a READ-ONLY lookup over the whole race, every wave.
 * Nothing here records a lap or changes the board: rows have no action, and the Live
 * cards, filters and queue are untouched (this modal owns its own query).
 */
const RiderLookupModal: React.FC<Props> = ({ riders, categories, onClose }) => {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Wave and category per rider, from the schedule (a category without a wave number gets its derived one).
  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const w of groupRidersByWaveAndCategory(withCategoryLaps(riders, categories), categories)) {
      for (const c of w.categories) {
        for (const r of c.riders) out.push({ rider: r, wave: w.wave, category: c.name, color: c.category?.color ?? r.color ?? null });
      }
    }
    return out;
  }, [riders, categories]);

  const rows = useMemo(() => {
    const q = query.trim();
    const hits = allRows.filter((row) => matchesRiderSearch(row.rider, q));
    // A typed bib: the exact bib first, then bibs that start with it, then the rest (names).
    const rank = (row: Row) => {
      if (!q) return 0;
      const bib = String(row.rider.bibNumber ?? "");
      return bib === q ? 0 : bib.startsWith(q) ? 1 : 2;
    };
    return hits.sort(
      (a, b) => rank(a) - rank(b) || (a.rider.bibNumber || 1e9) - (b.rider.bibNumber || 1e9) || a.rider.id - b.rider.id
    );
  }, [allRows, query]);

  // Swipes / taps inside the sheet must not reach the Live screen (mode swipe, card taps).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className={styles.overlay} onClick={onClose} onTouchStart={stop} onTouchEnd={stop} data-testid="rider-lookup">
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rider-lookup-title"
        onClick={stop}
      >
        <div className={styles.header}>
          <h2 id="rider-lookup-title" className={styles.title}>Find a rider</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close" data-testid="rider-lookup-close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <label className={styles.searchBox}>
          <Search size={16} aria-hidden="true" className={styles.searchIcon} />
          <input
            type="search"
            className={styles.input}
            placeholder="Bib or name"
            aria-label="Search by bib or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            autoComplete="off"
            enterKeyHint="search"
            data-testid="rider-lookup-input"
          />
        </label>
        <p className={styles.hint}>Look-up only: nothing here records a lap.</p>
        <p className={styles.count} aria-live="polite">
          {rows.length} of {allRows.length} riders
        </p>
        <ul className={styles.list} data-testid="rider-lookup-list">
          {rows.map(({ rider: r, wave, category, color }) => (
            <li key={r.id} className={styles.row} data-testid="rider-lookup-row" data-bib={r.bibNumber}>
              <span className={styles.bib} style={color ? { borderColor: color } : undefined}>{r.bibNumber || "—"}</span>
              <span className={styles.main}>
                <span className={styles.name} dir="auto">
                  {[r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ") || "—"}
                </span>
                <span className={styles.meta} dir="auto">
                  {category} · {wave != null ? `Wave ${wave}` : "No wave"}
                </span>
              </span>
              <span className={styles.status} data-status={OUT.has(r.status) ? "out" : r.raceStatus}>
                {lookupStatus(r)}
              </span>
            </li>
          ))}
          {rows.length === 0 && <li className={styles.empty}>No rider matches “{query.trim()}”.</li>}
        </ul>
      </div>
    </div>
  );
};

export default RiderLookupModal;
