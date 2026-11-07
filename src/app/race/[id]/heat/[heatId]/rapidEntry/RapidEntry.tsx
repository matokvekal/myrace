/**
 * Rapid Entry — paper-like lap entry: type bibs on a keypad, one after another.
 *
 * Records through the SAME `recordLap` as a card tap (board hold, action log,
 * offline outbox, first write wins on the server). Nothing here talks to the server.
 *
 *  - complete bib (no longer bib starts with it) → recorded at once, input cleared
 *  - ambiguous (1 while 18/182 exist)             → waits; Enter confirms
 *  - prefix (34 while only 341 exists)            → waits for the next digit
 *  - no bib can match                             → logged red after INVALID_CLEAR_MS
 * Lap time = the FIRST keypress of that bib; acceptance time is kept for diagnostics.
 * History is per wave on this device; undo goes through the existing action-log undo.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { RiderProps } from "@/types/types";
import type { LapOutcome } from "../useLapRecording";
import { bibKey, buildBibIndex } from "./bibIndex";
import {
  AMBIGUOUS_ACCEPT_MS,
  HISTORY_LIMIT,
  INVALID_CLEAR_MS,
  RESULT_FLASH_MS,
  UNDO_ARM_MS,
} from "./rapidEntryConfig";
import styles from "./rapidEntry.module.css";

export type EntryStatus = "recorded" | "invalid" | "tooSoon" | "blocked" | "undone";

export interface RapidEntryRecord {
  id: string;
  bib: string;
  /** First keypress of this bib (= the lap time when recorded). */
  typedAt: number;
  /** When it was accepted (Enter / auto) — diagnostics. */
  acceptedAt: number;
  status: EntryStatus;
  /** Short reason shown for anything not recorded. */
  note?: string;
  riderId?: number;
  name?: string;
  color?: string;
  lap?: number;
  /** Laps still to ride after this one (when the category's lap count is known). */
  left?: number;
  finished?: boolean;
  /** Action-log id (undo target). */
  actionId?: string;
}

interface Props {
  persistKey: string | null;
  /** Listen to the physical keyboard (keypad mode, no dialog open). */
  active: boolean;
  /** Every rider in this wave's categories, whatever their state — the bibs the keypad knows. */
  waveRiders: RiderProps[];
  /** Riders shown on Live (started categories, laps resolved) — the ones a lap can go to. */
  startedRiders: RiderProps[];
  /** The whole race, to name the wave of a bib typed in the wrong wave. */
  raceRiders: RiderProps[];
  waveOfRider: (r: RiderProps) => string | null;
  getCatColor: (r: RiderProps) => string;
  record: (rider: RiderProps, at: Date, acceptedAt: number) => LapOutcome;
  /** Action-log ids still present (an entry whose id is gone was undone elsewhere). */
  actionIds: Set<string>;
  /** The rider's current lap count in the store (undo only the latest lap). */
  lapsNow: (riderId: number) => number | null;
  undo: (actionId: string) => boolean;
}

const storageKey = (k: string) => `commissaire.rapidEntry.${k}`;

function loadHistory(key: string | null): RapidEntryRecord[] {
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(key)) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const OUT_STATUSES = new Set(["DNF", "DSQ", "DNS"]);
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const vibrate = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* unsupported */
  }
};

export default function RapidEntry(props: Props) {
  const { t } = useTranslation();
  const { persistKey, active, waveRiders, startedRiders, raceRiders, waveOfRider, getCatColor, record, actionIds, lapsNow, undo } = props;

  // ── history, per wave (key change → that wave's own list; never written under the wrong key)
  const [hist, setHist] = useState(() => ({ key: persistKey, entries: loadHistory(persistKey) }));
  const entries = hist.key === persistKey ? hist.entries : loadHistory(persistKey);
  if (hist.key !== persistKey) setHist({ key: persistKey, entries });
  useEffect(() => {
    if (!hist.key) return;
    try {
      localStorage.setItem(storageKey(hist.key), JSON.stringify(hist.entries));
    } catch {
      /* storage full / private mode */
    }
  }, [hist]);
  const addEntry = useCallback(
    (e: RapidEntryRecord) =>
      setHist((h) => ({ key: h.key, entries: [e, ...h.entries].slice(0, HISTORY_LIMIT) })),
    [],
  );
  const patchEntry = (id: string, patch: Partial<RapidEntryRecord>) =>
    setHist((h) => ({ key: h.key, entries: h.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const removeEntry = (id: string) => setHist((h) => ({ key: h.key, entries: h.entries.filter((e) => e.id !== id) }));
  /** Move an entry up/down in THIS LIST only — never changes a lap time or the official order. */
  const moveEntry = (id: string, dir: -1 | 1) =>
    setHist((h) => {
      const i = h.entries.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= h.entries.length) return h;
      const next = [...h.entries];
      [next[i], next[j]] = [next[j], next[i]];
      return { key: h.key, entries: next };
    });

  // ── lookups
  const index = useMemo(() => buildBibIndex(waveRiders.map((r) => r.bibNumber)), [waveRiders]);
  const byBib = (list: RiderProps[]) => {
    const m = new Map<string, RiderProps[]>();
    for (const r of list) {
      const k = bibKey(r.bibNumber);
      if (k) m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  };
  const waveByBib = useMemo(() => byBib(waveRiders), [waveRiders]);
  const startedByBib = useMemo(() => byBib(startedRiders), [startedRiders]);
  const raceByBib = useMemo(() => byBib(raceRiders), [raceRiders]);

  // ── input: a ref for fast taps between renders, state to render it
  const cur = useRef<{ text: string; typedAt: number | null }>({ text: "", typedAt: null });
  const [input, setInputState] = useState("");
  const setInput = (text: string, typedAt: number | null) => {
    cur.current = { text, typedAt };
    setInputState(text);
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
  // A wave switch starts with an empty input.
  useEffect(() => {
    clearTimer();
    setInput("", null);
  }, [persistKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [flash, setFlash] = useState<RapidEntryRecord | null>(null);
  useEffect(() => {
    if (!flash) return;
    const h = setTimeout(() => setFlash(null), RESULT_FLASH_MS);
    return () => clearTimeout(h);
  }, [flash]);

  const nameOf = (r: RiderProps) => `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
  const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const log = (e: RapidEntryRecord) => {
    addEntry(e);
    setFlash(e);
    vibrate(e.status === "recorded" ? 12 : [40, 50, 40]);
  };

  const commitInvalid = (text: string, typedAt: number) => {
    const other = raceByBib.get(text)?.[0];
    const wave = other ? waveOfRider(other) : null;
    const note = other
      ? wave
        ? t("rapid.otherWave", "Wave {{wave}}", { wave })
        : t("rapid.notInWave", "Other wave")
      : t("rapid.unknown", "Unknown");
    log({ id: newId(), bib: text, typedAt, acceptedAt: Date.now(), status: "invalid", note });
  };

  const accept = (bib: string, typedAt: number) => {
    const acceptedAt = Date.now();
    const base = { id: newId(), bib, typedAt, acceptedAt };
    const inWave = waveByBib.get(bib) ?? [];
    if (inWave.length > 1) {
      log({ ...base, status: "blocked", note: t("rapid.bibTwice", "Double bib") });
      return;
    }
    const rider = startedByBib.get(bib)?.[0] ?? inWave[0];
    if (!rider) {
      commitInvalid(bib, typedAt);
      return;
    }
    const who = { riderId: rider.id, name: nameOf(rider), color: getCatColor(rider) };
    if (OUT_STATUSES.has(rider.status)) {
      log({ ...base, ...who, status: "blocked", note: rider.status });
      return;
    }
    if (!startedByBib.has(bib)) {
      log({ ...base, ...who, status: "blocked", note: t("rapid.notStarted", "No start") });
      return;
    }
    const out = record(rider, new Date(typedAt), acceptedAt);
    if (out.ok) {
      const left = rider.totalLaps > 0 ? Math.max(0, rider.totalLaps - out.lap) : undefined;
      log({ ...base, ...who, status: "recorded", lap: out.lap, left, finished: out.finished, actionId: out.actionId });
      return;
    }
    const notes: Record<string, string> = {
      finished: t("rapid.finished", "Finish"),
      doubleTap: t("rapid.duplicate", "Double"),
      noPermission: t("rapid.noPermission", "No access"),
      refused: t("rapid.refused", "No access"),
      ignoredWave: t("rapid.ignoredWave", "Ignored"),
    };
    if (out.reason === "tooSoon") {
      log({ ...base, ...who, status: "tooSoon", note: t("rapid.tooSoon", "Wait {{s}}s", { s: out.waitSeconds ?? 0 }) });
    } else {
      log({ ...base, ...who, status: "blocked", note: notes[out.reason] ?? out.reason });
    }
  };

  /** Run after the browser paints the cleared input (entries keep their order: FIFO). */
  const later = (fn: () => void) => setTimeout(fn, 0);

  /** After a digit: accept, wait, or schedule the invalid-clear. */
  const evaluate = (text: string, typedAt: number, auto: boolean) => {
    clearTimer();
    const m = index.classify(text);
    if (m === "complete" && auto) {
      setInput("", null);
      later(() => accept(text, typedAt));
    } else if (m === "ambiguous" && auto && AMBIGUOUS_ACCEPT_MS != null) {
      timer.current = setTimeout(() => {
        if (cur.current.text !== text) return;
        setInput("", null);
        accept(text, typedAt);
      }, AMBIGUOUS_ACCEPT_MS);
    } else if (m === "none") {
      timer.current = setTimeout(() => {
        if (cur.current.text !== text) return;
        setInput("", null);
        commitInvalid(text, typedAt);
      }, INVALID_CLEAR_MS);
    }
  };

  const pressDigit = (d: string) => {
    let { text, typedAt } = cur.current;
    // Digits typed before the invalid-clear pause belong to the same (invalid) number;
    // each restarts the pause. It is logged whole, never split into pieces.
    if (!text) typedAt = Date.now();
    text += d;
    setInput(text, typedAt);
    evaluate(text, typedAt!, true);
  };

  const pressBack = () => {
    clearTimer();
    const { text, typedAt } = cur.current;
    const next = text.slice(0, -1);
    setInput(next, next ? typedAt : null);
    if (next && typedAt != null) evaluate(next, typedAt, false);
  };

  const pressEnter = () => {
    const { text, typedAt } = cur.current;
    if (!text || typedAt == null) return; // Enter on nothing never records anything
    clearTimer();
    setInput("", null);
    const m = index.classify(text);
    if (m === "complete" || m === "ambiguous") later(() => accept(text, typedAt));
    else commitInvalid(text, typedAt);
  };

  const pressClear = () => {
    clearTimer();
    setInput("", null);
  };

  // ── physical keyboard (desktop)
  const handlers = useRef({ pressDigit, pressBack, pressEnter, pressClear });
  handlers.current = { pressDigit, pressBack, pressEnter, pressClear };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      const h = handlers.current;
      if (/^[0-9]$/.test(e.key)) {
        if (e.repeat) return;
        e.preventDefault();
        h.pressDigit(e.key);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) h.pressEnter();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        h.pressBack();
      } else if (e.key === "Escape") {
        h.pressClear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // ── fill the screen below the header, no page scroll
  const rootRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      if (!el) return;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setHeight(Math.max(360, Math.floor(vh - el.getBoundingClientRect().top - 8)));
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  // ── undo (two taps)
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const h = setTimeout(() => setArmed(null), UNDO_ARM_MS);
    return () => clearTimeout(h);
  }, [armed]);

  const statusOf = (e: RapidEntryRecord): EntryStatus =>
    e.status === "recorded" && e.actionId && !actionIds.has(e.actionId) ? "undone" : e.status;

  const undoBlockedReason = (e: RapidEntryRecord): string | null => {
    if (statusOf(e) !== "recorded") return null;
    const laps = e.riderId != null ? lapsNow(e.riderId) : null;
    return laps != null && e.lap != null && laps !== e.lap ? t("rapid.laterLap", "A later lap exists — undo that first") : null;
  };

  const onRowX = (e: RapidEntryRecord) => {
    if (armed !== e.id) {
      setArmed(e.id);
      return;
    }
    setArmed(null);
    if (statusOf(e) === "recorded") {
      if (e.actionId && undo(e.actionId)) patchEntry(e.id, { status: "undone" });
    } else {
      removeEntry(e.id);
    }
  };

  // ── what the display says about the current input
  const match = input ? index.classify(input) : null;
  const exact = input ? (startedByBib.get(input)?.[0] ?? waveByBib.get(input)?.[0]) : undefined;
  // Only an ambiguous number needs a word: Enter.
  const hint = match === "ambiguous" ? `↵ ${input}${exact ? ` · ${nameOf(exact)}` : ""}` : null;

  const statusLabel = (e: RapidEntryRecord): string => {
    switch (statusOf(e)) {
      case "recorded":
        return e.finished
          ? t("rapid.finish", "Finish")
          : e.left != null
            ? t("rapid.left", "{{n}} left", { n: e.left })
            : t("rapid.lap", "Lap {{n}}", { n: e.lap });
      case "undone":
        return t("rapid.undone", "Undone");
      default:
        return e.note ?? "";
    }
  };

  const key = (label: React.ReactNode, onPress: () => void, extra?: { className?: string; aria?: string; testId?: string }) => (
    <button
      type="button"
      className={`${styles.key} ${extra?.className ?? ""}`}
      aria-label={extra?.aria}
      data-testid={extra?.testId}
      // pointerdown: no 300 ms click delay, no focus steal; keyboard activation still works via onClick.
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      onClick={(e) => {
        if (e.detail === 0) onPress();
      }}
    >
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className={styles.root} style={height ? { height } : undefined} data-testid="rapid-entry">
      <div className={styles.history} aria-label={t("rapid.history", "Entries")} data-testid="rapid-history">
        {entries.map((e, i) => {
            const st = statusOf(e);
            const blocked = undoBlockedReason(e);
            return (
              <div key={e.id} className={styles.row} data-status={st} data-testid="rapid-row">
                {/* Order arrows: this list only — lap times and official order never change here. */}
                <span className={styles.rowMove}>
                  <button type="button" className={styles.moveBtn} disabled={i === 0} onClick={() => moveEntry(e.id, -1)} aria-label={t("rapid.moveUp", "Move up")} data-testid="rapid-row-up">
                    <ChevronUp size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className={styles.moveBtn} disabled={i === entries.length - 1} onClick={() => moveEntry(e.id, 1)} aria-label={t("rapid.moveDown", "Move down")} data-testid="rapid-row-down">
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </span>
                <span className={styles.rowColor} style={e.color ? { background: e.color } : undefined} />
                <span className={styles.rowBib}>{e.bib}</span>
                <span className={styles.rowName} dir="auto">{e.name ?? ""}</span>
                <span className={styles.rowStatus} dir="auto">{statusLabel(e)}</span>
                <span className={styles.rowTime} title={`${t("rapid.accepted", "accepted")} ${clock(e.acceptedAt)}`}>{clock(e.typedAt)}</span>
                {st === "undone" ? (
                  <span className={styles.rowX} />
                ) : (
                  <button
                    type="button"
                    className={`${styles.rowX} ${armed === e.id ? styles.rowXArmed : ""}`}
                    disabled={!!blocked}
                    title={blocked ?? (st === "recorded" ? t("rapid.undoLap", "Undo this lap") : t("rapid.remove", "Remove from list"))}
                    aria-label={st === "recorded" ? t("rapid.undoLap", "Undo this lap") : t("rapid.remove", "Remove from list")}
                    onClick={() => onRowX(e)}
                    data-testid="rapid-row-x"
                  >
                    {armed === e.id ? (st === "recorded" ? t("rapid.undoQ", "Undo?") : t("rapid.removeQ", "Remove?")) : <X size={18} aria-hidden="true" />}
                  </button>
                )}
              </div>
            );
          })}
      </div>

      <div className={styles.entry} data-no-swipe>
        <div className={styles.display} data-match={match ?? (flash ? flash.status : "idle")} data-testid="rapid-display" aria-live="polite">
          {input ? (
            <span className={styles.digits}>{input}</span>
          ) : flash ? (
            <span className={styles.flash} data-status={flash.status}>
              <span className={styles.flashBib}>{flash.bib}</span>
              <span className={styles.flashText} dir="auto">
                {flash.status === "recorded" ? "✓" : "✕"} {statusLabel(flash)}
              </span>
            </span>
          ) : (
            <span className={styles.placeholder}>&nbsp;</span>
          )}
          {hint && <span className={styles.hint} dir="auto">{hint}</span>}
        </div>

        <div className={styles.pad}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <span key={d} className={styles.cell}>{key(d, () => pressDigit(d), { testId: `rapid-key-${d}` })}</span>
          ))}
          <span className={styles.zeroCell}>{key("0", () => pressDigit("0"), { testId: "rapid-key-0" })}</span>
          <span className={styles.enterCell}>
            {key(<span className={styles.enterArrow} aria-hidden="true">↵</span>, pressEnter, { className: styles.enter, aria: t("rapid.enter", "Enter"), testId: "rapid-key-enter" })}
          </span>
        </div>
      </div>
    </div>
  );
}
