import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LandingPage from "./app/page";
import LoginPage from "./app/login/page";
import OtpPage from "./app/otp/page";
import LoginErrorPage from "./app/loginerror/page";
import MainPage from "./app/main/page";
import ContactPage from "./app/contact/page";
import RacePage from "./app/race/[id]/page";
import HeatPage from "./app/race/[id]/heat/[heatId]/page";
import StandingPage from "./app/race/[id]/standing/[heatId]/page";
import { InstallPrompt } from "./app/components/pwa/InstallPrompt";
import { useCloudStore } from "./app/stores/cloudStore";
import { isCloudConfigured } from "./app/services/cloud/supabaseClient";
import { attachOnlineListener } from "./app/services/cloud/cloudSync";

export default function App() {
  // Restore Supabase session + start the offline->online flush listener.
  // Both are no-ops when cloud is not configured.
  useEffect(() => {
    if (!isCloudConfigured()) return;
    useCloudStore.getState().init();
    attachOnlineListener();
  }, []);

  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/otp" element={<OtpPage />} />
        <Route path="/loginerror" element={<LoginErrorPage />} />
        <Route path="/main" element={<MainPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/race" element={<Navigate to="/main" replace />} />
        <Route path="/race/:id" element={<RacePage />} />
        <Route path="/race/:id/heat/:heatId" element={<HeatPage />} />
        <Route path="/race/:id/standing/:heatId" element={<StandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstallPrompt />
    </>
  );
}
