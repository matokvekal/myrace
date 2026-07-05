/**
 * Cloud tab for a race: Google login, upload to cloud, invite users by
 * email + role, sync status. Everything is optional — a race that never
 * touches this screen keeps working fully local.
 */

import React, { useCallback, useEffect, useState } from "react";
import styles from "./raceCloudPanel.module.css";
import Button from "@/components/ui/Button";
import { Cloud, CloudOff, LogIn, LogOut, RefreshCw, Users } from "lucide-react";
import type { RaceProps } from "@/types/types";
import type { RaceRole, RaceUserEntry } from "@/types/cloud.types";
import { useCloudStore } from "@/stores/cloudStore";
import { isCloudConfigured } from "@/services/cloud/supabaseClient";
import { useRacePermission } from "@/hooks/useRacePermission";
import { getPendingEventsFromDb } from "@/stores/indexDb/indexedDbHelper";
import {
   inviteUserToRace,
   listRaceUsers,
   pushPendingEvents,
   removeRaceUser,
   uploadRaceToCloud,
} from "@/services/cloud/cloudSync";

const INVITE_ROLES: RaceRole[] = [
   "ADMIN",
   "MANAGER",
   "RIDER_MANAGER",
   "CHECKIN",
   "FINISH_JUDGE",
   "VIEWER",
];

interface Props {
   race: RaceProps;
}

const RaceCloudPanel: React.FC<Props> = ({ race }) => {
   const user = useCloudStore((s) => s.user);
   const syncState = useCloudStore((s) => s.syncState);
   const link = useCloudStore((s) => s.links[race.uuid] ?? null);
   const signInWithGoogle = useCloudStore((s) => s.signInWithGoogle);
   const signOut = useCloudStore((s) => s.signOut);
   const { can, role } = useRacePermission(race.uuid);

   const [busy, setBusy] = useState(false);
   const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
   const [raceUsers, setRaceUsers] = useState<RaceUserEntry[]>([]);
   const [inviteEmail, setInviteEmail] = useState("");
   const [inviteRole, setInviteRole] = useState<RaceRole>("VIEWER");
   const [pendingCount, setPendingCount] = useState(0);

   useEffect(() => {
      useCloudStore.getState().init();
   }, []);

   const refreshUsers = useCallback(async () => {
      if (link && user) setRaceUsers(await listRaceUsers(race.uuid));
   }, [link, user, race.uuid]);

   useEffect(() => {
      void refreshUsers();
   }, [refreshUsers]);

   useEffect(() => {
      getPendingEventsFromDb(race.uuid).then((events) =>
         setPendingCount(events.length)
      );
   }, [race.uuid, syncState]);

   if (!isCloudConfigured()) {
      return (
         <div className={styles.panel}>
            <div className={styles.card}>
               <div className={styles.cardTitle}>
                  <CloudOff size={18} /> Cloud sync is not configured
               </div>
               <div className={styles.muted} dir="auto">
                  Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local
                  to enable sharing races between commissaires. The app keeps
                  working fully offline without it.
               </div>
            </div>
         </div>
      );
   }

   const handleUpload = async () => {
      setBusy(true);
      setMessage(null);
      const result = await uploadRaceToCloud(race);
      setMessage(
         result.ok
            ? { text: link ? "Cloud copy updated" : "Race uploaded to cloud", ok: true }
            : { text: result.error ?? "Upload failed", ok: false }
      );
      setBusy(false);
      void refreshUsers();
   };

   const handleInvite = async () => {
      if (!inviteEmail.trim()) return;
      setBusy(true);
      setMessage(null);
      const result = await inviteUserToRace(race.uuid, inviteEmail, inviteRole);
      setMessage(
         result.ok
            ? { text: `Invited ${inviteEmail.trim()} as ${inviteRole}`, ok: true }
            : { text: result.error ?? "Invite failed", ok: false }
      );
      if (result.ok) setInviteEmail("");
      setBusy(false);
      void refreshUsers();
   };

   const handleRemove = async (entry: RaceUserEntry) => {
      const result = await removeRaceUser(race.uuid, entry.id);
      if (!result.ok) setMessage({ text: result.error ?? "Remove failed", ok: false });
      void refreshUsers();
   };

   const statusClass =
      syncState === "syncing"
         ? styles.statusSyncing
         : syncState === "offline"
           ? styles.statusOffline
           : syncState === "error"
             ? styles.statusError
             : styles.statusIdle;

   const statusText =
      syncState === "syncing"
         ? "Syncing…"
         : syncState === "offline"
           ? `Offline${pendingCount ? ` — ${pendingCount} saved locally` : ""}`
           : syncState === "error"
             ? "Sync error"
             : pendingCount
               ? `${pendingCount} waiting to sync`
               : "Up to date";

   return (
      <div className={styles.panel}>
         {/* Account */}
         <div className={styles.card}>
            <div className={styles.cardTitle}>
               <Cloud size={18} /> Cloud account
            </div>
            {user ? (
               <div className={styles.row}>
                  <div className={styles.userLine}>
                     <span className={styles.userEmail} dir="auto">
                        {user.displayName || user.email}
                     </span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => void signOut()}>
                     <LogOut size={14} /> Sign out
                  </Button>
               </div>
            ) : (
               <div className={styles.row}>
                  <div className={styles.muted} dir="auto">
                     Login with Google to upload this race and share it with
                     other commissaires.
                  </div>
                  <Button
                     variant="primary"
                     size="sm"
                     onClick={async () => {
                        const { error } = await signInWithGoogle();
                        if (error) setMessage({ text: error, ok: false });
                     }}
                  >
                     <LogIn size={14} /> Sign in with Google
                  </Button>
               </div>
            )}
         </div>

         {/* Race sync */}
         {user && (
            <div className={styles.card}>
               <div className={styles.row}>
                  <div className={styles.cardTitle}>
                     <RefreshCw size={18} /> Race sync
                  </div>
                  <span className={`${styles.statusBadge} ${statusClass}`}>
                     {statusText}
                  </span>
               </div>
               {link ? (
                  <div className={styles.row}>
                     <span className={styles.roleBadge}>{role ?? "…"}</span>
                     {can("EDIT_RACE") && (
                        <Button
                           variant="secondary"
                           size="sm"
                           onClick={handleUpload}
                           disabled={busy}
                        >
                           Update cloud copy
                        </Button>
                     )}
                     {pendingCount > 0 && (
                        <Button
                           variant="secondary"
                           size="sm"
                           onClick={() => void pushPendingEvents(race.uuid)}
                           disabled={busy}
                        >
                           Sync now
                        </Button>
                     )}
                  </div>
               ) : (
                  <div className={styles.row}>
                     <div className={styles.muted} dir="auto">
                        This race is local only. Upload it to share with your
                        team.
                     </div>
                     <Button
                        variant="primary"
                        size="sm"
                        onClick={handleUpload}
                        disabled={busy}
                     >
                        Upload race to cloud
                     </Button>
                  </div>
               )}
            </div>
         )}

         {/* Race users */}
         {user && link && can("MANAGE_USERS") && (
            <div className={styles.card}>
               <div className={styles.cardTitle}>
                  <Users size={18} /> Race users
               </div>
               <div className={styles.inviteForm}>
                  <input
                     className={styles.input}
                     type="email"
                     placeholder="email@example.com"
                     value={inviteEmail}
                     onChange={(e) => setInviteEmail(e.target.value)}
                     dir="auto"
                  />
                  <select
                     className={styles.select}
                     value={inviteRole}
                     onChange={(e) => setInviteRole(e.target.value as RaceRole)}
                  >
                     {INVITE_ROLES.map((r) => (
                        <option key={r} value={r}>
                           {r}
                        </option>
                     ))}
                  </select>
                  <Button
                     variant="success"
                     size="sm"
                     onClick={handleInvite}
                     disabled={busy || !inviteEmail.trim()}
                  >
                     Invite
                  </Button>
               </div>
               <div className={styles.usersList}>
                  {raceUsers.map((entry) => (
                     <div key={entry.id} className={styles.userRow}>
                        <span className={styles.userEmail} dir="auto">
                           {entry.email}
                        </span>
                        <span className={styles.roleBadge}>{entry.role}</span>
                        {entry.role !== "CREATOR" && (
                           <button
                              className={styles.removeBtn}
                              onClick={() => void handleRemove(entry)}
                           >
                              Remove
                           </button>
                        )}
                     </div>
                  ))}
                  {raceUsers.length === 0 && (
                     <div className={styles.muted}>No users yet.</div>
                  )}
               </div>
            </div>
         )}

         {message && (
            <div className={message.ok ? styles.success : styles.error} dir="auto">
               {message.text}
            </div>
         )}
      </div>
   );
};

export default RaceCloudPanel;
