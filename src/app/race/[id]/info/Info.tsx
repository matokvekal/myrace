import React, { useRef, useState } from "react";
import styles from "./info.module.css";
import { RaceProps } from "@/types/types";
import Icons from "@/constants/Icons";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import useRaceStore from "@/stores/racesStore";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { Edit2, Check, X, ExternalLink, Download, Upload } from "lucide-react";
import { exportRaceToXlsx } from "@/utils/raceExport";
import { importRaceFromXlsx, replaceCategoriesForRace } from "@/utils/raceImport";
import { toast } from "react-toastify";
import RaceMap from "@/components/map/RaceMap";

interface Props {
  race: RaceProps;
  onDeleteRace?: () => Promise<void>;
}

type EditForm = Pick<
  RaceProps,
  "name" | "date" | "time" | "location" | "distance" | "type" | "level" |
  "orgenizer" | "manager" | "phone" | "site" | "takanon"
>;

const Info: React.FC<Props> = ({ race, onDeleteRace }) => {
  const [showDeleteRace, setShowDeleteRace] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<EditForm>({} as EditForm);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const updateRace = useRaceStore((s) => s.updateRace);
  const { riders, deleteRidersByRace, insertRiders } = useRiderStore();
  const { categories } = useCategoryStore();

  const handleExport = () => {
    const raceRiders = riders.filter((r) => r.raceUuid === race.uuid);
    const raceCats = categories.filter((c) => c.raceUuid === race.uuid);
    exportRaceToXlsx(race, raceCats, raceRiders);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const data = await importRaceFromXlsx(file);
      const catCount = data.categories.length;
      const riderCount = data.riders.length;
      const ok = window.confirm(
        `Import "${data.raceName}"?\n${catCount} categories, ${riderCount} riders.\n\nThis will REPLACE all current riders and categories for this race.`
      );
      if (!ok) return;

      // Remap to current race UUID (supports cross-device import)
      const remappedCats = data.categories.map((c) => ({ ...c, raceUuid: race.uuid }));
      const remappedRiders = data.riders.map((r) => ({ ...r, raceUuid: race.uuid }));

      await deleteRidersByRace(race.uuid);
      await replaceCategoriesForRace(race.uuid, remappedCats);
      // Sync Zustand: replace categories in memory
      useCategoryStore.setState((s) => ({
        categories: [
          ...s.categories.filter((c) => c.raceUuid !== race.uuid),
          ...remappedCats,
        ],
      }));
      await insertRiders(remappedRiders);

      toast.success(`Imported ${riderCount} riders across ${catCount} categories`);
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setImporting(false);
    }
  };

  const openEdit = () => {
    setForm({
      name: race.name ?? "",
      date: race.date ?? "",
      time: race.time ?? "",
      location: race.location ?? "",
      distance: race.distance ?? 0,
      type: race.type ?? "",
      level: race.level ?? "",
      orgenizer: race.orgenizer ?? "",
      manager: race.manager ?? "",
      phone: race.phone ?? "",
      site: race.site ?? "",
      takanon: race.takanon ?? "",
    });
    setEditMode(true);
  };

  const handleSave = async () => {
    await updateRace({ ...race, ...form });
    setEditMode(false);
  };

  const handleCancel = () => setEditMode(false);

  const set = (field: keyof EditForm, value: string | number) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className={styles.container}>
      {/* Edit / Save / Cancel bar */}
      <div className={styles.editBar}>
        {!editMode ? (
          <button className={styles.editBarBtn} onClick={openEdit}>
            <Edit2 size={14} />
            Edit Race Info
          </button>
        ) : (
          <>
            <button className={styles.cancelBarBtn} onClick={handleCancel}>
              <X size={14} /> Cancel
            </button>
            <button className={styles.saveBarBtn} onClick={handleSave}>
              <Check size={14} /> Save
            </button>
          </>
        )}
      </div>

      {editMode ? (
        /* ── EDIT FORM ── */
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Race Details</div>
            <FormRow label="Name">
              <input className={styles.formInput} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </FormRow>
            <FormRow label="Date">
              <input className={styles.formInput} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </FormRow>
            <FormRow label="Start time">
              <input className={styles.formInput} type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
            </FormRow>
            <FormRow label="Location">
              <input className={styles.formInput} value={form.location} onChange={(e) => set("location", e.target.value)} />
            </FormRow>
            <FormRow label="Distance (km)">
              <input className={styles.formInput} type="number" min="0" value={form.distance} onChange={(e) => set("distance", parseFloat(e.target.value) || 0)} />
            </FormRow>
            <FormRow label="Type">
              <input className={styles.formInput} value={form.type} onChange={(e) => set("type", e.target.value)} />
            </FormRow>
            <FormRow label="Level">
              <input className={styles.formInput} value={form.level} onChange={(e) => set("level", e.target.value)} />
            </FormRow>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Organisation</div>
            <FormRow label="Organiser">
              <input className={styles.formInput} value={form.orgenizer} onChange={(e) => set("orgenizer", e.target.value)} />
            </FormRow>
            <FormRow label="Manager">
              <input className={styles.formInput} value={form.manager} onChange={(e) => set("manager", e.target.value)} />
            </FormRow>
            <FormRow label="Phone">
              <input className={styles.formInput} type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </FormRow>
            <FormRow label="Website">
              <input className={styles.formInput} type="url" placeholder="https://" value={form.site} onChange={(e) => set("site", e.target.value)} />
            </FormRow>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Rules / תקנון</div>
            <FormRow label="URL">
              <input className={styles.formInput} type="url" placeholder="https://…" value={form.takanon} onChange={(e) => set("takanon", e.target.value)} />
            </FormRow>
          </div>
        </>
      ) : (
        /* ── VIEW MODE ── */
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Race Details</div>
            <Row icon={Icons.calander} label="Date"     value={race.date} />
            <Row icon={Icons.time}     label="Start"    value={race.time} />
            <Row icon={Icons.earth}    label="Location" value={race.location} />
            <Row icon={Icons.road}     label="Distance" value={race.distance ? `${race.distance} km` : "—"} />
            <Row icon={Icons.setting}  label="Type"     value={race.type} />
            <Row icon={Icons.setting}  label="Level"    value={race.level} />
          </div>

          <RaceMap location={race.location} />

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Organisation</div>
            <Row icon={Icons.rider1}   label="Organiser" value={race.orgenizer} />
            <Row icon={Icons.rider1}   label="Manager"   value={race.manager} />
            <Row icon={Icons.mainMsg}  label="Phone"     value={race.phone} />
            {race.site && <Row icon={Icons.earth} label="Website" value={race.site} />}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Rules / תקנון</div>
            {race.takanon ? (
              <a href={race.takanon} target="_blank" rel="noopener noreferrer" className={styles.takanonLink}>
                <ExternalLink size={14} />
                View Rules Document
              </a>
            ) : (
              <div className={styles.takanonEmpty}>No rules document — tap Edit to add a link</div>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Status</div>
            <div className={`${styles.statusBadge} ${styles[race.status ?? "upcoming"]}`}>
              {race.status ?? "upcoming"}
            </div>
          </div>
        </>
      )}

      {/* ── Export / Import ── */}
      <div className={styles.dataSection}>
        <div className={styles.dataSectionTitle}>Data Transfer</div>
        <div className={styles.dataBody}>
          <div className={styles.dataText}>
            Export all race data (riders, categories, lap results) to Excel so another device can import and continue the race.
          </div>
          <div className={styles.dataButtons}>
            <button className={styles.exportBtn} onClick={handleExport}>
              <Download size={14} />
              Export to Excel
            </button>
            <button
              className={styles.importBtn}
              onClick={() => importRef.current?.click()}
              disabled={importing}
            >
              <Upload size={14} />
              {importing ? "Importing…" : "Import from Excel"}
            </button>
          </div>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleImportFile}
        />
      </div>

      {onDeleteRace && (
        <div className={styles.dangerZone}>
          <div className={styles.dangerTitle}>Danger Zone</div>
          <div className={styles.dangerBody}>
            <div className={styles.dangerText}>
              Permanently delete this race, all its riders, and all categories. This cannot be undone.
            </div>
            <button className={styles.deleteRaceBtn} onClick={() => setShowDeleteRace(true)}>
              🗑 Delete Race
            </button>
          </div>
        </div>
      )}

      {showDeleteRace && onDeleteRace && (
        <DeleteConfirmModal
          title={`Delete "${race.name}"`}
          description="This will permanently delete the race and all associated riders, categories, and data. This cannot be undone."
          onConfirm={async () => { await onDeleteRace(); setShowDeleteRace(false); }}
          onCancel={() => setShowDeleteRace(false)}
        />
      )}
    </div>
  );
};

const Row: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <div className={styles.row}>
    <img src={icon} alt="" width={16} height={16} className={styles.rowIcon} />
    <span className={styles.rowLabel}>{label}</span>
    <span className={styles.rowValue}>{value || "—"}</span>
  </div>
);

const FormRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className={styles.formRow}>
    <span className={styles.formLabel}>{label}</span>
    <div className={styles.formField}>{children}</div>
  </div>
);

export default Info;
