/**
 * /trial/:token — Quick Trial Access. A new judge opens the owner's link and is in the
 * race: the server creates a temporary user + session (no registration, email, password
 * or approval), the race is downloaded through the normal shared-race path, and the judge
 * lands on the existing race page in RACE mode — the operational screen (Start / Check-In /
 * Board), as the race menu's "Race" item opens it. Never Setup, never straight to the keypad.
 * Nothing here is a new judging screen.
 *
 *  - A device already signed in to an account is never switched: the judge is asked to
 *    open the link in a private / incognito window.
 *  - A device already in a trial reopens that trial's race (reload, re-tapping the link).
 */
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { LiveApiError, openSharedRace, trial, useLiveStore } from "@/services/live/liveClient";
import useUIStore from "@/stores/uiStore";
import styles from "./live.module.css";

/** One start per token per page load (React StrictMode runs effects twice; each start creates a user). */
const starting = new Map<string, Promise<{ raceUuid: string; until?: string }>>();

export const trialUntilText = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function TrialPage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const user = useLiveStore((s) => s.user);
  // Decided once, on arrival: the start itself signs this device in.
  const [arrival] = useState(() => (user ? (user.trial ? "trial" : "account") : "new"));
  const [error, setError] = useState<{ title: string; text: string; retry: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (arrival === "account" || done.current) return;
    let cancelled = false;
    setError(null);
    const run = async () => {
      let raceUuid: string;
      let until: string | undefined;
      if (arrival === "trial") {
        raceUuid = user!.trial!.raceUuid;
      } else {
        let p = starting.get(token);
        if (!p) {
          p = trial.start(token).then((r) => ({ raceUuid: r.raceUuid, until: r.user.trial?.expiresAt }));
          starting.set(token, p);
          p.catch(() => starting.delete(token)); // a failed start may be retried
        }
        ({ raceUuid, until } = await p);
      }
      const local = await openSharedRace(raceUuid);
      if (cancelled) return;
      done.current = true;
      if (until) {
        toast.info(t("trial.welcome", "You're a trial judge in this race until {{until}}.", { until: trialUntilText(until) }), { toastId: "trial-welcome" });
      }
      // RACE mode for this race (the existing per-race UI state behind the menu's "Race" item).
      useUIStore.getState().setRaceModeRace(local);
      // Replacing the entry also takes the link's secret out of the address bar and history.
      navigate(`/race/${local}`, { replace: true });
    };
    run().catch((e: unknown) => {
      if (cancelled) return;
      const code = e instanceof LiveApiError ? e.code : "";
      const status = e instanceof LiveApiError ? e.status : 0;
      if (status === 0) {
        setError({ title: t("trial.offlineTitle", "No connection"), text: t("trial.offline", "Connect to the internet and try again."), retry: true });
      } else if (code === "trial_ended") {
        navigate("/main", { replace: true }); // the trial-ended screen takes over
      } else if (code === "trial_link_invalid" || code === "trial_link_unavailable" || code === "trial_disabled" || status === 404 || status === 410) {
        setError({ title: t("trial.unavailableTitle", "This trial link can't be used"), text: t("trial.unavailable", "It may have expired, been used up, or been withdrawn. Ask the race owner for a new link."), retry: false });
      } else {
        setError({ title: t("trial.failedTitle", "Couldn't open the race"), text: e instanceof Error ? e.message : String(e), retry: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [arrival, token, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (arrival === "account") {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.card} data-testid="trial-signed-in">
            <h1 className={styles.title}>{t("trial.signedInTitle", "You're signed in on this device")}</h1>
            <p className={styles.muted} dir="auto">
              {t("trial.signedIn", "This is a trial link for a new judge. To use it without leaving your account, open the link in a private / incognito window.")}
            </p>
            <button className={styles.secondary} onClick={() => navigate("/main", { replace: true })}>{t("live.goMyRaces", "Go to My Races")}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.card} data-testid="trial-page" role="status" aria-live="polite">
          {error ? (
            <>
              <h1 className={styles.title}>{error.title}</h1>
              <p className={styles.muted} dir="auto">{error.text}</p>
              {error.retry && <button className={styles.button} onClick={() => setAttempt((n) => n + 1)}>{t("trial.retry", "Try again")}</button>}
              <button className={styles.secondary} onClick={() => navigate("/", { replace: true })}>{t("trial.home", "Home")}</button>
            </>
          ) : (
            <h1 className={styles.title}>{t("trial.opening", "Opening race…")}</h1>
          )}
        </div>
      </div>
    </div>
  );
}
