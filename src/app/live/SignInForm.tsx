import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { auth, LiveApiError, type CodeSent } from "@/services/live/liveClient";
import styles from "./live.module.css";
import own from "./SignInForm.module.css";

/**
 * Signed-out account screen: Sign in, New account, and Forgot password.
 *
 * Forgot password emails a 6-digit code to a REGISTERED address (the server allows
 * 3 a day, 60 s apart) and sets the new password with it, which also signs in.
 */
type Mode = "signin" | "register" | "forgot";

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
  return <div ref={ref} className={own.google} />;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const RESEND_SECONDS = 60;

/** Email field with what mobile keyboards and password managers need. */
function EmailInput(props: { value: string; onChange: (v: string) => void; autoFocus?: boolean; invalid?: boolean }) {
  const { t } = useTranslation();
  return (
    <label className={own.field}>
      <span className={own.label}>{t("live.emailLabel", "Email")}</span>
      <input
        className={styles.input}
        type="email"
        name="email"
        dir="ltr"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t("live.email", "Email")}
        value={props.value}
        autoFocus={props.autoFocus}
        aria-invalid={props.invalid || undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

/** Password field with a show/hide toggle (a typo on a phone keyboard is otherwise invisible). */
function PasswordInput(props: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  name: string;
  invalid?: boolean;
  hint?: string;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <label className={own.field}>
      <span className={own.label}>{props.label}</span>
      <span className={own.passwordWrap}>
        <input
          className={`${styles.input} ${own.passwordInput}`}
          type={shown ? "text" : "password"}
          name={props.name}
          dir="ltr"
          autoComplete={props.autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={props.placeholder}
          value={props.value}
          aria-invalid={props.invalid || undefined}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <button
          type="button"
          className={own.eye}
          aria-label={shown ? t("live.hidePassword", "Hide password") : t("live.showPassword", "Show password")}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.1 6.1C4 7.6 2.5 9.7 2 12c1 2.5 5 7 10 7 1.7 0 3.3-.5 4.6-1.3" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          )}
        </button>
      </span>
      {props.hint && <span className={props.invalid ? own.fieldError : own.hint} dir="auto">{props.hint}</span>}
    </label>
  );
}

export default function SignInForm({ next }: { next: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  // Forgot password
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
    setTried(false);
    setPassword("");
    setPassword2("");
  };

  const run = async (fn: () => Promise<unknown>, onDone?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (onDone) onDone();
      else if (next) navigate(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cleanEmail = email.trim().toLowerCase();
  const emailBad = !EMAIL_RE.test(cleanEmail);
  const passwordShort = password.length < MIN_PASSWORD;
  const mismatch = password !== password2;

  const submitSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (emailBad || !password) return setError(t("live.errFillSignIn", "Enter your email and password."));
    void run(() => auth.login(cleanEmail, password));
  };

  const submitRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!name.trim()) return setError(t("live.errName", "Enter your name."));
    if (emailBad) return setError(t("live.errEmail", "Enter a valid email address."));
    if (passwordShort) return setError(t("live.errPasswordShort", "The password needs at least 8 characters."));
    if (mismatch) return setError(t("live.errMismatch", "The two passwords are not the same."));
    void run(() => auth.register(cleanEmail, password, name.trim()));
  };

  const sendCode = () => {
    setTried(true);
    if (emailBad) return setError(t("live.errEmail", "Enter a valid email address."));
    setInfo(null);
    void run(
      async () => {
        try {
          const r: CodeSent = await auth.requestPasswordReset(cleanEmail);
          setCodeSentTo(cleanEmail);
          setRemaining(r.remainingToday);
          setCooldown(r.resendAfterSeconds || RESEND_SECONDS);
          setInfo(codeSentTo ? t("live.codeResent", "A new code is on its way.") : null);
        } catch (err) {
          if (err instanceof LiveApiError && err.code === "daily_limit") setRemaining(0);
          if (err instanceof LiveApiError && err.code === "too_soon") setCooldown(RESEND_SECONDS);
          throw err;
        }
      },
      () => {},
    );
  };

  const submitReset = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!/^\d{6}$/.test(code.trim())) return setError(t("live.errCode", "Enter the 6-digit code from the email."));
    if (passwordShort) return setError(t("live.errPasswordShort", "The password needs at least 8 characters."));
    if (mismatch) return setError(t("live.errMismatch", "The two passwords are not the same."));
    void run(() => auth.confirmPasswordReset(codeSentTo!, code.trim(), password));
  };

  const errorBox = error && (
    <p className={own.errorBox} role="alert" dir="auto">
      {error}
    </p>
  );

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <button className={styles.link} onClick={() => navigate("/main")}>← {t("live.back", "Back")}</button>
        <div className={`${styles.card} ${own.card}`}>
          {mode !== "forgot" ? (
            <>
              <h1 className={styles.title}>{mode === "signin" ? t("live.welcomeBack", "Sign in") : t("live.createTitle", "Create your account")}</h1>
              <p className={styles.muted}>
                {t("live.signInWhy", "An account lets your team run the same race on several phones. Local races keep working without one.")}
              </p>

              <div className={own.segmented} role="tablist">
                <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? own.segOn : own.seg} onClick={() => switchMode("signin")}>
                  {t("live.tabSignIn", "Sign in")}
                </button>
                <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? own.segOn : own.seg} onClick={() => switchMode("register")}>
                  {t("live.modeRegister", "New account")}
                </button>
              </div>

              <GoogleButton onToken={(idToken) => void run(() => auth.google(idToken))} />
              {import.meta.env.VITE_GOOGLE_CLIENT_ID && <div className={own.or}><span>{t("live.or", "or")}</span></div>}

              {mode === "signin" ? (
                <form className={own.form} onSubmit={submitSignIn} noValidate>
                  <EmailInput value={email} onChange={setEmail} invalid={tried && emailBad} />
                  <PasswordInput
                    name="password"
                    label={t("live.passwordLabel", "Password")}
                    placeholder={t("live.passwordPlain", "Password")}
                    autoComplete="current-password"
                    value={password}
                    onChange={setPassword}
                    invalid={tried && !password}
                  />
                  <button type="button" className={`${styles.link} ${own.forgotLink}`} onClick={() => switchMode("forgot")}>
                    {t("live.forgot", "Forgot password?")}
                  </button>
                  {errorBox}
                  <button type="submit" className={`${styles.button} ${own.submit}`} disabled={busy}>
                    {busy ? t("live.signingIn", "Signing in…") : t("live.signIn", "Sign in")}
                  </button>
                </form>
              ) : (
                <form className={own.form} onSubmit={submitRegister} noValidate>
                  <label className={own.field}>
                    <span className={own.label}>{t("live.nameLabel", "Name")}</span>
                    <input
                      className={styles.input}
                      name="name"
                      dir="auto"
                      autoComplete="name"
                      placeholder={t("live.name", "Your name")}
                      value={name}
                      aria-invalid={(tried && !name.trim()) || undefined}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <EmailInput value={email} onChange={setEmail} invalid={tried && emailBad} />
                  <PasswordInput
                    name="new-password"
                    label={t("live.passwordLabel", "Password")}
                    placeholder={t("live.password", "Password (8+ characters)")}
                    autoComplete="new-password"
                    value={password}
                    onChange={setPassword}
                    invalid={tried && passwordShort}
                    hint={t("live.passwordHint", "At least 8 characters. Tap the eye to check what you typed.")}
                  />
                  <PasswordInput
                    name="confirm-password"
                    label={t("live.repeatLabel", "Repeat password")}
                    placeholder={t("live.repeatPassword", "Repeat password")}
                    autoComplete="new-password"
                    value={password2}
                    onChange={setPassword2}
                    invalid={(tried || !!password2) && mismatch}
                    hint={password2 && mismatch ? t("live.errMismatch", "The two passwords are not the same.") : undefined}
                  />
                  {errorBox}
                  <button type="submit" className={`${styles.button} ${own.submit}`} disabled={busy}>
                    {busy ? t("live.creating", "Creating…") : t("live.createAccount", "Create account")}
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              <h1 className={styles.title}>{t("live.resetTitle", "Reset your password")}</h1>
              {!codeSentTo ? (
                <form className={own.form} onSubmit={(e) => { e.preventDefault(); sendCode(); }} noValidate>
                  <p className={styles.muted}>
                    {t("live.resetIntro", "Enter the email of your account. We'll email you a 6-digit code to set a new password.")}
                  </p>
                  <EmailInput value={email} onChange={setEmail} autoFocus invalid={tried && emailBad} />
                  {errorBox}
                  <button type="submit" className={`${styles.button} ${own.submit}`} disabled={busy}>
                    {busy ? t("live.sending", "Sending…") : t("live.sendCode", "Email me a code")}
                  </button>
                </form>
              ) : (
                <form className={own.form} onSubmit={submitReset} noValidate>
                  <p className={own.sentBox} dir="auto">
                    {t("live.codeSentTo", "We sent a code to")} <b dir="ltr">{codeSentTo}</b>.{" "}
                    {t("live.checkSpam", "It can take a minute — check your spam folder too.")}
                  </p>
                  <label className={own.field}>
                    <span className={own.label}>{t("live.codeLabel", "Code from the email")}</span>
                    <input
                      className={`${styles.input} ${own.code}`}
                      name="one-time-code"
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="••••••"
                      value={code}
                      autoFocus
                      aria-invalid={(tried && !/^\d{6}$/.test(code.trim())) || undefined}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    />
                  </label>
                  {/* Hidden username so password managers save the new password under the right account. */}
                  <input type="email" name="email" autoComplete="username" value={codeSentTo} readOnly hidden />
                  <PasswordInput
                    name="new-password"
                    label={t("live.newPasswordLabel", "New password")}
                    placeholder={t("live.password", "Password (8+ characters)")}
                    autoComplete="new-password"
                    value={password}
                    onChange={setPassword}
                    invalid={tried && passwordShort}
                    hint={t("live.passwordHint", "At least 8 characters. Tap the eye to check what you typed.")}
                  />
                  <PasswordInput
                    name="confirm-password"
                    label={t("live.repeatLabel", "Repeat password")}
                    placeholder={t("live.repeatPassword", "Repeat password")}
                    autoComplete="new-password"
                    value={password2}
                    onChange={setPassword2}
                    invalid={(tried || !!password2) && mismatch}
                    hint={password2 && mismatch ? t("live.errMismatch", "The two passwords are not the same.") : undefined}
                  />
                  {errorBox}
                  {info && !error && <p className={own.infoBox} role="status" dir="auto">{info}</p>}
                  <button type="submit" className={`${styles.button} ${own.submit}`} disabled={busy}>
                    {busy ? t("live.saving", "Saving…") : t("live.setPassword", "Set new password and sign in")}
                  </button>
                  <div className={own.resendRow}>
                    <span className={styles.muted}>{t("live.noCode", "No email?")}</span>
                    <button type="button" className={styles.link} disabled={busy || cooldown > 0 || remaining === 0} onClick={sendCode}>
                      {cooldown > 0
                        ? t("live.resendIn", "Send again in {{s}}s", { s: cooldown })
                        : t("live.resend", "Send again")}
                    </button>
                  </div>
                  {remaining !== null && (
                    <p className={styles.muted} dir="auto">
                      {remaining > 0
                        ? t("live.codesLeft", "{{n}} more code(s) today.", { n: remaining })
                        : t("live.noCodesLeft", "No more codes today — try again tomorrow.")}
                    </p>
                  )}
                  <button type="button" className={styles.link} onClick={() => { setCodeSentTo(null); setCode(""); setError(null); setInfo(null); setRemaining(null); }}>
                    {t("live.otherEmail", "Use a different email")}
                  </button>
                </form>
              )}
              <button type="button" className={`${styles.link} ${own.back}`} onClick={() => { switchMode("signin"); setCodeSentTo(null); setCode(""); setRemaining(null); }}>
                ← {t("live.backToSignIn", "Back to sign in")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
