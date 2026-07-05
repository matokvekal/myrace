/**
 * "Shared with me" section for the main page.
 *
 * Shows cloud races the logged-in user was invited to and lets them
 * download a local copy. Renders nothing when Supabase is not configured,
 * so the local-only experience is unchanged.
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./raceCloudPanel.module.css";
import Button from "@/components/ui/Button";
import { Cloud, Download, LogIn } from "lucide-react";
import { useCloudStore } from "@/stores/cloudStore";
import { isCloudConfigured } from "@/services/cloud/supabaseClient";
import { downloadRaceFromCloud } from "@/services/cloud/cloudSync";
import useRaceStore from "@/stores/racesStore";

const CloudRacesSection: React.FC = () => {
   const navigate = useNavigate();
   const user = useCloudStore((s) => s.user);
   const myCloudRaces = useCloudStore((s) => s.myCloudRaces);
   const links = useCloudStore((s) => s.links);
   const signInWithGoogle = useCloudStore((s) => s.signInWithGoogle);
   const refreshMyRoles = useCloudStore((s) => s.refreshMyRoles);
   const races = useRaceStore((s) => s.races);
   const [busyId, setBusyId] = useState<string | null>(null);
   const [error, setError] = useState<string | null>(null);

   useEffect(() => {
      if (!isCloudConfigured()) return;
      useCloudStore.getState().init();
      if (user) void refreshMyRoles();
   }, [user, refreshMyRoles]);

   if (!isCloudConfigured()) return null;

   // races already on this device (linked or same local uuid)
   const linkedCloudIds = new Set(Object.values(links).map((l) => l.cloudId));
   const localUuids = new Set(races.map((r) => r.uuid));
   const downloadable = myCloudRaces.filter(
      (r) =>
         !linkedCloudIds.has(r.cloudId) &&
         !(r.localId && localUuids.has(r.localId))
   );

   if (user && downloadable.length === 0) return null;

   const handleDownload = async (cloudId: string) => {
      const race = myCloudRaces.find((r) => r.cloudId === cloudId);
      if (!race) return;
      setBusyId(cloudId);
      setError(null);
      const result = await downloadRaceFromCloud(cloudId, race.myRole);
      setBusyId(null);
      if (result.ok && result.localId) {
         navigate(`/race/${result.localId}`);
      } else {
         setError(result.error ?? "Download failed");
      }
   };

   return (
      <div className={styles.card} style={{ margin: "0 16px 16px" }}>
         <div className={styles.cardTitle}>
            <Cloud size={18} /> Shared with me
         </div>
         {!user ? (
            <div className={styles.row}>
               <div className={styles.muted} dir="auto">
                  Sign in with Google to see races shared with you.
               </div>
               <Button
                  variant="primary"
                  size="sm"
                  onClick={async () => {
                     const { error: e } = await signInWithGoogle();
                     if (e) setError(e);
                  }}
               >
                  <LogIn size={14} /> Sign in
               </Button>
            </div>
         ) : (
            <div className={styles.usersList}>
               {downloadable.map((race) => (
                  <div key={race.cloudId} className={styles.userRow}>
                     <span className={styles.userEmail} dir="auto">
                        {race.name}
                        {race.raceDate ? ` — ${race.raceDate}` : ""}
                     </span>
                     <span className={styles.roleBadge}>{race.myRole}</span>
                     <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleDownload(race.cloudId)}
                        disabled={busyId === race.cloudId}
                     >
                        <Download size={14} />
                        {busyId === race.cloudId ? "Downloading…" : "Download"}
                     </Button>
                  </div>
               ))}
            </div>
         )}
         {error && (
            <div className={styles.error} dir="auto">
               {error}
            </div>
         )}
      </div>
   );
};

export default CloudRacesSection;
