import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Circle, ClipboardCheck, Clock, Crosshair, Flag, FlagTriangleRight, LayoutDashboard, Radio, SkipForward, Trophy, X } from "lucide-react";
import type { CategoryProps, RiderProps } from "@/types/types";
import { riderInCategory, toMinutes, normalizeTime } from "../schedule/Schedule";
import { getCategoryBibIssues } from "@/utils/bibIssues";
import { buildTimelineAxis, timelineRange } from "./timelineAxis";
import { daysSinceRace, waveProblem } from "./waveHealth";
import styles from "./waveTimeline.module.css";

export type WaveState = "upcoming" | "running" | "finished";
export type WaveAction = "checkin" | "changes" | "start" | "live" | "finish" | "results" | "board";

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
    /** Check-In: checked in, or already accounted for as DNS/DNF/DSQ. */
    accounted: list.filter((r) => r.checked || out(r)).length,
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

const PX_PER_MIN = 2; // 120 px per hour
const CARD_GAP_PX = 10;
const COMPACT_CARD_PX = 62;
// Card rows have these fixed heights in waveTimeline.module.css (--row-*), so the
// axis knows each card's height before it renders.
const CARD_PADDING_PX = 18; // padding + border
const HEAD_ROW_PX = 24;
const START_ROW_PX = 28;
const CAT_ROW_PX = 26;
const ACTIONS_ROW_PX = 34;

interface WaveStart {
  label: string;
  cats: CategoryProps[];
}

interface Item {
  wave: number;
  state: WaveState;
  start: number; // minutes since midnight
  end: number | null; // actual end (running → now, finished → finishedAt); null = unknown
  cats: CategoryProps[];
  starts: WaveStart[];
  startLabel: string;
}

const cardHeight = (it: Item, compact: boolean, hasActions: boolean) =>
  compact
    ? COMPACT_CARD_PX
    : CARD_PADDING_PX +
      HEAD_ROW_PX +
      it.starts.length * START_ROW_PX +
      it.cats.length * CAT_ROW_PX +
      (hasActions ? ACTIONS_ROW_PX : 0);

interface Props {
  schedule: Map<number, Map<string, CategoryProps[]>>;
  states: Map<number, WaveState>;
  riders: RiderProps[];
  selected: number;
  onSelect: (wave: number) => void;
  /** Race date, shown in the header. */
  date?: string;
  /** Narrow rail next to the wave panel: wave number, time and status only. */
  compact?: boolean;
  /** The app's current wave (shared selected wave), marked on its card even when no panel is open. */
  current?: number;
  /** Check-In | Start | Live | Finish on each card. */
  onAction?: (wave: number, action: WaveAction) => void;
  /** Check-In changes per wave, for the main commissaire. Empty = no warning button. */
  changeCounts?: Map<number, number>;
}

/**
 * Race-day timeline (calendar day view): waves at their scheduled start on a
 * time axis, a live "now" line, Now / Next / Active jumps. Presentation only —
 * selecting a wave just sets the shared selected wave.
 */
const WaveTimeline: React.FC<Props> = ({ schedule, states, riders, selected, onSelect, date, compact = false, current, onAction, changeCounts }) => {
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
      const starts = [...startMap.entries()].map(([label, startCats]) => ({ label, cats: startCats }));
      const item = { wave, state, start, end, cats, starts, startLabel: firstKey ? normalizeTime(firstKey) ?? firstKey : "TBD" };
      (Number.isFinite(start) ? items : unscheduled).push(item);
    });
    items.sort((a, b) => a.start - b.start);
    return { items, unscheduled };
  }, [schedule, states, now]);

  const range = useMemo(
    () => (items.length ? timelineRange(items.map((i) => i.start), items.map((i) => i.end)) : null),
    [items]
  );

  const hasActions = !!onAction && !compact;
  const axis = useMemo(
    () =>
      range &&
      buildTimelineAxis(
        items.map((it) => ({ start: it.start, height: cardHeight(it, compact, hasActions) })),
        range,
        PX_PER_MIN,
        CARD_GAP_PX
      ),
    [items, range, compact, hasActions]
  );

  // A running or finished wave also fills its time on course, up to the next wave
  const laid = useMemo(() => {
    if (!axis) return [];
    return items.map((it, i) => {
      const top = axis.tops[i];
      const content = cardHeight(it, compact, hasActions);
      const nextTop = axis.tops[i + 1] ?? axis.height;
      const duration = it.end != null ? Math.min(axis.toY(it.end), nextTop - CARD_GAP_PX) - top : 0;
      return { it, top, height: Math.max(content, duration) };
    });
  }, [items, axis, compact, hasActions]);

  // Scroll once on open: the active wave, else the next one, else now.
  // The first wave opens at the top, with the hour before it in view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);
  const activeWave = items.find((i) => i.state === "running");
  const nextWave = items.find((i) => i.state === "upcoming" && i.start >= now) ?? items.find((i) => i.state === "upcoming");
  useEffect(() => {
    if (didScroll.current || !axis) return;
    didScroll.current = true;
    const target = activeWave ?? nextWave;
    const top = target === items[0] ? 0 : axis.toY(target?.start ?? now) - 60;
    scrollRef.current?.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis]);


  if (!items.length && !unscheduled.length) {
    return <div className={styles.empty}>No waves configured</div>;
  }

  const ticks: number[] = [];
  if (range) for (let m = Math.ceil(range.from / 30) * 30; m <= range.to; m += 30) ticks.push(m);
  const showNow = range && now >= range.from && now <= range.to;

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ""}`}>
      <div className={styles.toolbar}>
        <span className={styles.dayLabel}>
          <Clock size={14} /> {hhmm(now)}
          {date && <span className={styles.date}> · {date}</span>}
        </span>
      </div>

      {range && axis && (
        <div className={styles.scroll} ref={scrollRef} data-testid="wave-timeline">
          <div className={styles.grid} style={{ height: axis.height + 28 }}>
            {ticks.map((m) => (
              <div
                key={m}
                className={`${styles.tick} ${m % 60 === 0 ? styles.tickHour : styles.tickHalf}`}
                style={{ top: axis.toY(m) }}
              >
                <span className={styles.tickLabel}>{hhmm(m)}</span>
              </div>
            ))}

            <div className={styles.lane}>
              {laid.map(({ it, top, height }) => {
                const s = waveStats(it.cats, riders);
                const isSel = it.wave === selected;
                // Check-In matters once the start is near (≤ 60 min) or due.
                const missing = s.registered - s.accounted;
                const days = daysSinceRace(date);
                const ciWarn = it.state === "upcoming" && missing > 0;
                const problem = waveProblem({
                  state: it.state,
                  start: it.start,
                  now,
                  daysSinceRace: days,
                  missing,
                  hasBibIssue: it.cats.some((c) => {
                    const issues = getCategoryBibIssues(c, riders, c.raceUuid);
                    return (c.status ?? "upcoming") === "upcoming" && issues.noBib + issues.dupBib > 0;
                  }),
                });
                const stateLabel = problem ?? STATE_LABEL[it.state];
                return (
                  <div
                    key={it.wave}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onSelect(it.wave);
                      }
                    }}
                    className={`${styles.card} ${styles[`card_${it.state}`]} ${problem ? styles.cardProblem : styles.cardOk} ${isSel ? styles.cardSel : ""}`}
                    data-problem={problem ?? undefined}
                    style={{ top, height }}
                    onClick={() => onSelect(it.wave)}
                    aria-pressed={isSel}
                    data-testid={`timeline-wave-${it.wave}`}
                    title={`Wave ${it.wave} · ${it.startLabel} · ${it.cats.map((c) => c.name).join(", ")}`}
                    data-current={it.wave === current ? "true" : undefined}
                    data-opens={it.state === "finished" ? "none" : "sheet"}
                  >
                    <span className={styles.cardTop}>
                      <span className={styles.cardName}>{compact ? `W${it.wave}` : `Wave ${it.wave}`}</span>
                      <span className={styles.cardTime}>{it.startLabel}</span>
                      <span className={styles.cardStats}>
                        {it.state === "running" ? (
                          <b>{s.onCourse}/{s.started} riding</b>
                        ) : (
                          <>{s.registered} riders</>
                        )}
                        {it.state === "upcoming" && s.registered > 0 && (
                          <span
                            className={`${styles.ciTag} ${s.accounted === s.registered ? styles.ciDone : ciWarn ? styles.ciWarn : s.accounted > 0 ? styles.ciPart : ""}`}
                            title={`Check-In ${s.accounted} / ${s.registered}`}
                            aria-label={`Check-In ${s.accounted} of ${s.registered}`}
                          >
                            {s.accounted === s.registered ? <CheckCircle2 size={12} /> : <ClipboardCheck size={12} />}
                            {s.accounted}/{s.registered}
                          </span>
                        )}
                      </span>
                      <span className={`${styles.state} ${problem ? styles.stateProblem : styles[`state_${it.state}`]}`} title={stateLabel}>
                        {problem ? <AlertTriangle size={13} /> : <StateIcon s={it.state} />} <span className={styles.stateLabel}>{stateLabel}</span>
                      </span>
                    </span>
                    {!compact && (
                      <span className={styles.starts}>
                        {it.starts.map((st, si) => (
                          <span key={st.label} className={styles.startBlock} data-testid={`timeline-start-${it.wave}-${si + 1}`}>
                            <span className={styles.startRow}>
                              <span className={styles.startName}>Start {si + 1}</span>
                              <span className={styles.startClock}>{st.label}</span>
                            </span>
                            {st.cats.map((c) => (
                              <span key={c.id} className={styles.catLine} title={c.name}>
                                <span className={styles.catDot} style={{ background: c.color ?? "#9ca3af" }} />
                                <span className={styles.catLineName} dir="auto">{c.name}{c.subCategory ? ` · ${c.subCategory}` : ""}</span>
                                <span className={styles.catLineTime}>{normalizeTime(c.startTime) ?? "TBD"}</span>
                              </span>
                            ))}
                          </span>
                        ))}
                      </span>
                    )}
                    {hasActions && onAction && (
                      <span className={styles.actions} onClick={(e) => e.stopPropagation()}>
                        {!!changeCounts?.get(it.wave) && (
                          <button type="button" className={`${styles.act} ${styles.actChanges}`} onClick={() => onAction(it.wave, "changes")} aria-label={`${changeCounts.get(it.wave)} Check-In changes, wave ${it.wave}`} title="Check-In changes" data-testid={`wave-act-changes-${it.wave}`}>
                            <AlertTriangle size={14} /> {changeCounts.get(it.wave)}
                          </button>
                        )}
                        {it.state === "finished" ? (
                          <>
                            <button type="button" className={styles.act} onClick={() => onAction(it.wave, "results")} aria-label={`Results, wave ${it.wave}`} data-testid={`wave-act-results-${it.wave}`}>
                              <Trophy size={13} /> Results
                            </button>
                            <button type="button" className={styles.act} onClick={() => onAction(it.wave, "board")} aria-label={`Board, wave ${it.wave}`} data-testid={`wave-act-board-${it.wave}`}>
                              <LayoutDashboard size={13} /> Board
                            </button>
                          </>
                        ) : (
                        <>
                        {/* Before the start: Check-In; once everyone is accounted for, Start too.
                            After the start: Live / Finish (+ Start while a later group still waits). */}
                        {it.state === "upcoming" && (
                          <button type="button" className={`${styles.act} ${missing > 0 ? styles.actTodo : styles.actDone}`} onClick={() => onAction(it.wave, "checkin")} aria-label={`Check-In, wave ${it.wave}`} data-testid={`wave-act-checkin-${it.wave}`}>
                            <ClipboardCheck size={13} /> Check-In
                          </button>
                        )}
                        {it.cats.some((c) => c.status === "upcoming") && (it.state === "running" || (s.registered > 0 && missing === 0)) && (
                          <button type="button" className={styles.act} onClick={() => onAction(it.wave, "start")} aria-label={`Start, wave ${it.wave}`} data-testid={`wave-act-start-${it.wave}`}>
                            <Flag size={13} /> Start
                          </button>
                        )}
                        {it.state === "running" && (
                          <>
                            <button type="button" className={`${styles.act} ${styles.actLive}`} onClick={() => onAction(it.wave, "live")} aria-label={`Live, wave ${it.wave}`} data-testid={`wave-act-live-${it.wave}`}>
                              <Radio size={13} /> Live
                            </button>
                            <button type="button" className={styles.act} onClick={() => onAction(it.wave, "finish")} aria-label={`Finish, wave ${it.wave}`} data-testid={`wave-act-finish-${it.wave}`}>
                              <FlagTriangleRight size={13} /> Finish
                            </button>
                          </>
                        )}
                        </>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {showNow && (
              <div className={styles.now} style={{ top: axis.toY(now) }} aria-label={`Now ${hhmm(now)}`}>
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
  /** Panel header mode: one line + short stats (no big number), with a close button. */
  compact?: boolean;
  onClose?: () => void;
}> = ({ wave, state, startLabel, cats, riders, compact = false, onClose }) => {
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
        {onClose && (
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close wave panel" title="Back to the full timeline">
            <X size={18} />
          </button>
        )}
      </div>

      {!compact && <div className={styles.bigStat}>
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
      </div>}

      <div className={styles.statRow}>
        {compact && live && <span className={styles.onCourse}><b>{s.onCourse}</b>/{s.registered} on course</span>}
        <span><b>{s.registered}</b> registered</span>
        <span><b>{live ? s.started : "—"}</b> started</span>
        <span><b>{live ? s.finished : "—"}</b> finished</span>
        <span><b>{s.dnf}</b> DNF</span>
        <span><b>{s.dns}</b> DNS</span>
        {s.dsq > 0 && <span><b>{s.dsq}</b> DSQ</span>}
      </div>

      <button type="button" className={`${styles.catToggle} ${compact ? styles.catToggleCompact : ""}`} onClick={() => setCatsOpen((o) => !o)} aria-expanded={catsOpen}>
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
      ) : compact ? null : (
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
