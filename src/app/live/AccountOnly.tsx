/**
 * Race Access Rules (server builds): race lists and race management need an
 * account. A guest is sent to sign in (and back here afterwards); a guest reads
 * a race only through its share link (/share/:token). A build without a server
 * is the local app and is not gated.
 */
import React, { Suspense, lazy } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { trialEndedOnThisDevice, useHasSession } from "./sessionPresence";

// Quick Trial Access: a judge whose trial ended sees why, not a sign-in wall (lazy: rare).
const TrialEnded = lazy(() => import("./TrialEnded"));

const serverConfigured = !!import.meta.env.VITE_SERVER_URL;

export default function AccountOnly({ children }: { children: React.ReactElement }) {
  const signedIn = useHasSession();
  const { pathname, search } = useLocation();
  if (!serverConfigured || signedIn) return children;
  if (trialEndedOnThisDevice()) return <Suspense fallback={null}><TrialEnded /></Suspense>;
  return <Navigate to={`/account?reason=guest&next=${encodeURIComponent(pathname + search)}`} replace />;
}
