import React, { lazy, Suspense, useState } from "react";
import { Check, Edit2, ExternalLink, Plus, QrCode, X } from "lucide-react";
import styles from "./info.module.css";
import type { RaceProps } from "@/types/types";
import useRaceStore from "@/stores/racesStore";
import { AuditLogService } from "@/services/auditLog/auditLogService";
import { EL_NINO_EVENTS_PREFIX, elNinoUrl, parseElNinoEventId } from "@/utils/elNino";

// The camera screen pulls in the QR decoder; load it only when asked for.
const ElNinoQrScanner = lazy(() => import("./ElNinoQrScanner"));

/**
 * The race's link to El Niño: its home page by default, or the race's event page
 * once an event id is set (typed, pasted as a link, or scanned from a QR).
 */
const ElNinoLink: React.FC<{ race: RaceProps; canEdit: boolean }> = ({ race, canEdit }) => {
  const updateRace = useRaceStore((s) => s.updateRace);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [scanning, setScanning] = useState(false);

  const eventId = parseElNinoEventId(race.elNinoEventId);

  const startEdit = () => {
    setDraft(eventId ?? "");
    setInvalid(false);
    setEditing(true);
  };

  const save = async () => {
    // Empty clears the event: the link goes back to El Niño's home page.
    const next = draft.trim() ? parseElNinoEventId(draft) : "";
    if (next === null) {
      setInvalid(true);
      return;
    }
    await updateRace({ ...race, elNinoEventId: next || null });
    AuditLogService.log({
      race,
      action: "EDIT_RACE",
      screen: "Info",
      entityType: "race",
      entityId: race.uuid,
      before: { elNinoEventId: eventId },
      after: { elNinoEventId: next || null },
    });
    setEditing(false);
  };

  return (
    <section className={styles.evCard}>
      <h3 className={styles.evCardTitle}>
        <img src={`${import.meta.env.BASE_URL}elnino-logo.png`} alt="" width={15} height={15} /> El Niño
      </h3>
      {editing ? (
        <form
          className={styles.rulesForm}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <span className={styles.elNinoPrefix} dir="ltr">{EL_NINO_EVENTS_PREFIX}</span>
          <input
            className={styles.takanonInput}
            type="text"
            dir="ltr"
            autoFocus
            autoComplete="off"
            placeholder="Event ID"
            aria-label="El Niño event ID"
            aria-invalid={invalid}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
            data-testid="el-nino-event-input"
          />
          <button type="button" className={styles.rulesAction} onClick={() => setScanning(true)} data-testid="el-nino-scan">
            <QrCode size={14} aria-hidden="true" /> Scan QR
          </button>
          <button type="submit" className={styles.rulesBtn} aria-label="Save El Niño event" data-testid="el-nino-save">
            <Check size={15} />
          </button>
          <button type="button" className={styles.rulesBtn} aria-label="Cancel" onClick={() => setEditing(false)}>
            <X size={15} />
          </button>
          {invalid && <div className={styles.rulesError} role="alert">That is not an El Niño event ID or link.</div>}
        </form>
      ) : (
        <div className={styles.rulesRow}>
          <a href={elNinoUrl(eventId)} target="_blank" rel="noopener noreferrer" className={styles.takanonLink} data-testid="el-nino-link">
            <ExternalLink size={14} aria-hidden="true" />
            {eventId ? "Open event in El Niño" : "Open El Niño"}
          </a>
          {canEdit && (
            <button type="button" className={styles.rulesAction} onClick={startEdit} data-testid="el-nino-edit">
              {eventId ? <Edit2 size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
              {eventId ? "Edit event" : "Add event"}
            </button>
          )}
        </div>
      )}

      {scanning && (
        <Suspense fallback={null}>
          <ElNinoQrScanner
            onClose={() => setScanning(false)}
            onScan={(id) => {
              setDraft(id);
              setInvalid(false);
              setScanning(false);
            }}
          />
        </Suspense>
      )}
    </section>
  );
};

export default ElNinoLink;
