import { useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import styles from './micPermissionModal.module.css';

interface MicPermissionModalProps {
  /** Called after the browser grants microphone access. */
  onGranted: () => void;
  /** Called when the user closes / cancels without granting. */
  onClose: () => void;
}

type Stage = 'intro' | 'requesting' | 'denied';

/**
 * Friendly pre-prompt shown before we trigger the browser's native microphone
 * permission dialog. Explains *why* we need the mic so users aren't surprised
 * by the OS prompt, then calls getUserMedia to actually request access.
 */
export function MicPermissionModal({ onGranted, onClose }: MicPermissionModalProps) {
  const [stage, setStage] = useState<Stage>('intro');

  const requestMic = async () => {
    setStage('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // We only needed the permission grant — release the mic immediately;
      // the Web Speech API opens its own stream.
      stream.getTracks().forEach((t) => t.stop());
      onGranted();
    } catch {
      setStage('denied');
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.iconWrap}>
          {stage === 'denied' ? <MicOff size={30} /> : <Mic size={30} />}
        </div>

        {stage === 'denied' ? (
          <>
            <h2 className={styles.title}>Microphone blocked</h2>
            <p className={styles.body}>
              Voice input needs microphone access. It looks like it was blocked. To turn it
              on, tap the <strong>🔒 lock / site settings</strong> icon in your browser's
              address bar, allow the microphone, then try again.
            </p>
            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title}>Enable voice input</h2>
            <p className={styles.body}>
              Call out bib numbers and Commissire records laps hands-free. We'll ask your
              browser for microphone access — audio is processed on your device only.
            </p>
            <div className={styles.actions}>
              <button className={styles.secondaryBtn} onClick={onClose} disabled={stage === 'requesting'}>
                Not now
              </button>
              <button className={styles.primaryBtn} onClick={requestMic} disabled={stage === 'requesting'}>
                {stage === 'requesting' ? 'Waiting…' : 'Enable microphone'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
