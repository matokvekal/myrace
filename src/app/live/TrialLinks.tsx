/**
 * Info → server panel (race owner): Quick Trial Access links. A link lets a NEW judge
 * try this race without registering — whoever opens it gets a temporary judge account
 * for this race only (start, counter, check-in, results by default; never admin).
 *
 * Two separate expiries, both shown: until when the LINK can be opened, and until when
 * the trial judges it created may work. Revoking a link ends its trials at once.
 * The link's secret is returned only when it is created, so it is shown only then.
 * Shown ONLY to the trial-link issuer (TRIAL_LINK_ISSUER) on races it owns; the server
 * enforces the same (verified email + ownership) and answers 403 to anyone else.
 * Renders nothing when the server has the feature off.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { Copy, FlaskConical, Loader2, Share2, XCircle } from "lucide-react";
import { trial, useLiveStore, type TrialLink } from "@/services/live/liveClient";
import { trialUntilText } from "./TrialPage";
import styles from "./raceServerAction.module.css";

type Defaults = Awaited<ReturnType<typeof trial.links>>["defaults"];

/** The only account that may create trial links (the server checks it too, against a verified email). */
export const TRIAL_LINK_ISSUER = "mictavim@gmail.com";
export const isTrialLinkIssuer = (email: string | null | undefined) => (email ?? "").trim().toLowerCase() === TRIAL_LINK_ISSUER;

export default function TrialLinks({ raceUuid }: { raceUuid: string }) {
  const email = useLiveStore((s) => s.user?.email);
  const isOwner = useLiveStore((s) => !!s.access[raceUuid]?.isOwner);
  // Nothing at all for anyone else — not even a request.
  if (!isOwner || !isTrialLinkIssuer(email)) return null;
  return <TrialLinksPanel raceUuid={raceUuid} />;
}

function TrialLinksPanel({ raceUuid }: { raceUuid: string }) {
  const { t } = useTranslation();
  const memberWrites = useLiveStore((s) => s.access[raceUuid]?.memberWrites);
  const [links, setLinks] = useState<TrialLink[] | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  const [opts, setOpts] = useState<{ maxUses: number; linkExpiresInDays: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await trial.links(raceUuid);
      setLinks(r.links);
      setDefaults(r.defaults);
      setOpts((o) => o ?? { maxUses: r.defaults.maxUses, linkExpiresInDays: r.defaults.linkExpiresInDays });
    } catch {
      setAvailable(false); // feature off, not the owner, or offline: show nothing
    }
  }, [raceUuid]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!available || !links || !defaults || !opts) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const l = await trial.create(raceUuid, opts);
      setFresh({ id: l.id, url: l.url });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    if (!window.confirm(t("trialLinks.revokeConfirm", "Withdraw this link? Trial judges who opened it lose access now. What they recorded stays."))) return;
    try {
      const r = await trial.revoke(raceUuid, id);
      if (fresh?.id === id) setFresh(null);
      toast.success(t("trialLinks.revoked", "Link withdrawn. {{n}} trial judge(s) ended.", { n: r.endedUsers }), { toastId: `trial-revoke-${id}` });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("trialLinks.copied", "Link copied"), { toastId: "trial-copy" });
    } catch {
      window.prompt(t("trialLinks.copyManual", "Copy the link:"), url);
    }
  };
  const share = async (url: string) => {
    try {
      await navigator.share({ title: t("trialLinks.shareTitle", "Try judging this race"), url });
    } catch {
      /* cancelled */
    }
  };
  const statusText = (l: TrialLink) =>
    l.status === "valid"
      ? t("trialLinks.statusValid", "Open until {{when}}", { when: trialUntilText(l.expiresAt) })
      : l.status === "used"
        ? t("trialLinks.statusUsed", "All uses taken")
        : l.status === "expired"
          ? t("trialLinks.statusExpired", "Link expired")
          : t("trialLinks.statusRevoked", "Withdrawn");
  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
  };

  return (
    <div className={styles.share} data-testid="trial-links">
      <div className={styles.shareHead}>
        <span className={styles.shareLabel}>
          <FlaskConical size={13} aria-hidden="true" /> {t("trialLinks.title", "Quick Trial Access")}
        </span>
      </div>
      <p className={styles.note} dir="auto">
        {t("trialLinks.help", "A link for a new judge to try this race without registering. Whoever opens it gets a temporary judge account for this race only — anyone with the link can use it, so share it only with people you trust.")}
      </p>
      {memberWrites === false && (
        <p className={styles.note} dir="auto" data-testid="trial-links-writes-off">
          {t("trialLinks.writesOff", "\"Judges can record in this race\" is off (Team): trial judges can view but not record until you turn it on.")}
        </p>
      )}

      <details>
        <summary className={styles.note}>{t("trialLinks.options", "Options")}</summary>
        <div className={styles.shareActions} style={{ marginTop: 8 }}>
          <label className={styles.note}>
            {t("trialLinks.maxUses", "People per link")}{" "}
            <input type="number" min={1} max={500} value={opts.maxUses} style={{ width: 64 }}
              onChange={(e) => setOpts({ ...opts, maxUses: num(e.target.value, 1, 500, defaults.maxUses) })} />
          </label>
          <label className={styles.note}>
            {t("trialLinks.linkDays", "Link open for (days)")}{" "}
            <input type="number" min={1} max={90} value={opts.linkExpiresInDays} style={{ width: 64 }}
              onChange={(e) => setOpts({ ...opts, linkExpiresInDays: num(e.target.value, 1, 90, defaults.linkExpiresInDays) })} />
          </label>
        </div>
      </details>

      <div className={styles.shareActions}>
        <button type="button" className={styles.btnPrimary} onClick={() => void create()} disabled={busy} data-testid="trial-link-create">
          {busy ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : <FlaskConical size={15} aria-hidden="true" />}
          {t("trialLinks.create", "Create trial link")}
        </button>
      </div>

      {fresh && (
        <>
          <input className={styles.url} readOnly value={fresh.url} dir="ltr" aria-label={t("trialLinks.urlLabel", "Trial link")} data-testid="trial-link-url"
            onFocus={(e) => e.currentTarget.select()} />
          <div className={styles.shareActions}>
            <button type="button" className={styles.btnSecondary} onClick={() => void copy(fresh.url)}>
              <Copy size={15} aria-hidden="true" /> {t("trialLinks.copy", "Copy")}
            </button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <button type="button" className={styles.btnSecondary} onClick={() => void share(fresh.url)}>
                <Share2 size={15} aria-hidden="true" /> {t("trialLinks.share", "Share")}
              </button>
            )}
          </div>
          <p className={styles.note} dir="auto">{t("trialLinks.onlyNow", "Copy it now — for security the link is shown only once.")}</p>
        </>
      )}

      {error && <p className={styles.error} role="alert" dir="auto">{error}</p>}

      {links.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {links.map((l) => (
            <li key={l.id} className={styles.shareHead} data-testid="trial-link-row" data-status={l.status}>
              <span className={styles.note} dir="auto">
                <span className={styles.status} data-on={l.status === "valid" ? "true" : "false"}>{statusText(l)}</span>
                {" · "}
                {t("trialLinks.uses", "{{used}}/{{max}} used", { used: l.useCount, max: l.maxUses })}
                {" · "}
                {t("trialLinks.active", "{{n}} active", { n: l.activeUsers })}
                {" · "}
                {t("trialLinks.access24h", "24 h per judge from opening")}
              </span>
              {l.status !== "revoked" && (
                <button type="button" className={styles.btnSecondary} onClick={() => void revoke(l.id)} data-testid="trial-link-revoke">
                  <XCircle size={15} aria-hidden="true" /> {t("trialLinks.revoke", "Withdraw")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
