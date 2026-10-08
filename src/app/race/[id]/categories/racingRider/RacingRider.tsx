import React, { useRef, useState, useEffect, useMemo } from "react";
import styles from "./racingRider.module.css";
import { RiderProps } from "@/types/types";
import { formatTime, parseClockTimeMs } from "@/utils/timeUtils";
import { useSkin } from "@/hooks/useSkin";
import { Bell } from "lucide-react";

interface Props {
  rider: RiderProps;
  color: string;
  forceBell?: boolean;
  isFlashing?: boolean;
  /**
   * Lap recorded, but the board hold is keeping the card in place until the
   * arrivals stop. Without a marker the commissaire can't tell a tapped card
   * from an untapped one — the drop to the bottom used to be the confirmation.
   */
  isRecorded?: boolean;
  raceEnded?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

type Pt = { x: number; y: number };

// Geometry of the perimeter of a rounded rect (w x h, corner radius r),
// starting at top-center ("the start line") and walking clockwise. Used to
// trace the pace ring directly on the card's actual edge. The card's height
// is only a *minimum* (racingRider.module.css `.rider` uses min-height, not
// height) and its border-radius differs by skin (16px classic, 12px gaming —
// the ring only ever renders in gaming), so the geometry is computed from
// the card's real measured size, not assumed constants.
function roundedRectGeometry(w: number, h: number, r: number) {
  const straightX = w / 2 - r;
  const straightY = h - 2 * r;
  const straightBottom = w - 2 * r;
  const arc = (Math.PI / 2) * r;
  const segs = [straightX, arc, straightY, arc, straightBottom, arc, straightY, arc, straightX];
  const total = segs.reduce((a, b) => a + b, 0);

  const pointAt = (t: number): Pt => {
    let d = ((t % total) + total) % total;
    if (d <= segs[0]) return { x: w / 2 + d, y: 0 };
    d -= segs[0];
    if (d <= segs[1]) {
      const a = -Math.PI / 2 + (d / segs[1]) * (Math.PI / 2);
      return { x: w - r + r * Math.cos(a), y: r + r * Math.sin(a) };
    }
    d -= segs[1];
    if (d <= segs[2]) return { x: w, y: r + d };
    d -= segs[2];
    if (d <= segs[3]) {
      const a = (d / segs[3]) * (Math.PI / 2);
      return { x: w - r + r * Math.cos(a), y: h - r + r * Math.sin(a) };
    }
    d -= segs[3];
    if (d <= segs[4]) return { x: w - r - d, y: h };
    d -= segs[4];
    if (d <= segs[5]) {
      const a = Math.PI / 2 + (d / segs[5]) * (Math.PI / 2);
      return { x: r + r * Math.cos(a), y: h - r + r * Math.sin(a) };
    }
    d -= segs[5];
    if (d <= segs[6]) return { x: 0, y: h - r - d };
    d -= segs[6];
    if (d <= segs[7]) {
      const a = Math.PI + (d / segs[7]) * (Math.PI / 2);
      return { x: r + r * Math.cos(a), y: r + r * Math.sin(a) };
    }
    d -= segs[7];
    return { x: r + d, y: 0 };
  };

  return { total, pointAt };
}

// SVG path for the same rounded-rect perimeter, starting at top-center and
// going clockwise (sweep-flag 1) — must match roundedRectGeometry's pointAt(0)
// and direction of travel exactly, since the tip marker's rotation is derived
// from that geometry and is overlaid on this path.
function roundedRectPathD(w: number, h: number, r: number): string {
  return [
    `M ${w / 2} 0`,
    `L ${w - r} 0`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `L ${w} ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `L ${r} ${h}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    `Z`,
  ].join(" ");
}

// No inset — the ring traces the card's actual outer edge (cardSize comes
// from offsetWidth/offsetHeight, which already includes the border), so it
// reads as the card's own border lighting up rather than a frame drawn
// inside it. Gaming-skin card radius is 12px; match it exactly.
const PACE_RING_CARD_RADIUS = 12;
const PACE_RING_INSET = 0;

const RacingRider: React.FC<Props> = ({ rider, color, forceBell = false, isFlashing = false, isRecorded = false, raceEnded = false, onClick, onDoubleClick }) => {
  const clickCountRef = useRef<number>(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { skin } = useSkin();
  const isPro = skin === "gaming";

  // Measure the card's real rendered box (not the min-height default) so the
  // pace ring traces its actual edge instead of drifting off it when content
  // pushes the card taller. Only observed in the gaming skin, where the ring
  // can render at all.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState<{ w: number; h: number }>({ w: 76, h: 84 });
  useEffect(() => {
    if (!isPro || !cardRef.current) return;
    const el = cardRef.current;
    const ro = new ResizeObserver(() => {
      setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isPro]);

  const paceRingW = Math.max(cardSize.w - PACE_RING_INSET * 2, PACE_RING_CARD_RADIUS * 2 + 1);
  const paceRingH = Math.max(cardSize.h - PACE_RING_INSET * 2, PACE_RING_CARD_RADIUS * 2 + 1);
  const paceRingR = PACE_RING_CARD_RADIUS - PACE_RING_INSET;
  const paceRingGeometry = useMemo(
    () => roundedRectGeometry(paceRingW, paceRingH, paceRingR),
    [paceRingW, paceRingH, paceRingR]
  );
  const paceRingPathD = useMemo(
    () => roundedRectPathD(paceRingW, paceRingH, paceRingR),
    [paceRingW, paceRingH, paceRingR]
  );

  const lapsRemaining = rider.totalLaps - rider.lapsCounter;
  const showBell = forceBell || (lapsRemaining === 2);
  const showStripes = forceBell || (lapsRemaining === 1);

  // Live ticking clock: how long since this rider last crossed (or since race start if never).
  // Only ticks once the race has actually started — before that the card shows a frozen 00:00.
  const hasStarted = rider.raceStatus === "running" || rider.raceStatus === "finished";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasStarted) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasStarted]);
  const sinceArriveBaseline = parseClockTimeMs(rider.timeArrive) ?? parseClockTimeMs(rider.timeStartRace);
  const sinceArriveMs = hasStarted && sinceArriveBaseline != null ? now - sinceArriveBaseline : null;
  const sinceArrive = sinceArriveMs != null ? formatTime(sinceArriveMs / 1000) : null;

  // Last completed lap's time — read straight from lapsDetails (the authoritative,
  // per-lap history) rather than the separately-tracked elapsedLastLap field, which
  // can end up stale/blank depending on which code path last touched the rider.
  const lastLap = rider.lapsDetails && rider.lapsDetails.length > 0
    ? rider.lapsDetails[rider.lapsDetails.length - 1]
    : null;
  const lastLapTime = lastLap?.lapTime ?? rider.elapsedLastLap ?? null;

  // PRO-only pace border: how far into an "expected" lap (paced off the rider's own
  // last lap) they are right now, traced clockwise around the card's edge starting
  // top-center. Sampled on its own 10s tick — deliberately chunkier than the 1s
  // "since arrival" tick above, which keeps driving the text row untouched.
  const [paceNow, setPaceNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isPro || !hasStarted) return;
    const t = setInterval(() => setPaceNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, [isPro, hasStarted]);

  const lastLapMs = lastLap ? new Date(lastLap.endTime).getTime() - new Date(lastLap.startTime).getTime() : null;
  const paceSinceArriveMs = hasStarted && sinceArriveBaseline != null ? paceNow - sinceArriveBaseline : null;
  const paceProgress = isPro && hasStarted && lastLapMs && lastLapMs > 0 && paceSinceArriveMs != null
    ? paceSinceArriveMs / lastLapMs
    : null;
  const paceOverdue = paceProgress != null && paceProgress >= 1;

  // Length along the ring that's "elapsed" — clamped to a full lap. Overdue
  // clamps to exactly `total`, which (via pointAt's modulo) lands the tip
  // marker back at t=0 — the top-center start line — so the same marker that
  // tracks the rider mid-lap doubles as the "still waiting" cue once they're
  // late, with no separate position to compute.
  const { total: paceRingTotal, pointAt: paceRingPointAt } = paceRingGeometry;
  const paceElapsedLen = paceProgress != null ? Math.min(paceProgress, 1) * paceRingTotal : null;

  // Direction-of-travel marker: a small triangle-in-circle at the tip of the
  // elapsed line, rotated to point the way the ring is being traced (always
  // clockwise) so the commissaire can read direction at a glance, not just
  // position. Angle comes from sampling the path just behind the tip — the
  // ring is always walked in the +t direction, so (tip - justBehind) is the
  // local tangent.
  const paceTip = paceElapsedLen != null ? paceRingPointAt(paceElapsedLen) : null;
  const paceTipAngleDeg = useMemo(() => {
    if (paceElapsedLen == null) return 0;
    const eps = 0.75;
    const a = paceRingPointAt(paceElapsedLen - eps);
    const b = paceRingPointAt(paceElapsedLen + eps);
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  }, [paceElapsedLen, paceRingPointAt]);

  const bgStyle = color;

  // Single source of truth for tap disambiguation: the browser always eventually fires
  // a 'click' event, for touch and mouse alike (the viewport meta tag already kills the
  // old 300ms mobile click delay). A separate touchend-based detector used to run in
  // parallel with this one — two independent state machines reacting to the same taps —
  // which could desync and swallow a double-tap on active (still-racing) riders.
  const handleClick = (e: React.MouseEvent) => {
    clickCountRef.current++;

    if (clickCountRef.current === 1) {
      // Wait to see if a second click comes within 300ms
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = setTimeout(() => {
        if (clickCountRef.current === 1) {
          onClick(); // Single click
          setNow(Date.now()); // snap the "since arrive" clock to 0 right away, don't wait for the next tick
        }
        clickCountRef.current = 0;
      }, 300);
    } else if (clickCountRef.current === 2) {
      // Double click detected
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      onDoubleClick();
      clickCountRef.current = 0;
    }
  };

  const glowClass = isFlashing ? styles.flash : "";

  // Podium medal: tint the category-position badge gold / silver / bronze so the
  // commissaire can pick out the top 3 of EVERY category at a glance across a
  // wall of cards. Gentle by design — no new element, just the number you
  // already show, coloured. Gold pops (the real leader); silver/bronze stay calm.
  const catPos = rider.position_category;
  const medalClass =
    catPos === 1 ? styles.posGold :
    catPos === 2 ? styles.posSilver :
    catPos === 3 ? styles.posBronze : "";

  return (
    <div
      ref={cardRef}
      data-testid={`racing-rider-${rider.bibNumber}`}
      data-laps={`${rider.lapsCounter}/${rider.totalLaps}`}
      data-recorded={isRecorded ? "true" : undefined}
      className={`${styles.rider} ${glowClass} ${isRecorded ? styles.recorded : ""} ${raceEnded ? styles.onTrack : ""}`}
      style={{ background: bgStyle, "--glow-color": color } as React.CSSProperties}
      onClick={handleClick}
      onDoubleClick={(e) => { e.preventDefault(); }}
    >
      {isRecorded && (
        <div className={styles.recordedTick} title="Lap recorded — card moves down when the arrivals stop">
          ✓
        </div>
      )}
      {paceElapsedLen != null && (
        <svg
          className={styles.paceRing}
          aria-hidden="true"
          width={cardSize.w}
          height={cardSize.h}
          overflow="visible"
        >
          <g transform={`translate(${PACE_RING_INSET},${PACE_RING_INSET})`}>
            {/*
              Rider is overdue at the line once a full expected lap has elapsed
              since their last crossing. Keep the WHOLE ring solid (rather than
              collapsing to nothing) so the pace trail doesn't vanish — only
              the tip marker (which lands back at the top-center start line
              when overdue, see paceElapsedLen) switches to amber and blinks,
              a calm "still waiting for this rider" cue (user req).
            */}
            <path
              d={paceRingPathD}
              className={styles.paceRingPath}
              strokeDasharray={paceOverdue ? undefined : `${paceElapsedLen} ${Math.max(paceRingTotal - paceElapsedLen, 0)}`}
            />
            {paceTip && (
              <g
                transform={`translate(${paceTip.x},${paceTip.y}) rotate(${paceTipAngleDeg})`}
                className={paceOverdue ? styles.paceMarkerWaiting : styles.paceMarkerCurrent}
              >
                {/* Triangle points along +x by default — matches the ring's
                    own direction of travel at t=0, so the rotation above is
                    the only thing that ever needs to point it correctly. */}
                <circle r="5.5" className={styles.paceMarkerCircle} />
                <polygon points="-2,-2.6 -2,2.6 2.8,0" className={styles.paceMarkerTriangle} />
              </g>
            )}
          </g>
        </svg>
      )}
      {raceEnded && (
        <div className={styles.onTrackRibbon} title="Race ended — this rider is still on the track">
          ⚑ ON TRACK
        </div>
      )}
      {showBell && (
        <div className={styles.bellBadge} title={`2 laps left! (${rider.lapsCounter}/${rider.totalLaps})`}>
          <Bell size={16} color="#ffd60a" fill="#ffd60a" />
        </div>
      )}
      {showStripes && (
        <div className={styles.flagBadge} title={`Last lap! (${rider.lapsCounter}/${rider.totalLaps})`}>
          <div className={styles.flagCloth} />
          <div className={styles.flagPole} />
        </div>
      )}
      <div className={styles.bib}>{rider.bibNumber}</div>
      <div className={styles.laps}>
        <span className={styles.lapsLabel}>finish:</span>
        {rider.lapsCounter}/{rider.totalLaps}
      </div>
      {rider.totalLaps > 0 && (
        <div className={styles.remaining}>
          {lapsRemaining === 1 ? 'Last' : `${Math.max(0, lapsRemaining)} left`}
        </div>
      )}
      {!hasStarted ? (
        <div className={styles.lapTime}>
          <span className={styles.lapTimeCell}>00:00</span>
          <span className={styles.lapTimeCell}>00:00</span>
        </div>
      ) : (lastLapTime || sinceArrive) && (
        <div className={styles.lapTime}>
          <span className={styles.lapTimeCell}>{lastLapTime ?? "--:--"}</span>
          <span className={styles.lapTimeCell}>{sinceArrive ?? "--:--"}</span>
        </div>
      )}
      <div className={`${styles.pos} ${medalClass ? styles.posMedal : ""} ${medalClass}`}>{catPos ?? "—"}</div>
    </div>
  );
};

export default RacingRider;
