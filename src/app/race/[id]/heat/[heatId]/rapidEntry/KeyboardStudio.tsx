/**
 * Settings → Keyboard: try the 10 keypad layouts on the REAL Live keypad (RapidEntry), full
 * screen, at the size it has during a race on this device (the keypad is anchored to the
 * bottom of the screen exactly as on Live), then "Use This Keyboard".
 *
 * Isolation: the preview RapidEntry gets a fake recorder kept in this component's state, no
 * history key (nothing stored) and riders that exist only here. RapidEntry itself never talks
 * to the server, so nothing typed here can record a lap or reach a race. While it is open the
 * real Live keypad (if mounted underneath) ignores the physical keyboard (`previewOpen`).
 * Swiping only previews; only "Use This Keyboard" saves (localStorage, this device).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { RiderProps } from "@/types/types";
import type { LapOutcome } from "../useLapRecording";
import RapidEntry from "./RapidEntry";
import { KEYPAD_LAYOUTS, useKeypadLayoutStore } from "./keypadLayouts";
import styles from "./rapidEntry.module.css";

/** Practice riders: bibs 1–299, only in this preview. */
const PRACTICE_RIDERS = Array.from({ length: 299 }, (_, i) => ({
  id: -(i + 1),
  bibNumber: i + 1,
  firstName: "Practice",
  lastName: `Rider ${i + 1}`,
  category: "Practice",
  status: "standing",
  raceStatus: "running",
  totalLaps: 0,
  lapsCounter: 0,
})) as unknown as RiderProps[];

export default function KeyboardStudio({ onClose }: { onClose: () => void }) {
  const savedId = useKeypadLayoutStore((s) => s.layoutId);
  const setLayoutId = useKeypadLayoutStore((s) => s.setLayoutId);
  const setPreviewOpen = useKeypadLayoutStore((s) => s.setPreviewOpen);
  const [index, setIndex] = useState(() => Math.max(0, KEYPAD_LAYOUTS.findIndex((l) => l.id === savedId)));
  const layout = KEYPAD_LAYOUTS[index];

  useEffect(() => {
    setPreviewOpen(true);
    return () => setPreviewOpen(false);
  }, [setPreviewOpen]);

  // Fake, local-only recorder: laps per practice rider and the "action ids" Undo may target.
  const laps = useRef(new Map<number, number>());
  const [ids, setIds] = useState<Set<string>>(new Set());
  const record = useCallback((rider: RiderProps): LapOutcome => {
    const lap = (laps.current.get(rider.id) ?? 0) + 1;
    laps.current.set(rider.id, lap);
    const actionId = `preview-${rider.id}-${lap}`;
    setIds((s) => new Set(s).add(actionId));
    return { ok: true, actionId, lap, finished: false };
  }, []);
  const undo = useCallback((actionId: string) => {
    const m = /^preview-(-?\d+)-(\d+)$/.exec(actionId);
    if (m) laps.current.set(Number(m[1]), Math.max(0, Number(m[2]) - 1));
    setIds((s) => {
      const n = new Set(s);
      n.delete(actionId);
      return n;
    });
    return true;
  }, []);
  const lapsNow = useCallback((id: number) => laps.current.get(id) ?? 0, []);

  const go = (d: -1 | 1) => setIndex((i) => Math.min(KEYPAD_LAYOUTS.length - 1, Math.max(0, i + d)));

  // Swipe between layouts; never from the keypad itself (it is data-no-swipe).
  const start = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation(); // never reaches the Live page underneath (its Cards/Keypad swipe)
    const el = e.target as HTMLElement;
    start.current = el.closest("[data-no-swipe], button, input") ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const riders = useMemo(() => PRACTICE_RIDERS, []);
  const inUse = layout.id === savedId;

  return createPortal(
    <div
      className={styles.studio}
      data-entry-mode="keypad"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard layouts"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClick={stop}
      onPointerDown={stop}
      data-testid="keyboard-studio"
    >
      <div className={styles.studioBar}>
        <button type="button" className={styles.studioClose} onClick={onClose} aria-label="Close" data-testid="keyboard-close">
          <X size={20} aria-hidden="true" />
        </button>
        <button type="button" className={styles.studioNav} onClick={() => go(-1)} disabled={index === 0} aria-label="Previous layout" data-testid="keyboard-prev">
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <div className={styles.studioTitle}>
          <span className={styles.studioName} data-testid="keyboard-name">{layout.name}</span>
          <span className={styles.studioPos} data-testid="keyboard-pos">{index + 1}/{KEYPAD_LAYOUTS.length}</span>
        </div>
        <button type="button" className={styles.studioNav} onClick={() => go(1)} disabled={index === KEYPAD_LAYOUTS.length - 1} aria-label="Next layout" data-testid="keyboard-next">
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className={styles.studioUse} onClick={() => setLayoutId(layout.id)} disabled={inUse} data-testid="keyboard-use">
        {inUse ? "✓ In use" : "Use This Keyboard"}
      </button>
      <p className={styles.studioNote}>Practice only — type any bib 1–299. Nothing is recorded.</p>
      <RapidEntry
        key={layout.id}
        preview
        layoutId={layout.id}
        persistKey={null}
        active
        waveRiders={riders}
        startedRiders={riders}
        raceRiders={riders}
        waveOfRider={() => null}
        getCatColor={() => "#2563eb"}
        record={(rider) => record(rider)}
        actionIds={ids}
        lapsNow={lapsNow}
        undo={undo}
      />
    </div>,
    document.body,
  );
}
