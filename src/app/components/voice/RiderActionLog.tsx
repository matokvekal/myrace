import { useState, useEffect } from 'react';
import styles from './riderActionLog.module.css';
import { RiderProps } from '@/types/types';
import { Bell, Search, X } from 'lucide-react';
import { parseClockTimeMs } from '@/utils/timeUtils';

interface RiderAction {
  id: string;
  rider: RiderProps;
  timestamp: number;
  source: 'click' | 'voice';
  categoryColor: string;
  statusChange?: 'DNF' | 'DSQ' | 'DNS';
}

interface RiderActionLogProps {
  actions: RiderAction[];
  isOpen: boolean;
  onToggle: () => void;
  onCancel?: (actionId: string, riderName: string) => void;
}

const CANCEL_ACTIVE_MS = 20000; // 20 seconds - show cancel button
const CANCEL_DEADLINE_MS = 30000; // 30 seconds - no more cancelling

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function RiderActionLog({ actions, isOpen, onToggle, onCancel }: RiderActionLogProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<Record<string, number>>({});
  const [sortBy, setSortBy] = useState<'arrival' | 'bib'>('arrival');
  const [now, setNow] = useState(() => Date.now());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Closing the panel always drops back to the full, unfiltered "Arrival" view
  useEffect(() => {
    if (!isOpen) {
      setSearchOpen(false);
      setSearchTerm('');
      setSortBy('arrival');
    }
  }, [isOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchTerm('');
    setSortBy('arrival');
  };

  const matchesSearch = (rider: RiderProps) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      rider.firstName.toLowerCase().includes(q) ||
      rider.lastName.toLowerCase().includes(q) ||
      String(rider.bibNumber).includes(q)
    );
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        const updated = { ...prev };
        actions.forEach((action) => {
          const elapsed = Date.now() - action.timestamp;
          updated[action.id] = Math.max(0, CANCEL_ACTIVE_MS - elapsed);
        });
        return updated;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [actions]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const canCancel = (action: RiderAction) => {
    const elapsed = Date.now() - action.timestamp;
    return elapsed < CANCEL_DEADLINE_MS;
  };

  const showCancelButton = (action: RiderAction) => {
    const elapsed = Date.now() - action.timestamp;
    return elapsed < CANCEL_ACTIVE_MS;
  };

  const handleCancel = (action: RiderAction) => {
    setConfirmingId(action.id);
  };

  const confirmCancel = (action: RiderAction) => {
    setConfirmingId(null);
    onCancel?.(action.id, `#${action.rider.bibNumber} ${action.rider.firstName} ${action.rider.lastName}`);
  };

  const riderName = (rider: RiderProps) =>
    `#${rider.bibNumber} ${rider.firstName} ${rider.lastName}`;

  // "Bib" view: one card per rider, bib ascending. The newest action for that rider
  // already carries the full cumulative lapsDetails history, so grouping is just "keep the latest".
  const getRiderGroups = () => {
    const latestByRider = new Map<number, RiderAction>();
    for (const action of actions) {
      const existing = latestByRider.get(action.rider.id);
      if (!existing || action.timestamp > existing.timestamp) {
        latestByRider.set(action.rider.id, action);
      }
    }

    const groups = Array.from(latestByRider.values()).filter((a) => matchesSearch(a.rider));
    groups.sort((a, b) => a.rider.bibNumber - b.rider.bibNumber);
    return groups;
  };

  return (
    <>
      {/* Toggle button */}
      <button
        className={`${styles.toggleBtn} ${isOpen ? styles.open : ''}`}
        onClick={onToggle}
        // Without this the ⏱️ glyph IS the accessible name — `title` is only a
        // fallback, so the button announced as "⏱️" and was unaddressable.
        aria-label="View rider action history"
        title="View rider action history"
      >
        <span className={styles.icon}>⏱️</span>
        {actions.length > 0 && <span className={styles.badge}>{actions.length}</span>}
      </button>

      {/* Log panel */}
      {isOpen && (
        <div className={styles.overlay} onClick={onToggle}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.header}>
              <h3>Rider Log</h3>
              <div className={styles.sortControls}>
                <button
                  className={`${styles.sortBtn} ${sortBy === 'arrival' ? styles.active : ''}`}
                  onClick={() => setSortBy('arrival')}
                >
                  Arrival
                </button>
                <button
                  className={`${styles.sortBtn} ${sortBy === 'bib' ? styles.active : ''}`}
                  onClick={() => setSortBy('bib')}
                >
                  Bib
                </button>
              </div>
              <button
                className={`${styles.searchToggleBtn} ${searchOpen ? styles.active : ''}`}
                onClick={() => setSearchOpen((o) => !o)}
                title="Search by name or bib"
              >
                <Search size={16} />
              </button>
              <button className={styles.closeBtn} onClick={onToggle} aria-label="Close rider log">✕</button>
            </div>

            {searchOpen && (
              <div className={styles.searchRow}>
                <Search size={14} className={styles.searchRowIcon} />
                <input
                  autoFocus
                  className={styles.searchInput}
                  placeholder="Search name or bib…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button className={styles.searchCloseBtn} onClick={closeSearch} title="Clear search">
                  <X size={14} />
                </button>
              </div>
            )}

            {actions.length === 0 ? (
              <div className={styles.empty}>No riders recorded yet</div>
            ) : sortBy === 'arrival' ? (
              <div className={styles.list}>
                {actions.filter((a) => matchesSearch(a.rider)).map((action, idx, arr) => {
                  const isConfirming = confirmingId === action.id;
                  const showCancel = showCancelButton(action);
                  const remaining = timeRemaining[action.id] ?? CANCEL_ACTIVE_MS;
                  // Stable row number: the earliest arrival is #1, and existing rows keep
                  // their number as new arrivals get prepended above them.
                  const rowNumber = arr.length - idx;

                  const rider = action.rider;
                  const isOut = !!action.statusChange;
                  const isFinished = !isOut && rider.raceStatus === 'finished';
                  const lapsRemaining = rider.totalLaps - rider.lapsCounter;
                  const showBell = !isOut && !isFinished && lapsRemaining === 2;
                  const showLastLapFlag = !isOut && !isFinished && lapsRemaining === 1;

                  const laps = rider.lapsDetails ?? [];
                  const lastLap = laps.length > 0 ? laps[laps.length - 1] : null;
                  const lastLapTime = lastLap?.lapTime ?? rider.elapsedLastLap ?? null;
                  const sinceArriveBaseline = parseClockTimeMs(rider.timeArrive) ?? parseClockTimeMs(rider.timeStartRace);
                  const sinceArrive = !isOut && !isFinished && sinceArriveBaseline != null
                    ? formatDuration(now - sinceArriveBaseline)
                    : null;

                  return (
                    <div key={`${action.id}-${idx}`} className={styles.entry}>
                      <span className={styles.rowNumber}>{rowNumber}</span>
                      <div
                        className={styles.colorDot}
                        style={{ backgroundColor: action.categoryColor }}
                        title={rider.category}
                      />
                      <div className={styles.info}>
                        <div className={styles.riderName}>
                          {riderName(rider)}
                        </div>
                        {rider.team && (
                          <div className={styles.club}>{rider.team}</div>
                        )}
                        <div className={styles.meta}>
                          <span className={styles.time}>{formatTime(action.timestamp)}</span>
                          <span className={`${styles.source} ${styles[action.source]}`}>
                            {action.source === 'voice' ? '🎤' : '👆'}
                          </span>
                        </div>
                        {!isOut && !isFinished && (lastLapTime || sinceArrive) && (
                          <div className={styles.liveTimes}>
                            <span className={styles.liveTimesValue}>
                              {lastLapTime ?? '--:--'} <span className={styles.liveTimesDivider} /> {sinceArrive ?? '--:--'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className={styles.lapsInfo}>
                        {showBell && (
                          <div className={styles.bellIndicator} title="2 laps left">
                            <Bell size={14} color="#c07a00" fill="#ffd60a" />
                          </div>
                        )}
                        {showLastLapFlag && (
                          <div className={styles.flagIndicator} title="Last lap">
                            <div className={styles.flagCloth} />
                            <div className={styles.flagPole} />
                          </div>
                        )}
                        {isOut ? (
                          <div className={`${styles.statusBadge} ${styles[action.statusChange!.toLowerCase()]}`}>
                            {action.statusChange} @ {rider.lapsCounter}/{rider.totalLaps}
                          </div>
                        ) : isFinished ? (
                          <div className={`${styles.statusBadge} ${styles.fin}`}>FINISH</div>
                        ) : (
                          <div className={styles.laps}>
                            {rider.lapsCounter}/{rider.totalLaps}
                          </div>
                        )}
                      </div>

                      {/* Cancel button */}
                      {showCancel && !isConfirming && (
                        <button
                          className={styles.cancelBtn}
                          onClick={() => handleCancel(action)}
                          title="Cancel this entry"
                        >
                          <span className={styles.cancelTime}>
                            {Math.ceil(remaining / 1000)}s
                          </span>
                          ✕
                        </button>
                      )}

                      {/* Confirmation modal */}
                      {isConfirming && (
                        <div className={styles.confirmOverlay}>
                          <div className={styles.confirmModal}>
                            <div className={styles.confirmText}>
                              Cancel {riderName(action.rider)}?
                            </div>
                            <div className={styles.confirmButtons}>
                              <button
                                className={styles.confirmYes}
                                onClick={() => confirmCancel(action)}
                              >
                                Yes, Cancel
                              </button>
                              <button
                                className={styles.confirmNo}
                                onClick={() => setConfirmingId(null)}
                              >
                                No
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.list}>
                {getRiderGroups().map((latestAction) => {
                  const rider = latestAction.rider;
                  const laps = rider.lapsDetails ?? [];
                  const raceStartMs = laps.length > 0 ? new Date(laps[0].startTime).getTime() : null;

                  const isConfirming = confirmingId === latestAction.id;
                  const showCancel = showCancelButton(latestAction);
                  const canCancelAction = canCancel(latestAction);
                  const remaining = timeRemaining[latestAction.id] ?? CANCEL_ACTIVE_MS;

                  const isOut = !!latestAction.statusChange;
                  const isFinished = !isOut && rider.raceStatus === 'finished';
                  const lapsRemaining = rider.totalLaps - rider.lapsCounter;
                  const showBell = !isOut && !isFinished && lapsRemaining === 2;
                  const showLastLapFlag = !isOut && !isFinished && lapsRemaining === 1;

                  const lastLap = laps.length > 0 ? laps[laps.length - 1] : null;
                  const lastLapTime = lastLap?.lapTime ?? rider.elapsedLastLap ?? null;
                  const sinceArriveBaseline = parseClockTimeMs(rider.timeArrive) ?? parseClockTimeMs(rider.timeStartRace);
                  const sinceArrive = !isOut && !isFinished && sinceArriveBaseline != null
                    ? formatDuration(now - sinceArriveBaseline)
                    : null;

                  return (
                    <div key={rider.id} className={styles.riderCard}>
                      <div className={styles.riderCardHeader}>
                        <div
                          className={styles.colorDot}
                          style={{ backgroundColor: latestAction.categoryColor }}
                          title={rider.category}
                        />
                        <div className={styles.info}>
                          <div className={styles.riderName}>{riderName(rider)}</div>
                          <div className={styles.meta}>
                            {rider.team && <span className={styles.club}>{rider.team}</span>}
                            <span className={styles.category}>
                              {rider.category}
                              {rider.subCategory && ` · ${rider.subCategory}`}
                            </span>
                          </div>
                        </div>
                        {showBell && (
                          <div className={styles.bellIndicator} title="2 laps left">
                            <Bell size={14} color="#c07a00" fill="#ffd60a" />
                          </div>
                        )}
                        {showLastLapFlag && (
                          <div className={styles.flagIndicator} title="Last lap">
                            <div className={styles.flagCloth} />
                            <div className={styles.flagPole} />
                          </div>
                        )}
                        {isOut && (
                          <div className={`${styles.statusBadge} ${styles[latestAction.statusChange!.toLowerCase()]}`}>
                            {latestAction.statusChange} @ {rider.lapsCounter}/{rider.totalLaps}
                          </div>
                        )}
                        {isFinished && (
                          <div className={`${styles.statusBadge} ${styles.fin}`}>FINISH</div>
                        )}
                      </div>

                      {!isOut && !isFinished && (lastLapTime || sinceArrive) && (
                        <div className={styles.liveTimes}>
                          <span className={styles.liveTimesLabel}>Last lap / Since arrive</span>
                          <span className={styles.liveTimesValue}>
                            {lastLapTime ?? '--:--'} <span className={styles.liveTimesDivider} /> {sinceArrive ?? '--:--'}
                          </span>
                        </div>
                      )}

                      {laps.length > 0 && (
                        <div className={styles.lapsTable}>
                          <div className={styles.lapsTableHead}>
                            <span>Lap</span>
                            <span>Lap Time</span>
                            <span>Total</span>
                            <span>Arrived</span>
                          </div>
                          {laps.map((lap, i) => {
                            const cumulativeMs = raceStartMs != null
                              ? new Date(lap.endTime).getTime() - raceStartMs
                              : 0;
                            const isLastLap = i === laps.length - 1;
                            return (
                              <div key={i} className={styles.lapRow}>
                                <span className={styles.lapNum}>{lap.lap}</span>
                                <span className={styles.lapTime}>{lap.lapTime}</span>
                                <span className={styles.lapCumulative}>{formatDuration(cumulativeMs)}</span>
                                <span className={styles.lapArrival}>{formatTime(new Date(lap.endTime).getTime())}</span>
                                {isLastLap && !latestAction.statusChange && showCancel && !isConfirming && (
                                  <button
                                    className={styles.cancelBtn}
                                    onClick={() => handleCancel(latestAction)}
                                    title="Cancel this lap"
                                  >
                                    <span className={styles.cancelTime}>
                                      {Math.ceil(remaining / 1000)}s
                                    </span>
                                    ✕
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Status-only entry (no laps recorded yet) still needs a cancel affordance */}
                      {laps.length === 0 && latestAction.statusChange && showCancel && !isConfirming && (
                        <button
                          className={styles.cancelBtn}
                          onClick={() => handleCancel(latestAction)}
                          title="Cancel this status"
                        >
                          <span className={styles.cancelTime}>
                            {Math.ceil(remaining / 1000)}s
                          </span>
                          ✕
                        </button>
                      )}

                      {/* Confirmation modal */}
                      {isConfirming && canCancelAction && (
                        <div className={styles.confirmOverlay}>
                          <div className={styles.confirmModal}>
                            <div className={styles.confirmText}>
                              Cancel {riderName(rider)}?
                            </div>
                            <div className={styles.confirmButtons}>
                              <button
                                className={styles.confirmYes}
                                onClick={() => confirmCancel(latestAction)}
                              >
                                Yes, Cancel
                              </button>
                              <button
                                className={styles.confirmNo}
                                onClick={() => setConfirmingId(null)}
                              >
                                No
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
