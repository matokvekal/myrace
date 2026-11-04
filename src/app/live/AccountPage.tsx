import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { auth, invitations, myRaces, openSharedRace, useLiveStore, type MyRace } from "@/services/live/liveClient";
import styles from "./live.module.css";
import SignInForm from "./SignInForm";
import { afterAuthTarget, ALL_RACES } from "./authRedirect";

/** Sign in / register for shared races, and the signed-in user's invitations and shared races. */
export default function AccountPage() {
  const [params] = useSearchParams();
  const next = params.get("next");
  const user = useLiveStore((s) => s.user);
  if (user) return <SignedIn next={next} />;
  return <SignInForm next={next} reason={params.get("reason")} />;
}

function SignedIn({ next }: { next: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useLiveStore((s) => s.user)!;
  const [races, setRaces] = useState<MyRace[] | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof invitations.mine>>["invitations"]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setRaces(await myRaces());
      setPending((await invitations.mine()).invitations);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    // A ?next= page (sign-in asked for by a race / invite) wins; opening /account
    // while signed in just shows the account — no redirect, so no loop.
    if (next) navigate(afterAuthTarget(next), { replace: true });
    else void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (serverRaceUuid: string) => {
    try {
      const local = await openSharedRace(serverRaceUuid);
      navigate(`/race/${local}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <button className={styles.link} onClick={() => navigate("/main")}>← {t("live.back", "Back")}</button>
        <div className={styles.card}>
          {/* Always here: the way on if the automatic move to All Races didn't happen. */}
          <button className={styles.button} onClick={() => navigate(ALL_RACES)} data-testid="go-all-races">
            {t("live.goAllRaces", "Go to All Races")}
          </button>
          <div className={styles.spread}>
            <div>
              <h1 className={styles.title} dir="auto">{user.name}</h1>
              <p className={styles.muted} dir="ltr">{user.email}</p>
            </div>
            <button className={styles.secondary} onClick={() => void auth.logout()}>{t("live.signOut", "Sign out")}</button>
          </div>
        </div>
        {error && <p className={styles.error} dir="auto">{error}</p>}
        {pending.length > 0 && (
          <div className={styles.card}>
            <h2 className={styles.subtitle}>{t("live.invitations", "Invitations")}</h2>
            <ul className={styles.list}>
              {pending.map((i) => (
                <li key={i.id} className={styles.item}>
                  <strong dir="auto">{i.raceName}</strong>
                  <span className={styles.muted} dir="auto">
                    {i.raceDate} · {t("live.invitedBy", "from")} {i.invitedBy} · {i.roles.join(", ") || t("live.roleViewer", "viewer")}
                    {i.waves ? ` · ${t("live.waves", "waves")} ${i.waves.join(", ")}` : ""}
                  </span>
                  <div className={styles.row}>
                    <button className={styles.button} onClick={async () => { const r = await invitations.acceptMine(i.id); await open(r.raceUuid); }}>
                      {t("live.accept", "Accept")}
                    </button>
                    <button className={styles.secondary} onClick={async () => { await invitations.decline(i.id); await load(); }}>{t("live.decline", "Decline")}</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className={styles.card}>
          <h2 className={styles.subtitle}>{t("live.myRaces", "My shared races")}</h2>
          {races === null ? (
            <p className={styles.muted}>{t("live.loading", "Loading…")}</p>
          ) : races.length === 0 ? (
            <p className={styles.muted}>{t("live.noRaces", "No shared races yet. Open a race → Team → Share to start one.")}</p>
          ) : (
            <ul className={styles.list}>
              {races.map((r) => (
                <li key={r.race.uuid} className={styles.item}>
                  <div className={styles.spread}>
                    <strong dir="auto">{r.race.name}</strong>
                    <span className={styles.badge}>{r.access.isOwner ? t("live.roleOwner", "owner") : r.access.roles.join(", ") || t("live.roleViewer", "viewer")}</span>
                  </div>
                  <span className={styles.muted} dir="auto">{r.race.date} {r.race.location}</span>
                  <button className={styles.secondary} onClick={() => void open(r.race.uuid!)}>{t("live.open", "Open")}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
