import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { invitations, myRaces, openSharedRace, useLiveStore, type MyRace } from "@/services/live/liveClient";
import styles from "./live.module.css";

/** Main screen: shared races (My Races) and pending invitations, or a sign-in prompt. */
export default function SharedRacesSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useLiveStore((s) => s.user);
  const [races, setRaces] = useState<MyRace[]>([]);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!user) return;
    myRaces().then(setRaces).catch(() => {});
    invitations.mine().then((r) => setPending(r.invitations.length)).catch(() => {});
  }, [user]);

  if (!user) {
    return (
      <div className={styles.card} data-testid="shared-races">
        <div className={styles.spread}>
          <span className={styles.muted}>{t("live.shareHint", "Run a race with your team on several phones")}</span>
          <button className={styles.secondary} onClick={() => navigate("/account")}>{t("live.signIn", "Sign in")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card} data-testid="shared-races">
      <div className={styles.spread}>
        <h2 className={styles.subtitle}>{t("live.myRaces", "My shared races")}</h2>
        <button className={styles.link} onClick={() => navigate("/account")}>
          {pending > 0 ? t("live.pendingInvites", "{{n}} invitation(s)", { n: pending }) : user.name}
        </button>
      </div>
      {races.length === 0 ? (
        <p className={styles.muted}>{t("live.noRaces", "No shared races yet. Open a race → Team → Share to start one.")}</p>
      ) : (
        <ul className={styles.list}>
          {races.map((r) => (
            <li key={r.race.uuid} className={styles.item}>
              <div className={styles.spread}>
                <strong dir="auto">{r.race.name}</strong>
                <span className={styles.badge}>{r.access.isOwner ? t("live.roleOwner", "owner") : r.access.roles.join(", ") || t("live.roleViewer", "viewer")}</span>
              </div>
              <button
                className={styles.secondary}
                onClick={async () => navigate(`/race/${await openSharedRace(r.race.uuid!)}`)}
              >
                {t("live.open", "Open")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
