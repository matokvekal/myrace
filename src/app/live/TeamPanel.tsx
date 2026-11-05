import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isLiveRace } from "@/services/live/liveBridge";
import {
  accessFor,
  detachRace,
  directory,
  publishRace,
  team,
  useLiveStore,
  type Member,
} from "@/services/live/liveClient";
import { OPERATIONS, SCREENS, type MemberPermissions, type Screen } from "../../shared/race/access";
import { MEMBER_ROLES, type MemberRole } from "../../shared/race/roles";
import useCategoryStore from "@/stores/categoryStore";
import styles from "./live.module.css";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Race → Team: share the race, manage members, roles, screens and waves, and invite. */
export default function TeamPanel({ raceUuid }: { raceUuid: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useLiveStore((s) => s.user);
  const access = useLiveStore((s) => s.access[raceUuid]) ?? accessFor(raceUuid);
  const [linked, setLinked] = useState(isLiveRace(raceUuid));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <div className={styles.card}>
        <h2 className={styles.subtitle}>{t("live.teamTitle", "Team")}</h2>
        <p className={styles.muted}>{t("live.teamSignIn", "Sign in to share this race with other commissaires.")}</p>
        <button className={styles.button} onClick={() => navigate(`/account?next=${encodeURIComponent(`/race/${raceUuid}`)}`)}>{t("live.signIn", "Sign in")}</button>
      </div>
    );
  }

  if (!linked) {
    return (
      <div className={styles.card}>
        <h2 className={styles.subtitle}>{t("live.shareTitle", "Share this race")}</h2>
        <p className={styles.muted}>
          {t("live.shareWhy", "Sharing uploads the race, categories and start list (no phone, email or ID numbers) so your team can work on it from their phones. Share before the first wave starts.")}
        </p>
        {error && <p className={styles.error} dir="auto">{error}</p>}
        <button
          className={styles.button}
          disabled={busy}
          data-testid="publish-race"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await publishRace(raceUuid);
              setLinked(true);
            } catch (e) {
              setError(msg(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("live.share", "Share race")}
        </button>
      </div>
    );
  }

  const canManage = !!access?.screens.team.update;
  return (
    <div className={styles.inner} style={{ maxWidth: "none" }}>
      {canManage ? <Members raceUuid={raceUuid} /> : (
        <div className={styles.card}>
          <h2 className={styles.subtitle}>{t("live.teamTitle", "Team")}</h2>
          <p className={styles.muted} dir="auto">
            {t("live.yourRoles", "Your roles")}: {access?.isOwner ? t("live.roleOwner", "owner") : access?.roles.join(", ") || t("live.roleViewer", "viewer")}
            {access?.waves ? ` · ${t("live.waves", "waves")} ${access.waves.join(", ")}` : ""}
          </p>
        </div>
      )}
      {canManage && <Invite raceUuid={raceUuid} />}
      <div className={styles.card}>
        <button
          className={styles.danger}
          onClick={() => {
            if (window.confirm(t("live.detachConfirm", "Stop syncing this race on this phone? Your local copy and anything still waiting to be sent stay here."))) {
              detachRace(raceUuid);
              setLinked(false);
            }
          }}
        >
          {t("live.detach", "Work offline on this phone (stop syncing)")}
        </button>
      </div>
    </div>
  );
}

function Members({ raceUuid }: { raceUuid: string }) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<Member[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => team.members(raceUuid).then((r) => setMembers(r.members)).catch((e) => setError(msg(e)));
  useEffect(() => {
    void load();
  }, [raceUuid]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.card}>
      <h2 className={styles.subtitle}>{t("live.members", "Members")}</h2>
      {error && <p className={styles.error} dir="auto">{error}</p>}
      <ul className={styles.list}>
        {members.filter((m) => !m.revokedAt).map((m) => (
          <li key={m.userId} className={styles.item}>
            <div className={styles.spread}>
              <div>
                <strong dir="auto">{m.name}</strong> <span className={styles.muted} dir="ltr">{m.email}</span>
              </div>
              <span className={styles.badge}>
                {m.isOwner ? t("live.roleOwner", "owner") : m.roles.join(", ") || t("live.noRoles", "no roles")}
                {m.permissions.waves ? ` · ${t("live.waves", "waves")} ${m.permissions.waves.join(",")}` : ""}
              </span>
            </div>
            {!m.isOwner && editing !== m.userId && (
              <div className={styles.row}>
                <button className={styles.secondary} onClick={() => setEditing(m.userId)}>{t("live.editAccess", "Edit access")}</button>
                <button
                  className={styles.danger}
                  onClick={async () => {
                    if (!window.confirm(t("live.removeConfirm", "Remove {{name}} from this race?", { name: m.name }))) return;
                    try {
                      await team.removeMember(raceUuid, m.userId);
                      await load();
                    } catch (e) {
                      setError(msg(e));
                    }
                  }}
                >
                  {t("live.remove", "Remove")}
                </button>
              </div>
            )}
            {editing === m.userId && (
              <AccessEditor
                raceUuid={raceUuid}
                initialRoles={m.roles}
                initialPermissions={m.permissions}
                onCancel={() => setEditing(null)}
                onSave={async (roles, permissions) => {
                  try {
                    await team.updateMember(raceUuid, m.userId, { roles, permissions });
                    setEditing(null);
                    await load();
                  } catch (e) {
                    setError(msg(e));
                  }
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROLE_LABEL = (t: (k: string, d: string) => string): Record<MemberRole, string> => ({
  admin: t("live.roleAdmin", "Admin"),
  start: t("live.roleStart", "Start"),
  counter: t("live.roleCounter", "Laps (counter)"),
  checkin: t("live.roleCheckin", "Check-in"),
  viewer: t("live.roleViewerTitle", "Viewer (read-only)"),
});

/** English defaults for the permission grid (other languages come from the locale files). */
const SCREEN_LABEL: Record<Screen, string> = {
  info: "Info", map: "Map", schedule: "Schedule", categories: "Categories", riders: "Riders", results: "Results",
  start: "Start", checkin: "Check-In", board: "Board", status: "Status", live: "Live (laps)", team: "Team", settings: "Settings",
};
const OP_LABEL: Record<(typeof OPERATIONS)[number], string> = { view: "View", create: "Create", update: "Edit", delete: "Delete" };

/** Roles, waves and per-screen overrides for one member (or an invitation). */
function AccessEditor({
  raceUuid,
  initialRoles,
  initialPermissions,
  onSave,
  onCancel,
  saveLabel,
}: {
  raceUuid: string;
  initialRoles: MemberRole[];
  initialPermissions: MemberPermissions;
  onSave: (roles: MemberRole[], permissions: MemberPermissions) => void;
  onCancel?: () => void;
  saveLabel?: string;
}) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<MemberRole[]>(initialRoles);
  const [waves, setWaves] = useState<number[] | null>(initialPermissions.waves ?? null);
  const [screens, setScreens] = useState<MemberPermissions["screens"]>(initialPermissions.screens ?? {});
  const [showScreens, setShowScreens] = useState(!!initialPermissions.screens && Object.keys(initialPermissions.screens).length > 0);
  const categories = useCategoryStore((s) => s.categories);
  const allWaves = useMemo(
    () => [...new Set(categories.filter((c) => c.raceUuid === raceUuid && c.heat != null).map((c) => c.heat as number))].sort((a, b) => a - b),
    [categories, raceUuid],
  );
  const labels = ROLE_LABEL(t);

  const toggleRole = (r: MemberRole) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const toggleWave = (w: number) =>
    setWaves((cur) => {
      const list = cur ?? [];
      const next = list.includes(w) ? list.filter((x) => x !== w) : [...list, w].sort((a, b) => a - b);
      return next.length ? next : null;
    });
  const setOp = (screen: Screen, op: (typeof OPERATIONS)[number], value: boolean | undefined) =>
    setScreens((cur) => {
      const next = { ...(cur ?? {}) };
      const s = { ...(next[screen] ?? {}) };
      if (value === undefined) delete s[op];
      else s[op] = value;
      if (Object.keys(s).length) next[screen] = s;
      else delete next[screen];
      return next;
    });

  return (
    <div className={styles.item}>
      <span className={styles.muted}>{t("live.roles", "Roles (any combination)")}</span>
      <div className={styles.row}>
        {MEMBER_ROLES.map((r) => (
          <button key={r} className={roles.includes(r) ? styles.chipOn : styles.chip} onClick={() => toggleRole(r)}>{labels[r]}</button>
        ))}
      </div>
      <span className={styles.muted}>{t("live.wavesAccess", "Waves (none selected = all waves)")}</span>
      <div className={styles.row}>
        {allWaves.map((w) => (
          <button key={w} className={waves?.includes(w) ? styles.chipOn : styles.chip} onClick={() => toggleWave(w)}>
            {t("live.wave", "Wave")} {w}
          </button>
        ))}
      </div>
      <button className={styles.link} onClick={() => setShowScreens((v) => !v)}>
        {showScreens ? "▾" : "▸"} {t("live.screensAccess", "Screens: override what the roles allow")}
      </button>
      {showScreens && (
        <div className={styles.grid}>
          <span />
          {OPERATIONS.map((op) => <span key={op} className={styles.gridHead}>{t(`live.op.${op}`, OP_LABEL[op])}</span>)}
          {SCREENS.map((s) => (
            <React.Fragment key={s}>
              <span>{t(`live.screen.${s}`, SCREEN_LABEL[s])}</span>
              {OPERATIONS.map((op) => {
                const v = screens?.[s]?.[op];
                // Three states: default (from roles) → allow → deny → default
                const next = v === undefined ? true : v ? false : undefined;
                return (
                  <button key={op} className={v === undefined ? styles.chip : v ? styles.chipOn : styles.chip} title={v === undefined ? "default" : v ? "allow" : "deny"} onClick={() => setOp(s, op, next)}>
                    {v === undefined ? "·" : v ? "✓" : "✕"}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}
      <div className={styles.row}>
        <button
          className={styles.button}
          onClick={() => onSave(roles, { ...(screens && Object.keys(screens).length ? { screens } : {}), ...(waves ? { waves } : {}) })}
        >
          {saveLabel ?? t("live.save", "Save")}
        </button>
        {onCancel && <button className={styles.secondary} onClick={onCancel}>{t("live.cancel", "Cancel")}</button>}
      </div>
    </div>
  );
}

function Invite({ raceUuid }: { raceUuid: string }) {
  const { t } = useTranslation();
  const [emails, setEmails] = useState("");
  const [groups, setGroups] = useState<{ id: string; name: string; contactIds: string[] }[]>([]);
  const [contacts, setContacts] = useState<{ id: string; name: string; email: string | null }[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [link, setLink] = useState<{ url: string; qrSvg: string } | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");

  const loadDirectory = () => {
    directory.groups().then((r) => setGroups(r.groups)).catch(() => {});
    directory.contacts().then((r) => setContacts(r.contacts)).catch(() => {});
  };
  useEffect(loadDirectory, []);

  const send = async (roles: MemberRole[], permissions: MemberPermissions, asLink: boolean) => {
    setError(null);
    try {
      const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
      const r = await team.invite(raceUuid, { emails: asLink ? [] : list, groupIds: asLink ? [] : groupIds, contactIds: asLink ? [] : contactIds, link: asLink, maxUses: asLink ? 20 : 1, roles, permissions });
      if (asLink) {
        const l = r.invitations.find((i) => i.link);
        if (l) setLink({ url: l.url, qrSvg: l.qrSvg });
      } else {
        setSent(r.invitations.length);
        // Remember new addresses in the directory for next time.
        for (const e of list) await directory.addContact("", e).catch(() => {});
        setEmails("");
        loadDirectory();
      }
    } catch (e) {
      setError(msg(e));
    }
  };

  return (
    <div className={styles.card}>
      <h2 className={styles.subtitle}>{t("live.invite", "Invite commissaires")}</h2>
      <textarea className={styles.textarea} dir="ltr" placeholder={t("live.inviteEmails", "Email addresses (comma or new line)")} value={emails} onChange={(e) => setEmails(e.target.value)} />
      {groups.length > 0 && (
        <>
          <span className={styles.muted}>{t("live.fromGroups", "From your groups")}</span>
          <div className={styles.row}>
            {groups.map((g) => (
              <button key={g.id} className={groupIds.includes(g.id) ? styles.chipOn : styles.chip}
                onClick={() => setGroupIds((cur) => (cur.includes(g.id) ? cur.filter((x) => x !== g.id) : [...cur, g.id]))} dir="auto">
                {g.name} ({g.contactIds.length})
              </button>
            ))}
          </div>
        </>
      )}
      {contacts.length > 0 && (
        <>
          <span className={styles.muted}>{t("live.fromContacts", "From your directory")}</span>
          <div className={styles.row}>
            {contacts.map((c) => (
              <button key={c.id} className={contactIds.includes(c.id) ? styles.chipOn : styles.chip}
                onClick={() => setContactIds((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))} dir="auto">
                {c.name || c.email}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className={styles.error} dir="auto">{error}</p>}
      {sent !== null && <p className={styles.muted}>{t("live.invitesSent", "{{n}} invitation(s) sent", { n: sent })}</p>}
      <AccessEditor raceUuid={raceUuid} initialRoles={["counter"]} initialPermissions={{}} saveLabel={t("live.sendInvites", "Send invitations")} onSave={(r, p) => void send(r, p, false)} />
      <AccessEditor raceUuid={raceUuid} initialRoles={["viewer"]} initialPermissions={{}} saveLabel={t("live.makeLink", "Create link + QR")} onSave={(r, p) => void send(r, p, true)} />
      {link && (
        <div className={styles.item}>
          <div className={styles.qr} dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
          <input className={styles.input} dir="ltr" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          <button className={styles.secondary} onClick={() => void navigator.clipboard?.writeText(link.url)}>{t("live.copy", "Copy link")}</button>
        </div>
      )}
      <div className={styles.row}>
        <input className={styles.input} style={{ flex: 1 }} dir="auto" placeholder={t("live.newGroup", "New group, e.g. Federation A")} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
        <button
          className={styles.secondary}
          disabled={!newGroup.trim() || contactIds.length === 0}
          onClick={async () => {
            try {
              const { group } = await directory.addGroup(newGroup.trim());
              await directory.setGroupContacts(group.id, contactIds);
              setNewGroup("");
              loadDirectory();
            } catch (e) {
              setError(msg(e));
            }
          }}
        >
          {t("live.saveGroup", "Save selected as group")}
        </button>
      </div>
    </div>
  );
}
