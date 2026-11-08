import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import own from "./SignInForm.module.css";

/**
 * "Continue with Google" — Google Identity Services, loaded on demand (same approach as
 * El Niño's `auth/google-signin.ts`; Commissaire uses its OWN OAuth client id).
 *
 * Google only answers "who is this person": the ID token goes once to POST /auth/google
 * (server verifies audience/issuer/expiry and keys the account on Google's `sub`), then the
 * app uses Commissaire's own session. The ID token is never stored.
 *
 * Google requires its rendered button for this flow (no custom button). It opens Google's
 * popup, which works in mobile browsers and installed PWAs (iOS shows it as a sheet).
 * Renders nothing when VITE_GOOGLE_CLIENT_ID is not set in the build.
 */

interface GoogleAccounts {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; cancel_on_tap_outside?: boolean; auto_select?: boolean }): void;
      renderButton(el: HTMLElement, o: Record<string, unknown>): void;
      disableAutoSelect(): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";
const SCRIPT_ID = "google-identity-services";
let loader: Promise<GoogleAccounts> | null = null;

export const googleClientId = (): string => import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

/** Loads the Google script once; rejects when offline/blocked so the caller can say so. */
function loadGoogleIdentity(): Promise<GoogleAccounts> {
  if (window.google) return Promise.resolve(window.google);
  loader ??= new Promise<GoogleAccounts>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => (window.google ? resolve(window.google) : reject(new Error("init"))));
    script.addEventListener("error", () => {
      loader = null;
      reject(new Error("unreachable"));
    });
    if (!existing) document.head.appendChild(script);
  });
  return loader;
}

/** Stops Google from silently re-signing someone in after a deliberate sign-out. */
export function forgetGoogleSession(): void {
  window.google?.accounts.id.disableAutoSelect();
}

export default function GoogleSignInButton({ onToken }: { onToken: (idToken: string) => void }) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [failed, setFailed] = useState(false);
  const clientId = googleClientId();

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        if (cancelled || !ref.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (r) => r.credential && onTokenRef.current(r.credential),
          cancel_on_tap_outside: true,
        });
        // Full card width (Google caps it at 400 px), so it's the obvious first choice.
        const width = Math.min(400, Math.max(240, Math.floor(ref.current.getBoundingClientRect().width || 320)));
        google.accounts.id.renderButton(ref.current, {
          type: "standard",
          theme: "filled_blue",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          width,
          locale: i18n.language,
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clientId, i18n.language]);

  if (!clientId) return null;
  return (
    <>
      <div ref={ref} className={own.google} data-testid="google-signin" />
      {failed && (
        <p className={own.reasonBox} role="alert" dir="auto">
          {t("live.googleUnavailable", "Google sign-in can't be reached right now. Check the connection, or use email and password.")}
        </p>
      )}
    </>
  );
}
