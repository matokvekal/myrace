import { useState } from 'react';
import { Download, Share, Plus, X } from 'lucide-react';
import { usePwaInstall } from './usePwaInstall';
import styles from './installPrompt.module.css';

/**
 * Global install banner. Shows a custom "Install app" button when the browser
 * fires `beforeinstallprompt`, or Add-to-Home-Screen instructions on iOS Safari
 * (which has no programmatic prompt). Hidden once installed or dismissed.
 */
export function InstallPrompt() {
  const { canInstall, isIosSafari, promptInstall, dismiss } = usePwaInstall();
  const [busy, setBusy] = useState(false);

  if (!canInstall && !isIosSafari) return null;

  const handleInstall = async () => {
    setBusy(true);
    await promptInstall();
    setBusy(false);
  };

  return (
    <div className={styles.banner} role="dialog" aria-label="Install app">
      <img src="/pwa-192.png" alt="" className={styles.icon} />

      <div className={styles.text}>
        <div className={styles.title}>Install Commissire</div>
        {isIosSafari ? (
          <div className={styles.sub}>
            Tap <Share size={14} className={styles.inlineIcon} aria-label="Share" /> then{' '}
            <strong>
              Add to Home Screen <Plus size={13} className={styles.inlineIcon} aria-hidden="true" />
            </strong>
          </div>
        ) : (
          <div className={styles.sub}>Add it to your device for full-screen, offline use.</div>
        )}
      </div>

      {canInstall && (
        <button className={styles.installBtn} onClick={handleInstall} disabled={busy}>
          <Download size={16} aria-hidden="true" />
          Install
        </button>
      )}

      <button className={styles.dismissBtn} onClick={dismiss} aria-label="Dismiss">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
