import { Mic } from 'lucide-react';
import styles from './voiceRadarIcon.module.css';

interface VoiceRadarIconProps {
  isActive: boolean;
  audioLevel: number;
  isListening?: boolean;
}

export function VoiceRadarIcon({ isActive, audioLevel, isListening }: VoiceRadarIconProps) {
  const intensity = isListening ? Math.min(100, audioLevel) : 0;

  return (
    <div className={`${styles.container} ${isActive ? styles.active : ''}`}>
      <svg
        width="56"
        height="56"
        viewBox="0 0 56 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={styles.svg}
      >
        {/* Center point */}
        <circle
          cx="28"
          cy="28"
          r="2.5"
          fill={isActive ? '#10b981' : '#9ca3af'}
          style={{ transition: 'fill 0.2s ease' }}
        />

        {/* Expanding waves - only show when listening */}
        {isActive && isListening && intensity > 15 && (
          <>
            {/* Wave 1 - closest to center */}
            <circle
              cx="28"
              cy="28"
              r="8"
              fill="none"
              stroke="#10b981"
              strokeWidth="1.5"
              opacity={Math.max(0, 1 - (intensity / 100) * 0.5)}
              className={styles.wave}
              style={{
                animation: `expandWave 0.8s ease-out infinite`,
              }}
            />
            {/* Wave 2 */}
            <circle
              cx="28"
              cy="28"
              r="12"
              fill="none"
              stroke="#10b981"
              strokeWidth="1.5"
              opacity={Math.max(0, 0.8 - (intensity / 100) * 0.4)}
              className={styles.wave}
              style={{
                animation: `expandWave 0.8s ease-out 0.2s infinite`,
              }}
            />
            {/* Wave 3 */}
            <circle
              cx="28"
              cy="28"
              r="16"
              fill="none"
              stroke="#10b981"
              strokeWidth="1.5"
              opacity={Math.max(0, 0.6 - (intensity / 100) * 0.3)}
              className={styles.wave}
              style={{
                animation: `expandWave 0.8s ease-out 0.4s infinite`,
              }}
            />
            {/* Wave 4 - outer */}
            <circle
              cx="28"
              cy="28"
              r="20"
              fill="none"
              stroke="#10b981"
              strokeWidth="1.5"
              opacity={Math.max(0, 0.4 - (intensity / 100) * 0.2)}
              className={styles.wave}
              style={{
                animation: `expandWave 0.8s ease-out 0.6s infinite`,
              }}
            />
          </>
        )}

        {/* Idle state - slow pulse when active but no voice */}
        {isActive && (!isListening || intensity <= 15) && (
          <circle
            cx="28"
            cy="28"
            r="12"
            fill="none"
            stroke="#10b981"
            strokeWidth="1"
            opacity="0.3"
            className={styles.idlePulse}
          />
        )}
      </svg>

      {/* Microphone in the centre so the button reads as "voice" at a glance */}
      <Mic className={styles.micIcon} size={22} strokeWidth={2.4} aria-hidden="true" />

      {/* Outer glow when listening */}
      {isActive && isListening && (
        <div
          className={styles.glow}
          style={{
            opacity: Math.min(0.8, intensity / 100),
          }}
        />
      )}
    </div>
  );
}
