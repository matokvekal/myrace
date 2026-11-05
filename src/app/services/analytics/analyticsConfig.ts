/**
 * Firebase Analytics configuration check — env only, no `firebase` import.
 *
 * Mirrors `cloudConfig.ts` (BUGS.md #1 bundle-splitting pattern): the eager
 * startup path (App.tsx) can ask "is analytics configured?" without dragging
 * the Firebase SDK into the initial bundle. The SDK loads on demand from
 * `analytics.ts`, only when configured.
 */
export function isAnalyticsConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_FIREBASE_API_KEY &&
      import.meta.env.VITE_FIREBASE_PROJECT_ID &&
      import.meta.env.VITE_FIREBASE_APP_ID &&
      import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
  );
}

export function getFirebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  };
}
