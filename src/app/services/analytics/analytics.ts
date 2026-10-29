/**
 * Firebase Analytics — only ever reached via dynamic `import()` from
 * `analyticsClient.ts`, so the Firebase SDK never lands in the eager bundle
 * (BUGS.md #1 bundle-splitting rule, same pattern as xlsx/leaflet/supabase).
 */
import { initializeApp, FirebaseApp } from "firebase/app";
import { getAnalytics, logEvent, Analytics, isSupported } from "firebase/analytics";
import { getFirebaseConfig } from "./analyticsConfig";

let app: FirebaseApp | null = null;
let analyticsPromise: Promise<Analytics | null> | null = null;

function getAnalyticsInstance(): Promise<Analytics | null> {
  if (!analyticsPromise) {
    analyticsPromise = (async () => {
      // isSupported() guards environments without IndexedDB/cookies (e.g. some
      // private-browsing modes) where Firebase Analytics would otherwise throw.
      if (!(await isSupported())) return null;
      app = app ?? initializeApp(getFirebaseConfig());
      return getAnalytics(app);
    })();
  }
  return analyticsPromise;
}

export async function initAnalytics(): Promise<void> {
  await getAnalyticsInstance();
}

export async function logAnalyticsEvent(
  name: string,
  params?: Record<string, unknown>
): Promise<void> {
  const analytics = await getAnalyticsInstance();
  if (!analytics) return;
  logEvent(analytics, name, params);
}
