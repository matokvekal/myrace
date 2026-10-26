import { useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { getDbHealth, subscribeDbHealth } from '@/stores/indexDb/indexedDbHelper';
import styles from './installPrompt.module.css';

/**
 * One-line notice shown when the saved race database is newer than this app
 * version and can't be fully used. Nothing is deleted — the user only needs to
 * update the app (reload picks up the newer cached version when available).
 */
export function DbUpdateNotice() {
  const health = useSyncExternalStore(subscribeDbHealth, getDbHealth, getDbHealth);
  const [dismissed, setDismissed] = useState(false);

  if (health !== 'needs-update' || dismissed) return null;

  return (
    <div className={styles.banner} role="status" aria-live="polite" data-testid="db-update-notice">
      <div className={styles.text}>
        <div className={styles.title} dir="auto">Please update the app</div>
        <div className={styles.sub} dir="auto">
          Your saved races are newer than this version. They are kept safe — update to see them.
        </div>
      </div>
      <button className={styles.dismissBtn} onClick={() => setDismissed(true)} aria-label="Dismiss">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
