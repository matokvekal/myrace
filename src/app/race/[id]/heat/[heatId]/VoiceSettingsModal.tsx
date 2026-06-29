import styles from './voiceSettingsModal.module.css';
import { useVoiceSettingsStore } from '@/stores/voiceSettingsStore';

interface VoiceSettingsModalProps {
  onClose: () => void;
}

export function VoiceSettingsModal({ onClose }: VoiceSettingsModalProps) {
  const { settings, setLanguage, setAutoConfirm } = useVoiceSettingsStore();

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Voice Settings</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <label className={styles.label}>Language</label>
            <div className={styles.languageToggle}>
              <button
                className={`${styles.languageBtn} ${settings.language === 'en' ? styles.active : ''}`}
                onClick={() => setLanguage('en')}
              >
                English
              </button>
              <button
                className={`${styles.languageBtn} ${settings.language === 'he' ? styles.active : ''}`}
                onClick={() => setLanguage('he')}
              >
                עברית
              </button>
            </div>
          </div>

          <div className={styles.section}>
            <label className={styles.label}>Engine</label>
            <div className={styles.engineInfo}>
              <span className={styles.badge}>Web Speech API</span>
            </div>
          </div>

          <div className={styles.section}>
            <label className={styles.label}>Auto-Confirm</label>
            <div className={styles.toggleContainer}>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={settings.autoConfirm}
                  onChange={(e) => setAutoConfirm(e.target.checked)}
                />
                <span>Auto-record lap on spoken bib number</span>
              </label>
              <p className={styles.hint}>
                {settings.autoConfirm
                  ? 'When you speak a bib number, the lap will be recorded automatically.'
                  : 'When you speak a bib number, it will appear in the search box for you to confirm by tapping.'}
              </p>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.closeModalBtn} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
