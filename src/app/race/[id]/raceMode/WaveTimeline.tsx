import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Clock, Crosshair, Radio, SkipForward } from "lucide-react";
import type { CategoryProps, RiderProps } from "@/types/types";
import { riderInCategory, toMinutes, normalizeTime } from "../schedule/Schedule";
import styles from "./waveTimeline.module.css";

export type WaveState = "upcoming" | "running" | "finished";

const OUT = ["DNF", "DSQ", "DNS"];

/** Rider counts for a set of categories, from the existing rider fields only. */
export function waveStats(cats: CategoryProps[], riders: RiderProps[]) {
  const list = riders.filter((r) => cats.some((c) => riderInCategory(r, c)));
  const out = (r: RiderProps) => OUT.includes(r.status);
  return {
    registered: list.length,
    started: list.filter((r) => r.raceStatus !== "upcoming" && r.status !== "DNS").length,
    onCourse: list.filter((r) => r.raceStatus === "running" && !out(r)).length,
    finished: list.filter((r) => r.raceStatus === "finished" && !out(r)).length,
    dnf: list.filter((r) => r.status === "DNF").length,
    dns: list.filter((r) => r.status === "DNS").length,
    dsq: list.filter((r) => r.status === "DSQ").length,
  };
}

const STATE_LABEL: Record<WaveState, string> = { upcoming: "Upcoming", running: "Racing", finished: "Done" };
const StateIcon: React.FC<{ s: WaveState; size?: number }> = ({ s, size = 13 }) =>
  s === "running" ? <Radio size={size} /> : s === "finished" ? <CheckCircle2 size={size} /> : <Circle size={size} />;

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};
const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const PX_PER_MIN = 1.2; // 72 px per hour
const CARD_MIN_PX = 66;

interface Item {
  wave: number;
  state: WaveState;
  start: number; // minutes since midnight
  end: number | null; // actual end (running → now, finished → finishedAt); null = unknown
  cats: CategoryProps[];
  startLabel: string;
}

interface Props {
  schedule: Map<number, Map<string, CategoryProps[]>>;
  states: Map<number, WaveState>;
  riders: RiderProps[];
  selected: number;
  onSelect: (wave: number) => void;
  /** Race date, shown in the header. */
  date?: string;
}

/**
 * Race-day timeline (calendar day view): waves at their scheduled start on a
 * time axis, a live "now" line, Now / Next / Active jumps. Presentation only —
 * selecting a wave just sets the shared selected wave.
 */
const WaveTimeline: React.FC<Props> = ({ schedule, states, riders, selected, onSelect, date }) => {
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutes()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { items, unscheduled } = useMemo(() => {
    const items: Item[] = [];
    const unscheduled: Item[] = [];
    schedule.forEach((startMap, wave) => {
      const cats = [...startMap.values()].flat();
      const firstKey = [...startMap.keys()].find((k) => k !== "TBD");
      const state = states.get(wave) ?? "upcoming";
      const start = firstKey ? toMinutes(firstKey) : NaN;
      let end: number | null = null;
      if (state === "running") end = Math.max(now, start);
      if (state === "finished") {
        const fin = cats.map((c) => c.finishedAt).filter((x): x is number => typeof x === "number");
        if (fin.length) {
          const d = new Date(Math.max(...fin));
          end = Math.max(d.getHours() * 60 + d.getMinutes(), start);
        }
      }
      const item = { wave, state, start, end, cats, startLabel: firstKey ? normalizeTime(firstKey) ?? firstKey : "TBD" };
      (Number.isFinite(start) ? items : unscheduled).push(item);
    });
    items.sort((a, b) => a.start - b.start);
    return { items, unscheduled };
  }, [schedule, states, now]);

  // Visible range: whole hours around the waves (and now, when it's close)
  const range = useMemo(() => {
    if (!items.length) return null;
    const lo = Math.min(...items.map((i) => i.start));
    const hi = Math.max(...items.map((i) => i.end ?? i.start + CARD_MIN_PX / PX_PER_MIN));
    const nearNow = now >= lo - 120 && now <= hi + 120;
    const from = Math.max(0, Math.floor((Math.min(lo, nearNow ? now : lo) - 30) / 60) * 60);
    const to = Math.min(1440, Math.ceil((Math.max(hi, nearNow ? now : hi) + 30) / 60) * 60);
    return { from, to };
  }, [items, now]);

  // Lay out cards; overlapping ones share the row side by side
  const laid = useMemo(() => {
    if (!range) return [];
    const boxes = items.map((it) => {
      const top = (it.start - range.from) * PX_PER_MIN;
      const h = Math.max(CARD_MIN_PX, ((it.end ?? it.start) - it.start) * PX_PER_MIN);
      return { it, top, bottom: top + h, lane: 0, lanes: 1 };
    });
    let cluster: typeof boxes = [];
    let clusterBottom = -Infinity;
    const closeCluster = () => {
      const lanes = Math.max(1, ...cluster.map((b) => b.lane + 1));
      cluster.forEach((b) => (b.lanes = lanes));
      cluster = [];
    };
    const laneBottoms: number[] = [];
    for (const b of boxes) {
      if (b.top >= clusterBottom) {
        closeCluster();
        laneBottoms.length = 0;
        clusterBottom = -Infinity;
      }
      let lane = laneBottoms.findIndex((bt) => bt <= b.top);
      if (lane === -1) lane = laneBottoms.length;
      laneBottoms[lane] = b.bottom;
      b.lane = lane;
      cluster.push(b);
      clusterBottom = Math.max(clusterBottom, b.bottom);
    }
    closeCluster();
    return boxes;
  }, [items, range]);

  // Scroll once on open: the active wave, else the next one, else now
  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);
  const scrollToMinute = (min: number, smooth = true) => {
    const el = scrollRef.current;
    if (!el || !range) return;
    el.scrollTo({ top: Math.max(0, (min - range.from) * PX_PER_MIN - 60), behavior: smooth ? "smooth" : "auto" });
  };
  const activeWave = items.find((i) => i.state === "running");
  const nextWave = items.find((i) => i.state === "upcoming" && i.start >= now) ?? items.find((i) => i.state === "upcoming");
  useEffect(() => {
    if (didScroll.current || !range) return;
    didScroll.current = true;
    scrollToMinute((activeWave ?? nextWave)?.start ?? now, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const jump = (it?: Item) => {
    if (!it) return;
    onSelect(it.wave);
    scrollToMinute(it.start);
  };

  if (!items.length && !unscheduled.length) {
    return <div className={styles.empty}>No waves configured</div>;
  }

  const hours: number[] = [];
  if (range) for (let m = range.from; m <= range.to; m += 30) hours.push(m);
  const showNow = range && now >= range.from && now <= range.to;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.dayLabel}>
          <Clock size={14} /> {hhmm(now)}
          {date && <span className={styles.date}> · {date}</span>}
        </span>
        <div className={styles.jumps}>
          <button type="button" className={styles.jumpBtn} onClick={() => scrollToMinute(now)} title="Scroll to now">
            <Crosshair size={14} /> Now
          </button>
          <button type="button" className={styles.jumpBtn} onClick={() => jump(nextWave)} disabled={!nextWave} title="Next wave">
            <SkipForward size={14} /> Next
          </button>
          <button type="button" className={styles.jumpBtn} onClick={() => jump(activeWave)} disabled={!activeWave} title="Racing wave">
            <Radio size={14} /> Active
          </button>
        </div>
      </div>

      {range && (
        <div className={styles.scroll} ref={scrollRef} data-testid="wave-timeline">
          <div className={styles.grid} style={{ height: (range.to - range.from) * PX_PER_MIN + 8 }}>
            {hours.map((m) => (
              <div
                key={m}
                className={`${styles.tick} ${m % 60 === 0 ? styles.tickHour : styles.tickHalf}`}
                style={{ top: (m - range.from) * PX_PER_MIN }}
              >
                <span className={styles.tickLabel}>{m % 60 === 0 ? hhmm(m) : ""}</span>
              </div>
            ))}

            <div className={styles.lane}>
              {laid.map(({ it, top, bottom, lane, lanes }) => {
                const s = waveStats(it.cats, riders);
                const isSel = it.wave === selected;
                return (
                  <button
                    key={it.wave}
                    type="button"
                    className={`${styles.card} ${styles[`card_${it.state}`]} ${isSel ? styles.cardSel : ""}`}
                    style={{
                      top,
                      height: bottom - top - 3,
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }}
                    onClick={() => onSelect(it.wave)}
                    aria-pressed={isSel}
                    data-testid={`timeline-wave-${it.wave}`}
                  >
                    <span className={styles.cardTop}>
                      <span className={styles.cardName}>Wave {it.wave}</span>
                      <span className={styles.cardTime}>{it.startLabel}</span>
                      <span className={`${styles.state} ${styles[`state_${it.state}`]}`}>
                        <StateIcon s={it.state} /> {STATE_LABEL[it.state]}
                      </span>
                    </span>
                    <span className={styles.cardCats} dir="auto">{it.cats.map((c) => c.name).join(" · ")}</span>
                    <span className={styles.cardStats}>
                      {it.state === "running" ? (
                        <b>{s.onCourse} / {s.started} on course</b>
                      ) : (
                        <>{s.registered} riders</>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {showNow && (
              <div className={styles.now} style={{ top: (now - range.from) * PX_PER_MIN }} aria-label={`Now ${hhmm(now)}`}>
                <span className={styles.nowLabel}>{hhmm(now)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {unscheduled.length > 0 && (
        <div className={styles.unscheduled}>
          <span className={styles.unschedLabel}>No start time</span>
          {unscheduled.map((it) => (
            <button
              key={it.wave}
              type="button"
              className={`${styles.chip} ${it.wave === selected ? styles.chipSel : ""}`}
              onClick={() => onSelect(it.wave)}
            >
              Wave {it.wave}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Selected wave summary: status, rider numbers, categories (expandable). */
export const WaveSummary: React.FC<{
  wave: number;
  state: WaveState;
  startLabel: string;
  cats: CategoryProps[];
  riders: RiderProps[];
}> = ({ wave, state, startLabel, cats, riders }) => {
  const [catsOpen, setCatsOpen] = useState(false);
  const s = waveStats(cats, riders);
  const live = state !== "upcoming";
  return (
    <section className={`${styles.summary} ${styles[`summary_${state}`]}`} data-testid="wave-summary">
      <div className={styles.sumHead}>
        <span className={styles.sumName}>Wave {wave}</span>
        <span className={styles.sumTime}>{startLabel}</span>
        <span className={`${styles.state} ${styles[`state_${state}`]}`}>
          <StateIcon s={state} size={14} /> {STATE_LABEL[state]}
        </span>
      </div>

      <div className={styles.bigStat}>
        {live ? (
          <>
            <span className={styles.bigNum}>{s.onCourse}</span>
            <span className={styles.bigOf}>/ {s.registered}</span>
            <span className={styles.bigLabel}>riders on course</span>
          </>
        ) : (
          <>
            <span className={styles.bigNum}>{s.registered}</span>
            <span className={styles.bigLabel}>riders registered · not started</span>
          </>
        )}
      </div>

      <div className={styles.statRow}>
        <span><b>{s.registered}</b> registered</span>
        <span><b>{live ? s.started : "—"}</b> started</span>
        <span><b>{live ? s.finished : "—"}</b> finished</span>
        <span><b>{s.dnf}</b> DNF</span>
        <span><b>{s.dns}</b> DNS</span>
        {s.dsq > 0 && <span><b>{s.dsq}</b> DSQ</span>}
      </div>

      <button type="button" className={styles.catToggle} onClick={() => setCatsOpen((o) => !o)} aria-expanded={catsOpen}>
        {cats.length} categor{cats.length === 1 ? "y" : "ies"}
        {catsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {catsOpen ? (
        <div className={styles.catList}>
          {cats.map((c) => {
            const cs = waveStats([c], riders);
            return (
              <div key={c.id} className={styles.catRow}>
                <span className={styles.catDot} style={{ background: c.color ?? "#9ca3af" }} />
                <span className={styles.catName} dir="auto">{c.name}{c.subCategory ? ` · ${c.subCategory}` : ""}</span>
                <span className={styles.catNums}>
                  {cs.registered} reg
                  {live && <> · {cs.started} started · {cs.finished} fin · <b>{cs.onCourse} on course</b></>}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.catChips}>
          {cats.map((c) => (
            <span key={c.id} className={styles.catChip} dir="auto">
              <span className={styles.catDot} style={{ background: c.color ?? "#9ca3af" }} />
              {c.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
};

export default WaveTimeline;
