/**
 * Quick Trial Access: shown instead of the sign-in page once this device's trial has
 * ended (expired, withdrawn by the owner, or the feature switched off). The race and
 * everything the judge recorded stay on the server; only the trial session is gone.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { clearTrialEnded } from "@/services/live/liveClient";
import styles from "./live.module.css";

export default function TrialEnded() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const leave = (to: string) => {
    clearTrialEnded();
    navigate(to, { replace: true });
  };
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.card} data-testid="trial-ended">
          <h1 className={styles.title}>{t("trial.endedTitle", "Your trial access has ended")}</h1>
          <p className={styles.muted} dir="auto">
            {t("trial.ended", "Thanks for trying Commissaire. Everything you recorded is kept in the race. To judge again, ask the race owner for a new link — or register for a free account.")}
          </p>
          <button className={styles.button} onClick={() => leave("/account")}>{t("trial.register", "Register / Sign in")}</button>
          <button className={styles.secondary} onClick={() => leave("/")}>{t("trial.home", "Home")}</button>
        </div>
      </div>
    </div>
  );
}
