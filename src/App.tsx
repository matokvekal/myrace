import React, { useEffect, Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import "./app/i18n/i18n";
import LandingPage from "./app/page";
import Loader from "./app/components/Loader";
import { InstallPrompt } from "./app/components/pwa/InstallPrompt";
import { UpdatePrompt } from "./app/components/pwa/UpdatePrompt";
import { isCloudConfigured } from "./app/services/cloud/cloudConfig";
import { initAnalytics } from "./app/services/analytics/analyticsClient";

// Route-level code splitting (BUGS.md #1). The landing page (`/`) stays eager as
// the first paint; every other screen — especially the heavy Race/Heat views that
// pull in the map, OCR and Excel paths — loads on demand so the initial chunk is
// small on a phone at the start line.
const LandingV2Page = lazy(() => import("./app/landingV2/page"));
const LoginPage = lazy(() => import("./app/login/page"));
const OtpPage = lazy(() => import("./app/otp/page"));
const LoginErrorPage = lazy(() => import("./app/loginerror/page"));
const MainPage = lazy(() => import("./app/main/page"));
const ContactPage = lazy(() => import("./app/contact/page"));
const TermsPage = lazy(() => import("./app/terms/page"));
const PrivacyPage = lazy(() => import("./app/privacy/page"));
const RacePage = lazy(() => import("./app/race/[id]/page"));
const HeatPage = lazy(() => import("./app/race/[id]/heat/[heatId]/page"));
const StandingPage = lazy(() => import("./app/race/[id]/standing/[heatId]/page"));
const ResultsPage = lazy(() => import("./app/race/[id]/results/ResultsPage"));
// Loaded on demand like the routes, so the IndexedDB helper stays out of the
// eager bundle. It reads the shared DB-health flag set by initIndexedDB().
const DbUpdateNotice = lazy(() =>
  import("./app/components/pwa/DbUpdateNotice").then((m) => ({ default: m.DbUpdateNotice }))
);
// The one toast host (Story 1.4). Loaded on demand so react-toastify and its CSS
// stay out of the eager bundle; toasts are only raised from lazily loaded screens.
const AppToasts = lazy(() => import("./app/components/toast/AppToasts"));

export default function App() {
  // Restore Supabase session + start the offline->online flush listener. Both
  // are no-ops when cloud is not configured, and the whole cloud module (incl.
  // the Supabase SDK) is dynamically imported so it stays out of the initial
  // bundle for the local-first path (BUGS.md #1).
  useEffect(() => {
    if (!isCloudConfigured()) return;
    let cancelled = false;
    (async () => {
      const [{ useCloudStore }, { attachOnlineListener }] = await Promise.all([
        import("./app/stores/cloudStore"),
        import("./app/services/cloud/cloudSync"),
      ]);
      if (cancelled) return;
      useCloudStore.getState().init();
      attachOnlineListener();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // No-op when VITE_FIREBASE_* env vars aren't set; the Firebase SDK itself is
  // dynamically imported so it never lands in the eager bundle either way.
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <>
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/landing2" element={<LandingV2Page />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/otp" element={<OtpPage />} />
          <Route path="/loginerror" element={<LoginErrorPage />} />
          <Route path="/main" element={<MainPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/race" element={<Navigate to="/main" replace />} />
          <Route path="/race/:id" element={<RacePage />} />
          <Route path="/race/:id/heat/:heatId" element={<HeatPage />} />
          <Route path="/race/:id/standing/:heatId" element={<StandingPage />} />
          <Route path="/race/:id/results" element={<ResultsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <InstallPrompt />
      <UpdatePrompt />
      <Suspense fallback={null}>
        <DbUpdateNotice />
        <AppToasts />
      </Suspense>
    </>
  );
}
