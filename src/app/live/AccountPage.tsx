import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { auth, invitations, myRaces, openSharedRace, useLiveStore, type MyRace } from "@/services/live/liveClient";
import styles from "./live.module.css";

type Mode = "password" | "register" | "code";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/** "Sign in with Google" (Google Identity Services), only when a client id is configured. */
function GoogleButton({ onToken }: { onToken: (idToken: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  useEffect(() => {
    if (!clientId || !ref.current) return;
    const render = () => {
      window.google?.accounts.id.initialize({ client_id: clientId, callback: (r) => onToken(r.credential) });
      if (ref.current) window.google?.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", width: 280 });
    };
    if (window.google) return render();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [clientId, onToken]);
  if (!clientId) return null;
  return <div ref={ref} />;
}

/** Sign in / register for shared races, and the signed-in user's invitations and shared races. */
export default function AccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");
  const user = useLiveStore((s) => s.user);
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (next) navigate(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (user) return <SignedIn next={next} />;

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <button className={styles.link} onClick={() => navigate("/main")}>← {t("live.back", "Back")}</button>
        <div className={styles.card}>
          <h1 className={styles.title}>{t("live.signInTitle", "Sign in to share races")}</h1>
          <p className={styles.muted}>
            {t("live.signInWhy", "An account lets your team run the same race on several phones. Local races keep working without one.")}
          </p>
          <GoogleButton onToken={(idToken) => void run(() => auth.google(idToken))} />
          <div className={styles.tabs}>
            {(["password", "register", "code"] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? styles.tabActive : styles.tab} onClick={() => setMode(m)}>
                {m === "password" ? t("live.modePassword", "Email + password") : m === "register" ? t("live.modeRegister", "New account") : t("live.modeCode", "Email code")}
              </button>
            ))}
          </div>
          {mode === "register" && (
            <input className={styles.input} dir="auto" placeholder={t("live.name", "Your name")} value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <input className={styles.input} type="email" dir="ltr" placeholder={t("live.email", "Email")} value={email} onChange={(e) => setEmail(e.target.value)} />
          {mode !== "code" && (
            <input className={styles.input} type="password" dir="ltr" placeholder={t("live.password", "Password (8+ characters)")} value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
          {mode === "code" && codeSent && (
            <input className={styles.input} inputMode="numeric" dir="ltr" placeholder={t("live.code", "6-digit code")} value={code} onChange={(e) => setCode(e.target.value)} />
          )}
          {error && <p className={styles.error} dir="auto">{error}</p>}
          {mode === "password" && (
            <button className={styles.button} disabled={busy} onClick={() => run(() => auth.login(email, password))}>{t("live.signIn", "Sign in")}</button>
          )}
          {mode === "register" && (
            <button className={styles.button} disabled={busy} onClick={() => run(() => auth.register(email, password, name))}>{t("live.createAccount", "Create account")}</button>
          )}
          {mode === "code" && !codeSent && (
            <button className={styles.button} disabled={busy} onClick={() => run(async () => { await auth.requestEmailCode(email); setCodeSent(true); })}>
              {t("live.sendCode", "Email me a code")}
            </button>
          )}
          {mode === "code" && codeSent && (
            <button className={styles.button} disabled={busy} onClick={() => run(() => auth.verifyEmailCode(email, code.trim()))}>{t("live.signIn", "Sign in")}</button>
          )}
        </div>
      </div>
    </div>
  );
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
    if (next) navigate(next);
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
