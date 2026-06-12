import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./app/page";
import LoginPage from "./app/login/page";
import OtpPage from "./app/otp/page";
import LoginErrorPage from "./app/loginerror/page";
import MainPage from "./app/main/page";
import ContactPage from "./app/contact/page";
import RacePage from "./app/race/[id]/page";
import HeatPage from "./app/race/[id]/heat/[heatId]/page";
import StandingPage from "./app/race/[id]/standing/[heatId]/page";
import NotFoundPage from "./app/not-found";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/otp" element={<OtpPage />} />
      <Route path="/loginerror" element={<LoginErrorPage />} />
      <Route path="/main" element={<MainPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/race/:id" element={<RacePage />} />
      <Route path="/race/:id/heat/:heatId" element={<HeatPage />} />
      <Route path="/race/:id/standing/:heatId" element={<StandingPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
