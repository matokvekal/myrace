import { RefreshCw, X } from 'lucide-react';
import { useServiceWorkerUpdate } from './useServiceWorkerUpdate';
import styles from './installPrompt.module.css';

/**
 * Non-blocking banner shown when a new app version is waiting. Lets the user
 * update in place when it's safe (between heats), rather than auto-reloading.
 */
export function UpdatePrompt() {
  const { updateReady, applyUpdate, dismiss } = useServiceWorkerUpdate();

  if (!updateReady) return null;

  return (
    <div className={styles.banner} role="dialog" aria-label="Update available">
      <div className={styles.text}>
        <div className={styles.title}>New version available</div>
        <div className={styles.sub}>Update to get the latest fixes.</div>
      </div>

      <button className={styles.installBtn} onClick={applyUpdate}>
        <RefreshCw size={16} aria-hidden="true" />
        Update now
      </button>

      <button className={styles.dismissBtn} onClick={dismiss} aria-label="Later">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
