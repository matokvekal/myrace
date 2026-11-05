import { useEffect, useState } from 'react';
import { logAnalyticsEvent } from '@/services/analytics/analyticsClient';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as any).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iPhoneOrIpod = /iP(hone|od)/.test(ua);
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return iPhoneOrIpod || iPad;
}

// `beforeinstallprompt` fires ONCE, early. It is captured here at module level
// and shared, so every consumer (the banner AND the side-menu "Install app"
// item, which mounts much later) sees it. Per-hook listeners missed it.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let appInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    appInstalled = true;
    deferredPrompt = null;
    logAnalyticsEvent('pwa_install');
    notify();
  });
}

interface PwaInstall {
  /** Native Chrome/Android/desktop prompt is available (banner: not dismissed). */
  canInstall: boolean;
  /** iOS Safari — no native prompt, show manual Add-to-Home-Screen hint. */
  isIosSafari: boolean;
  /** The native prompt is available right now, regardless of banner dismissal. */
  hasNativePrompt: boolean;
  /** Already running as an installed app (or just installed). */
  installed: boolean;
  /** Fire the native install prompt. Resolves to true if the user accepted. */
  promptInstall: () => Promise<boolean>;
  /** User dismissed the banner — remembered so we don't nag. */
  dismiss: () => void;
}

export function usePwaInstall(): PwaInstall {
  const [, setTick] = useState(0);
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1'
  );

  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const installed = appInstalled || isStandalone();
  const hidden = installed || dismissed;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  const promptInstall = async (): Promise<boolean> => {
    const ev = deferredPrompt;
    if (!ev) return false;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    deferredPrompt = null;
    notify();
    if (outcome === 'dismissed') dismiss();
    return outcome === 'accepted';
  };

  return {
    canInstall: !hidden && deferredPrompt !== null,
    // iOS Safari (not already installed) can't use the native prompt.
    isIosSafari: !hidden && isIos() && !isStandalone(),
    hasNativePrompt: !installed && deferredPrompt !== null,
    installed,
    promptInstall,
    dismiss,
  };
}
