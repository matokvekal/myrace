import styles from './riderActionLog.module.css';
import { RiderProps } from '@/types/types';

interface RiderAction {
  id: string;
  rider: RiderProps;
  timestamp: number;
  source: 'click' | 'voice';
  categoryColor: string;
}

interface RiderActionLogProps {
  actions: RiderAction[];
  isOpen: boolean;
  onToggle: () => void;
}

export function RiderActionLog({ actions, isOpen, onToggle }: RiderActionLogProps) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <>
      {/* Toggle button */}
      <button
        className={`${styles.toggleBtn} ${isOpen ? styles.open : ''}`}
        onClick={onToggle}
        title="View rider action history"
      >
        <span className={styles.icon}>📋</span>
        {actions.length > 0 && <span className={styles.badge}>{actions.length}</span>}
      </button>

      {/* Log panel */}
      {isOpen && (
        <div className={styles.overlay} onClick={onToggle}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.header}>
              <h3>Rider Log</h3>
              <button className={styles.closeBtn} onClick={onToggle}>✕</button>
            </div>

            {actions.length === 0 ? (
              <div className={styles.empty}>No riders recorded yet</div>
            ) : (
              <div className={styles.list}>
                {actions.map((action, idx) => (
                  <div key={`${action.id}-${idx}`} className={styles.entry}>
                    <div
                      className={styles.colorDot}
                      style={{ backgroundColor: action.categoryColor }}
                      title={action.rider.category}
                    />
                    <div className={styles.info}>
                      <div className={styles.riderName}>
                        #{action.rider.bibNumber} {action.rider.firstName} {action.rider.lastName}
                      </div>
                      <div className={styles.meta}>
                        <span className={styles.time}>{formatTime(action.timestamp)}</span>
                        <span className={`${styles.source} ${styles[action.source]}`}>
                          {action.source === 'voice' ? '🎤' : '👆'}
                        </span>
                      </div>
                    </div>
                    <div className={styles.laps}>
                      {action.rider.lapsCounter}/{action.rider.totalLaps}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
