import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { invitations, openSharedRace, useLiveStore } from "@/services/live/liveClient";
import styles from "./live.module.css";

type Preview = Awaited<ReturnType<typeof invitations.preview>>;

/** /invite/:token — an invitation link or QR code: sign in, then accept. */
export default function InvitePage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const user = useLiveStore((s) => s.user);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    invitations.preview(token).then(setPreview).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [user, token]);

  if (!user) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.card}>
            <h1 className={styles.title}>{t("live.inviteTitle", "You're invited to a race")}</h1>
            <p className={styles.muted}>{t("live.inviteSignIn", "Sign in (or create an account) to see and accept the invitation.")}</p>
            <button className={styles.button} onClick={() => navigate(`/account?next=${encodeURIComponent(`/invite/${token}`)}`)}>
              {t("live.signIn", "Sign in")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const { raceUuid } = await invitations.accept(token);
      const local = await openSharedRace(raceUuid);
      navigate(`/race/${local}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t("live.inviteTitle", "You're invited to a race")}</h1>
          {error && <p className={styles.error} dir="auto">{error}</p>}
          {preview && (
            <>
              <strong dir="auto">{preview.raceName}</strong>
              <p className={styles.muted} dir="auto">
                {preview.raceDate} · {t("live.invitedBy", "from")} {preview.invitedBy}
              </p>
              <p className={styles.muted} dir="auto">
                {t("live.yourRoles", "Your roles")}: {preview.roles.join(", ") || t("live.roleViewer", "viewer")}
                {preview.waves ? ` · ${t("live.waves", "waves")} ${preview.waves.join(", ")}` : ""}
              </p>
              {preview.status !== "valid" ? (
                <p className={styles.error}>{t("live.inviteInvalid", "This invitation is no longer valid.")}</p>
              ) : !preview.canAccept ? (
                <p className={styles.error} dir="auto">
                  {preview.forEmail
                    ? t("live.inviteWrongEmail", "This invitation is for {{email}}. Sign in with that email (verified) to accept.", { email: preview.forEmail })
                    : t("live.inviteWrongAccount", "This invitation is for another account.")}
                </p>
              ) : (
                <button className={styles.button} disabled={busy} onClick={() => void accept()}>{t("live.accept", "Accept")}</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
