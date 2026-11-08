/**
 * Invite Judges (0.3.2) — the owner's one-tap way to let other judges WORK in this race.
 * Kept apart from the public results link (PublicShareButton): this one grants access.
 *
 * Reuses the existing Team machinery only:
 *  - POST /races/:id/invitations  { link, roles } → a secret, expiring, revocable link
 *    (/invite/<secret>). Opening it needs sign-in (Google or email) and an explicit Accept;
 *    it grants this race only, as a member — never ownership or admin (delegation rules).
 *  - PUT /races/:id/member-writes { enabled: true } → owner-only, audited switch so the
 *    accepted judges can record (without it members only view).
 *  - Remove (DELETE member) and Stop link (DELETE invitation) revoke access.
 * Roles = the race operations a judge needs: start waves, check-in, live laps / undo.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Copy, Link2, Loader2, Share2, UserMinus, UserPlus, X } from "lucide-react";
import { team, useLiveStore, type Member } from "@/services/live/liveClient";
import { isLiveRace, LIVE_ACCESS_EVENT } from "@/services/live/liveBridge";
import { UploadPrompt } from "./RaceServerAction";
import styles from "./shareRace.module.css";

export const JUDGE_ROLES = ["start", "counter", "checkin"] as const;
const LINK_DAYS = 7;
const LINK_USES = 50;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function InviteJudges({ raceUuid, raceName }: { raceUuid: string; raceName: string }) {
  const isOwner = useLiveStore((s) => !!s.access[raceUuid]?.isOwner);
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener(LIVE_ACCESS_EVENT, on);
    return () => window.removeEventListener(LIVE_ACCESS_EVENT, on);
  }, []);
  const [open, setOpen] = useState(false);
  const linked = isLiveRace(raceUuid);
  // Shared race: owner only. Local race: its device owner (upload first, inside the modal).
  if (linked && !isOwner) return null;

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} data-testid="invite-judges-btn">
        <UserPlus size={14} aria-hidden="true" /> Invite Judges
      </button>
      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="invite-judges-title" onClick={(e) => e.stopPropagation()} data-testid="invite-judges-modal">
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            <h3 id="invite-judges-title" className={styles.title} dir="auto">Invite judges to “{raceName}”</h3>
            {linked ? (
              <JudgeLinkPanel raceUuid={raceUuid} raceName={raceName} />
            ) : (
              <UploadPrompt
                raceUuid={raceUuid}
                title="Race not uploaded yet"
                message="To invite judges, first upload the race to the server."
                onUploaded={() => tick((n) => n + 1)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function JudgeLinkPanel({ raceUuid, raceName }: { raceUuid: string; raceName: string }) {
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      const r = await team.members(raceUuid);
      setMembers(r.members.filter((m) => !m.isOwner && !m.revokedAt));
    } catch (e) {
      setError(errText(e));
    }
  }, [raceUuid]);
  useEffect(() => void loadMembers(), [loadMembers]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await team.invite(raceUuid, { link: true, maxUses: LINK_USES, roles: [...JUDGE_ROLES], expiresInDays: LINK_DAYS, sendEmail: false });
      await team.setMemberWrites(raceUuid, true); // judges may record in THIS race (owner-only, audited)
      const inv = r.invitations[0];
      if (!inv) throw new Error("The server did not return a link");
      setLink({ id: inv.id, url: inv.url });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const text = `Judge "${raceName}" with me on Commissaire:`;
  const share = async () => {
    if (!link) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: raceName, text, url: link.url });
        return;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${link.url}`)}`, "_blank", "noopener");
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success("Link copied");
    } catch {
      (document.getElementById("judge-link-url") as HTMLInputElement | null)?.select();
    }
  };
  const stopLink = async () => {
    if (!link) return;
    try {
      await team.revokeInvitation(raceUuid, link.id);
      setLink(null);
      toast.success("Link stopped — it can't be used any more");
    } catch (e) {
      setError(errText(e));
    }
  };
  const remove = async (m: Member) => {
    try {
      await team.removeMember(raceUuid, m.userId);
      await loadMembers();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <>
      <p style={{ margin: 0 }} dir="auto">
        Judges who open this link sign in (Google or email), accept, and can work in RACE and LIVE of this race only.
        The link works for {LINK_DAYS} days.
      </p>
      {error && <p role="alert" style={{ margin: 0, color: "var(--danger, #dc2626)" }} dir="auto">{error}</p>}
      {!link ? (
        <button type="button" className={styles.trigger} style={{ margin: 0, minHeight: 44, justifyContent: "center" }} onClick={() => void create()} disabled={busy} data-testid="judge-link-create">
          {busy ? <Loader2 size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />} Create judge link
        </button>
      ) : (
        <>
          <input id="judge-link-url" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} data-testid="judge-link-url"
            style={{ width: "100%", minHeight: 40, padding: "0 10px", borderRadius: 6, border: "1px solid var(--border-card)", background: "var(--bg-surface-2, transparent)", color: "inherit" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className={styles.trigger} style={{ margin: 0, flex: 1, minHeight: 44, justifyContent: "center" }} onClick={() => void share()} data-testid="judge-link-share">
              <Share2 size={16} aria-hidden="true" /> Share
            </button>
            <button type="button" className={styles.trigger} style={{ margin: 0, flex: 1, minHeight: 44, justifyContent: "center" }} onClick={() => void copy()} data-testid="judge-link-copy">
              <Copy size={16} aria-hidden="true" /> Copy link
            </button>
          </div>
          <button type="button" className={styles.trigger} style={{ margin: 0, alignSelf: "flex-start" }} onClick={() => void stopLink()} data-testid="judge-link-stop">
            Stop this link
          </button>
        </>
      )}
      <div>
        <strong>Judges in this race</strong>
        {members === null ? null : members.length === 0 ? (
          <p style={{ margin: "4px 0 0" }}>No judges yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "flex", flexDirection: "column", gap: 6 }} data-testid="judge-list">
            {members.map((m) => (
              <li key={m.userId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }} dir="auto">{m.name}{m.email ? ` · ${m.email}` : ""}</span>
                <button type="button" className={styles.trigger} style={{ margin: 0 }} onClick={() => void remove(m)} aria-label={`Remove ${m.name}`} data-testid="judge-remove">
                  <UserMinus size={14} aria-hidden="true" /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
