import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Registers the service worker and surfaces when a new version is waiting.
 *
 * Best-practice "prompt to refresh" flow (never auto-reload — this app runs
 * live during races, so we don't yank the page out from under a commissaire
 * mid-heat):
 *   1. A new worker installs and parks in `waiting` (sw.js no longer calls
 *      skipWaiting on install).
 *   2. We expose `updateReady` so the UI can show an "Update now" banner.
 *   3. `applyUpdate()` messages the waiting worker to skipWaiting; once it takes
 *      control (`controllerchange`) we reload exactly once.
 *
 * The reload is armed only by `applyUpdate`, so the initial `clients.claim()`
 * on a first-ever visit does not trigger a reload.
 */
export function useServiceWorkerUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const swUrl = `${import.meta.env.BASE_URL}sw.js`;

    // Only treat an installed worker as an *update* when a controller already
    // exists — otherwise it's the first install, not a new version.
    const trackInstalling = (worker: ServiceWorker | null) => {
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          setWaiting(worker);
        }
      });
    };

    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => trackInstalling(reg.installing));
      })
      .catch((err) => console.warn('Service worker registration failed:', err));

    const onControllerChange = () => {
      if (!reloadingRef.current) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () =>
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    reloadingRef.current = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  const dismiss = useCallback(() => setWaiting(null), []);

  return { updateReady: waiting !== null, applyUpdate, dismiss };
}
