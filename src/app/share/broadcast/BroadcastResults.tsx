/**
 * TV RESULTS — official only. Before Finish Race: a "results not yet official" screen that
 * points to LIVE. After: category by category, the podium (only when the judges APPROVED the
 * category — the existing rule) next to the official standings, paged. Only finishers are
 * listed (the RESULTS "Only Finishers" filter, presentation only). Order and positions are
 * the RESULTS tab's (results/officialOrder.ts), never recalculated.
 */
import React, { useMemo } from "react";
import type { SharedCategory } from "../../../shared/race/state";
import type { CategoryApprovalView } from "../../../shared/race/approval";
import type { PublicRider } from "../usePublicRaceFeed";
import { categoryKey, categoryLabel, isOutRider } from "../waves/activeWaves";
import { filterResultCategories, filterResultRiders } from "../results/resultFilterRules";
import { rankRiders } from "../results/officialOrder";
import { BroadcastHeader } from "./BroadcastHeader";
import { BroadcastFooter, chunk } from "./BroadcastPagination";
import { headerStatus, type BroadcastCommon } from "./BroadcastLeaderboard";
import { useFitRows, usePager } from "./useBroadcast";
import styles from "./broadcast.module.css";

const TV_FILTER = { onlyFinishers: true, byWave: false, wave: null };

interface ResultPage {
  category: SharedCategory;
  ranked: PublicRider[];
  podium: PublicRider[] | null;
  rows: PublicRider[];
  index: number;
  of: number;
  catIndex: number;
}

export function BroadcastResults(
  props: BroadcastCommon & { categories: SharedCategory[]; ridersByCat: Map<string, PublicRider[]>; approvals: Map<string, CategoryApprovalView> },
) {
  const { race, categories, ridersByCat, approvals, clockOffsetMs, freshness, updatedAt, raceFinished } = props;
  const [listRef, rows] = useFitRows();
  const per = Math.max(3, rows - 1);

  const pages: ResultPage[] = useMemo(() => {
    if (!raceFinished) return [];
    const withRiders = categories.filter((c) => (ridersByCat.get(categoryKey(c.name, c.subCategory)) ?? []).length > 0);
    const shown = filterResultCategories(withRiders, ridersByCat, TV_FILTER);
    return shown.flatMap((category, catIndex) => {
      const all = rankRiders(ridersByCat.get(categoryKey(category.name, category.subCategory)) ?? []);
      // Same podium rule as RESULTS: approved category, classified riders, top 3.
      const podium = approvals.get(category.uuid) ? all.filter((r) => !isOutRider(r) && r.position_category).slice(0, 3) : null;
      const ranked = filterResultRiders(all, TV_FILTER);
      const parts = chunk(ranked, per);
      return parts.map((part, index) => ({ category, ranked, podium, rows: part, index, of: parts.length, catIndex }));
    });
  }, [raceFinished, categories, ridersByCat, approvals, per]);

  const page = usePager(pages.length, undefined, `${pages.length}`);
  const current = pages[page];
  const catCount = current ? new Set(pages.map((p) => p.category.uuid)).size : 0;

  return (
    <>
      <BroadcastHeader
        race={race}
        status={headerStatus(freshness, raceFinished, props.waves.some((w) => w.state === "running"))}
        tag={raceFinished ? "official" : null}
        context={current ? null : race.date ?? null}
        contextCategories={current ? [current.category] : undefined}
        clock={{ kind: "text", label: "Race", text: raceFinished ? "Final" : "In progress" }}
        clockOffsetMs={clockOffsetMs}
      />
      <div className={styles.rule} aria-hidden="true" />
      <main className={styles.main} ref={listRef} data-testid="tv-results">
        {!raceFinished ? (
          <div className={styles.panel} data-testid="tv-results-pending">
            <div className={styles.panelKicker}>Official results</div>
            <h2 className={styles.panelTitle}>Race in progress</h2>
            <p className={styles.panelText}>Results are published once the race is officially finished. Follow the provisional standings on LIVE.</p>
          </div>
        ) : !current ? (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>No finishers to show</h2>
          </div>
        ) : (
          <div key={page} className={`${styles.resultsGrid} ${styles.pageIn}`}>
            <Podium podium={current.podium} />
            <div className={styles.board}>
              <div className={`${styles.resultRow} ${styles.headRow}`} aria-hidden="true">
                <span>Pos</span><span>Bib</span><span>Rider</span><span className={styles.num}>Laps</span><span className={styles.num}>Time</span><span className={styles.statusCol}>Status</span>
              </div>
              <ol className={styles.rows} aria-label={`${categoryLabel(current.category)} official results`}>
                {current.rows.map((r) => (
                  <li key={r.uuid} className={styles.resultRow} data-podium={r.position_category && r.position_category <= 3 ? String(r.position_category) : undefined} data-testid="tv-result-row">
                    <span className={styles.pos}>{isOutRider(r) ? "–" : r.position_category || "–"}</span>
                    <span className={styles.bibCell}><span className={styles.bib}>{r.bibNumber ?? "—"}</span></span>
                    <span className={styles.name} dir="auto">
                      <span className={styles.first}>{[r.firstName, r.middleName].filter(Boolean).join(" ")} </span>
                      <span className={styles.last}>{r.lastName}</span>
                    </span>
                    <span className={`${styles.num} ${styles.laps}`}>{r.lapsCounter ?? 0}{current.category.laps ? `/${current.category.laps}` : ""}</span>
                    <span className={`${styles.num} ${styles.time}`}>{r.elapsedTimeFromStart || "—"}</span>
                    <span className={styles.statusCol}><span className={styles.chip} data-status={isOutRider(r) ? r.status : "FINISHED"}>{isOutRider(r) ? r.status : "FINISHED"}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </main>
      <BroadcastFooter
        note={raceFinished ? "Official results · finishers" : "Results are published when the race is finished"}
        page={page}
        pages={pages.length}
        pageLabel={current ? `${categoryLabel(current.category)}${current.of > 1 ? ` ${current.index + 1}/${current.of}` : ""} · category ${current.catIndex + 1} of ${catCount}` : null}
        freshness={raceFinished ? "fresh" : freshness}
        updatedAt={updatedAt}
      />
    </>
  );
}

const MEDAL = ["Gold", "Silver", "Bronze"];

function Podium({ podium }: { podium: PublicRider[] | null }) {
  if (!podium) {
    return (
      <div className={styles.podiumWait} data-testid="tv-podium-pending">
        <div className={styles.panelKicker}>Podium</div>
        <p>Shown once the judges approve this category's results.</p>
      </div>
    );
  }
  // Broadcast order: 2 · 1 · 3
  const order = [1, 0, 2].filter((i) => podium[i]);
  return (
    <div className={styles.podium} data-testid="tv-podium" aria-label="Podium">
      {order.map((i) => {
        const r = podium[i];
        return (
          <div key={r.uuid} className={styles.step} data-place={i + 1} aria-label={`${MEDAL[i]}: ${r.firstName ?? ""} ${r.lastName ?? ""}`}>
            <div className={styles.stepName} dir="auto">
              <span className={styles.first}>{r.firstName}</span>
              <span className={styles.last}>{r.lastName}</span>
            </div>
            <div className={styles.stepMeta}><span className={styles.bib}>{r.bibNumber ?? "—"}</span> {r.elapsedTimeFromStart ?? ""}</div>
            <div className={styles.stepBlock}>{i + 1}</div>
          </div>
        );
      })}
    </div>
  );
}
