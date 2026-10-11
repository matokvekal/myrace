"use client";

import { useState } from "react";
import type { RiderProps } from "@/types/types";
import Images from "@/constants/Images";
import useRiderStore from "@/stores/ridersStore";
import { useRaceFinalized } from "@/utils/raceLock";
import { recordRaceEvent } from "@/services/cloud/raceEvents";
import styles from "./riderDetailModal.module.css";
import { X, Edit2, Save, XCircle, User, Lock } from "lucide-react";

interface Props {
  rider: RiderProps;
  onClose: () => void;
  /** Wave number to show (derived from the schedule, so it is read-only here). */
  wave?: number | null;
  /** Open straight into edit mode. */
  startInEdit?: boolean;
}

const EDITABLE_STATUSES: { value: RiderProps["status"]; label: string }[] = [
  { value: "standing", label: "Active" },
  { value: "DNS", label: "DNS" },
  { value: "DNF", label: "DNF" },
  { value: "DSQ", label: "DSQ" },
];

const STATUS_COLOR: Record<string, string> = {
  upcoming: "#63a6fc",
  running: "#3edda4",
  finished: "#aab8cc"
};

const RACE_STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  running: "Running",
  finished: "Finished"
};

export default function RiderDetailModal({ rider, onClose, wave, startInEdit = false }: Props) {
  const [editMode, setEditMode] = useState(startInEdit);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<RiderProps["status"]>(rider.status);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: rider.firstName ?? "",
    lastName: rider.lastName ?? "",
    bibNumber: String(rider.bibNumber ?? ""),
    category: rider.category ?? "",
    subCategory: rider.subCategory ?? "",
    team: rider.team ?? "",
    heat: String(rider.heat ?? ""),
    timeStartRace: rider.timeStartRace ?? "",
    totalLaps: String(rider.totalLaps ?? ""),
    points: String(rider.points ?? ""),
    federation: rider.federation ?? "",
    comment: rider.comment ?? "",
    chipNumber: rider.chipNumber ?? ""
  });

  const updateRider = useRiderStore((s) => s.updateRider);
  const allRiders = useRiderStore((s) => s.riders);
  // The modal opens from Riders, Results and Standing alike, so it asks about
  // the lock itself rather than making three callers remember to pass it down.
  // Without this the Save button would look like it worked while the store
  // silently dropped the write (utils/raceLock.ts).
  const finalized = useRaceFinalized(rider.raceUuid);

  const avatar =
    rider.image?.startsWith("data:") || rider.image?.startsWith("http")
      ? rider.image
      : Images.user;

  // A dead image URL must fall back to the placeholder icon, not the broken-image
  // alt text (BUGS.md #5).
  const [avatarFailed, setAvatarFailed] = useState(false);

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    // Same bib rules as Check-in's bib edit: a positive whole number that no
    // other rider in this race already wears.
    const bib = Number(form.bibNumber);
    if (!form.bibNumber.trim() || !Number.isInteger(bib) || bib <= 0) {
      setError("Enter a valid bib number");
      return;
    }
    if (!form.firstName.trim() && !form.lastName.trim()) {
      setError("Enter a first or last name");
      return;
    }
    const clash = allRiders.find((r) => r.raceUuid === rider.raceUuid && r.id !== rider.id && r.bibNumber === bib);
    if (clash) {
      setError(`Bib ${bib} is already used by ${clash.lastName} ${clash.firstName}`);
      return;
    }
    setError("");
    setSaving(true);
    const isOut = ["DNF", "DSQ", "DNS"].includes(status);
    // Mirror the live screen: an out-status takes a running rider off the board.
    // Clearing one on a rider who never rode puts them back to "upcoming".
    const raceStatus =
      isOut && rider.raceStatus === "running"
        ? "finished"
        : !isOut && rider.raceStatus === "finished" && (rider.lapsCounter ?? 0) === 0
          ? "upcoming"
          : rider.raceStatus;
    await updateRider({
      ...rider,
      status,
      raceStatus,
      firstName: form.firstName,
      lastName: form.lastName,
      bibNumber: bib,
      category: form.category,
      subCategory: form.subCategory || null,
      team: form.team || null,
      heat: parseInt(form.heat) || rider.heat,
      timeStartRace: form.timeStartRace || null,
      totalLaps: parseInt(form.totalLaps) || rider.totalLaps,
      points: form.points ? parseFloat(form.points) : null,
      federation: form.federation || null,
      comment: form.comment || null,
      chipNumber: form.chipNumber || undefined
    });
    void recordRaceEvent({
      raceUuid: rider.raceUuid,
      riderId: rider.id,
      bibNumber: bib,
      eventType: "RIDER_EDITED",
      payload: {
        riderLocalId: rider.id,
        riderPatch: { firstName: form.firstName, lastName: form.lastName, bibNumber: bib, status, raceStatus },
        previousBib: rider.bibNumber,
      },
    });
    setSaving(false);
    setEditMode(false);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className={styles.header}>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
          {finalized ? (
            <span className={styles.lockedTag} data-testid="rider-modal-locked">
              <Lock size={13} /> Final
            </span>
          ) : !editMode ? (
            <button className={styles.editBtn} onClick={() => setEditMode(true)}>
              <Edit2 size={14} /> Edit
            </button>
          ) : (
            <div className={styles.editActions}>
              <button className={styles.cancelBtn} onClick={() => { setEditMode(false); setError(""); setStatus(rider.status); setForm({ firstName: rider.firstName ?? "", lastName: rider.lastName ?? "", bibNumber: String(rider.bibNumber ?? ""), category: rider.category ?? "", subCategory: rider.subCategory ?? "", team: rider.team ?? "", heat: String(rider.heat ?? ""), timeStartRace: rider.timeStartRace ?? "", totalLaps: String(rider.totalLaps ?? ""), points: String(rider.points ?? ""), federation: rider.federation ?? "", comment: rider.comment ?? "", chipNumber: rider.chipNumber ?? "" }); }}>
                <XCircle size={14} /> Cancel
              </button>
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                <Save size={14} /> {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>

        {/* Avatar + identity */}
        <div className={styles.hero}>
          <div className={styles.avatarWrap}>
            {rider.image && !avatarFailed ? (
              <img
                src={avatar}
                alt=""
                className={styles.avatar}
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <div className={styles.avatarPlaceholder}>
                <User size={34} color="#aac0df" />
              </div>
            )}
            <div
              className={styles.colorDot}
              style={{ background: rider.color ?? "#ccc" }}
            />
          </div>

          <div className={styles.bibBadge}>#{rider.bibNumber}</div>

          {editMode ? (
            <div className={styles.nameEdit}>
              <input className={styles.input} value={form.firstName} onChange={e => set("firstName", e.target.value)} placeholder="First name" />
              <input className={styles.input} value={form.lastName} onChange={e => set("lastName", e.target.value)} placeholder="Last name" />
            </div>
          ) : (
            <div className={styles.name}>
              {rider.firstName} {rider.lastName}
            </div>
          )}

          <div
            className={styles.statusBadge}
            style={{ background: STATUS_COLOR[rider.raceStatus ?? "upcoming"] + "22", color: STATUS_COLOR[rider.raceStatus ?? "upcoming"] }}
          >
            {rider.raceStatus === "running" && <span className={styles.dot} />}
            {RACE_STATUS_LABEL[rider.raceStatus ?? "upcoming"]}
          </div>
        </div>

        {error && <div className={styles.formError} role="alert" data-testid="rider-modal-error">{error}</div>}

        {/* Data grid */}
        <div className={styles.grid}>

          <Field label="Bib #" editMode={editMode}
            view={<strong>#{rider.bibNumber}</strong>}
            edit={<input className={styles.input} value={form.bibNumber} onChange={e => set("bibNumber", e.target.value)} type="number" />}
          />

          <Field label="Category" editMode={editMode}
            view={<span>{rider.category}{rider.subCategory ? ` · ${rider.subCategory}` : ""}</span>}
            edit={
              // Sub-category is legacy — only editable on riders that already
              // have one. New races use one flat category per age band (BUGS.md #2).
              rider.subCategory ? (
                <div className={styles.twoCol}>
                  <input className={styles.input} value={form.category} onChange={e => set("category", e.target.value)} placeholder="Category" />
                  <input className={styles.input} value={form.subCategory} onChange={e => set("subCategory", e.target.value)} placeholder="Sub-category" />
                </div>
              ) : (
                <input className={styles.input} value={form.category} onChange={e => set("category", e.target.value)} placeholder="Category" />
              )
            }
          />

          <Field label="Team / Club" editMode={editMode}
            view={<span>{rider.team || "—"}</span>}
            edit={<input className={styles.input} value={form.team} onChange={e => set("team", e.target.value)} placeholder="Team" />}
          />

          <Field label="Status" editMode={editMode}
            view={<span data-testid="rider-modal-status">{EDITABLE_STATUSES.find((o) => o.value === rider.status)?.label ?? "Active"}</span>}
            edit={
              <select className={styles.input} value={EDITABLE_STATUSES.some((o) => o.value === status) ? status : "standing"} onChange={(e) => setStatus(e.target.value as RiderProps["status"])} data-testid="rider-modal-status-select">
                {EDITABLE_STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            }
          />

          <Field label="Wave" editMode={false}
            view={<span>{wave ?? rider.heat ?? "—"}</span>}
            edit={null}
          />

          <Field label="Heat" editMode={editMode}
            view={<span>{rider.heat || "—"}</span>}
            edit={<input className={styles.input} value={form.heat} onChange={e => set("heat", e.target.value)} type="number" />}
          />

          <Field label="Start Time" editMode={editMode}
            view={<span>{rider.timeStartRace || "—"}</span>}
            edit={<input className={styles.input} value={form.timeStartRace} onChange={e => set("timeStartRace", e.target.value)} placeholder="HH:MM" />}
          />

          <Field label="Laps" editMode={editMode}
            view={<span>{rider.lapsCounter} / {rider.totalLaps}</span>}
            edit={<input className={styles.input} value={form.totalLaps} onChange={e => set("totalLaps", e.target.value)} type="number" placeholder="Total laps" />}
          />

          {(rider.points != null || editMode) && (
            <Field label="Points" editMode={editMode}
              view={<span>{rider.points ?? "—"}</span>}
              edit={<input className={styles.input} value={form.points} onChange={e => set("points", e.target.value)} type="number" />}
            />
          )}

          {(rider.federation || editMode) && (
            <Field label="Federation" editMode={editMode}
              view={<span>{rider.federation || "—"}</span>}
              edit={<input className={styles.input} value={form.federation} onChange={e => set("federation", e.target.value)} />}
            />
          )}

          {(rider.chipNumber || editMode) && (
            <Field label="Chip #" editMode={editMode}
              view={<span>{rider.chipNumber || "—"}</span>}
              edit={<input className={styles.input} value={form.chipNumber} onChange={e => set("chipNumber", e.target.value)} />}
            />
          )}

          {rider.uciNumber && (
            <Field label="UCI Number" editMode={false}
              view={<span dir="auto">{rider.uciNumber}</span>} edit={null} />
          )}

          {rider.uciPoints != null && (
            <Field label="UCI Points" editMode={false}
              view={<span>{rider.uciPoints}</span>} edit={null} />
          )}

          {(rider.position_start != null || rider.position_category > 0) && (
            <Field label="Position" editMode={false}
              view={<span>{rider.raceStatus === "upcoming" ? `Start: ${rider.position_start ?? "—"}` : `Cat: ${rider.position_category}`}</span>}
              edit={null}
            />
          )}

          {(rider.comment || editMode) && (
            <div className={styles.fieldFull}>
              <div className={styles.fieldLabel}>Comment</div>
              {editMode
                ? <textarea className={`${styles.input} ${styles.textarea}`} value={form.comment} onChange={e => set("comment", e.target.value)} rows={2} />
                : <div className={styles.fieldValue}>{rider.comment || "—"}</div>
              }
            </div>
          )}

          {/* Reference-only imported columns — shown but not used (BUGS.md #A) */}
          {rider.extraFields && Object.keys(rider.extraFields).length > 0 && (
            <div className={styles.fieldFull}>
              <div className={styles.fieldLabel}>More info</div>
              <div className={styles.extraGrid}>
                {Object.entries(rider.extraFields).map(([label, value]) => (
                  <div key={label} className={styles.extraRow}>
                    <span className={styles.extraKey}>{label}</span>
                    <span className={styles.extraVal} dir="auto">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function Field({ label, editMode, view, edit }: {
  label: string;
  editMode: boolean;
  view: React.ReactNode;
  edit: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.fieldValue}>{editMode ? edit : view}</div>
    </div>
  );
}
