import React, { useState, useMemo, useEffect, useRef } from "react";
import styles from "./editRiders.module.css";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";
import { CategoryProps, RiderProps } from "@/types/types";
import CategoryManager from "../../components/categoryManager/CategoryManager";
import { AuditLogService } from "@/services/auditLog/auditLogService";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import { riderDeletionBlock, riderLabel } from "@/utils/riderDeletion";
import { normalizeColor } from "@/utils/bibColors";
import { isValidUciId, normalizeUciId } from "@/utils/uciId";
import { toast } from "react-toastify";

interface Props {
  raceUuid: string;
  categories: CategoryProps[];
  onBack?: () => void;
}

interface FormState {
  bibNumber: string;
  firstName: string;
  lastName: string;
  category: string;
  subCategory: string | null;
  categoryColor: string;
  heat: string;
  team: string;
  chipNumber: string;
  /** Optional 11-digit UCI ID. */
  uciNumber: string;
  /** Per-rider bib colour overrides (empty = the category's). */
  bibColor: string;
  bibTextColor: string;
}

interface ParsedRow {
  bibNumber: number;
  firstName: string;
  lastName: string;
  category: string;
  subCategory?: string | null;
  team: string;
  heat: number;
  totalLaps: number;
  position_start: number;
}

function emptyForm(cats: CategoryProps[]): FormState {
  return {
    bibNumber: "",
    firstName: "",
    lastName: "",
    category: cats[0]?.name ?? "",
    subCategory: cats[0]?.subCategory ?? null,
    categoryColor: cats[0]?.color ?? "#63A6FC",
    heat: String(cats[0]?.heat ?? 1),
    team: "",
    chipNumber: "",
    uciNumber: "",
    bibColor: "",
    bibTextColor: ""
  };
}

function riderToForm(r: RiderProps): FormState {
  return {
    bibNumber: String(r.bibNumber),
    firstName: r.firstName,
    lastName: r.lastName,
    category: r.category,
    subCategory: r.subCategory ?? null,
    categoryColor: r.color ?? "#63A6FC",
    heat: String(r.heat),
    team: r.team ?? "",
    chipNumber: r.chipNumber ?? "",
    uciNumber: r.uciNumber ?? "",
    bibColor: r.bibColor ?? "",
    bibTextColor: r.bibTextColor ?? ""
  };
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  return lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const cols = line.split(",").map((c) => c.trim());
      return {
        bibNumber: parseInt(cols[idx("bib")] ?? "0") || 0,
        firstName: cols[idx("first name")] ?? "",
        lastName: cols[idx("last name")] ?? "",
        category: cols[idx("category")] ?? "",
        // Sub-categories are no longer imported — categories are flat, one per
        // age band (BUGS.md #2). Legacy rows keep rendering theirs.
        subCategory: null,
        team: cols[idx("team")] ?? "",
        heat: parseInt(cols[idx("heat")] ?? "1") || 1,
        totalLaps: parseInt(cols[idx("laps")] ?? "0") || 0,
        position_start: parseInt(cols[idx("position")] ?? "0") || 0
      };
    });
}

const EditRiders: React.FC<Props> = ({ raceUuid, categories, onBack }) => {
  const {
    riders,
    getRiders,
    addNewRider,
    updateRider,
    deleteRider,
    insertRiders
  } = useRiderStore();
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(categories));
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [importPreview, setImportPreview] = useState<ParsedRow[] | null>(null);
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getRiders(raceUuid);
  }, [raceUuid, getRiders]);

  const raceRiders = useMemo(
    () => riders.filter((r) => r.raceUuid === raceUuid),
    [riders, raceUuid]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return raceRiders;
    return raceRiders.filter(
      (r) =>
        r.firstName.toLowerCase().includes(q) ||
        r.lastName.toLowerCase().includes(q) ||
        String(r.bibNumber).includes(q)
    );
  }, [raceRiders, search]);

  const waves = useMemo(
    () =>
      [
        ...new Set(
          categories.map((c) => c.heat).filter((h): h is number => h != null)
        )
      ].sort((a, b) => a - b),
    [categories]
  );

  // ─ Form helpers ────────────────────────────────────────────────
  const setF = (k: keyof FormState, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const startAdd = () => {
    setEditingId(null);
    setForm(emptyForm(categories));
    setAddingNew(true);
  };

  const startEdit = (rider: RiderProps) => {
    setAddingNew(false);
    setForm(riderToForm(rider));
    setEditingId(rider.id);
  };

  const cancelForm = () => {
    setAddingNew(false);
    setEditingId(null);
  };

  const saveForm = async () => {
    if (!form.bibNumber || !form.firstName || !form.lastName) return;
    // UCI ID: optional, 11 digits (spaces/dashes ignored). Bib colours: a name or #RRGGBB, or empty.
    const uci = normalizeUciId(form.uciNumber);
    if (!isValidUciId(uci)) {
      toast.error("UCI ID must be 11 digits (or empty).");
      return;
    }
    const bibColor = normalizeColor(form.bibColor);
    const bibTextColor = normalizeColor(form.bibTextColor);
    if ((form.bibColor.trim() && !bibColor) || (form.bibTextColor.trim() && !bibTextColor)) {
      toast.error("Bib color not recognised — use a colour name or #RRGGBB.");
      return;
    }
    const extras = { uciNumber: uci, bibColor, bibTextColor };

    if (addingNew) {
      const cat = categories.find(
        (c) => c.name === form.category && c.subCategory === form.subCategory
      );
      const heat = parseInt(form.heat) || 1;
      const existing = raceRiders.filter(
        (r) =>
          r.category === form.category && r.subCategory === form.subCategory
      );
      const newRider: RiderProps = {
        id: Date.now() + Math.random(),
        raceUuid,
        bibNumber: parseInt(form.bibNumber),
        firstName: form.firstName,
        lastName: form.lastName,
        category: form.category,
        subCategory: form.subCategory,
        heat,
        color: form.categoryColor,
        totalLaps: cat?.laps ?? 0,
        checked: false,
        distance: null,
        elapsedLastLap: null,
        elapsedTimeFromStart: null,
        timeStartRace: null,
        timeArrive: null,
        flag: null,
        lapsCounter: 0,
        lapsDetails: [],
        position_start: existing.length + 1,
        position_category: 0,
        position_race: 0,
        raceStatus: "upcoming",
        status: "standing",
        viewOrder: 0,
        image: null,
        comment: null,
        team: form.team || null,
        chipNumber: form.chipNumber || undefined,
        ...extras
      };
      await addNewRider(newRider);
      if (race) {
        AuditLogService.log({
          race,
          action: "ADD_RIDER",
          screen: "EditRiders",
          entityType: "rider",
          entityId: newRider.bibNumber,
          after: { firstName: newRider.firstName, lastName: newRider.lastName, category: newRider.category },
        });
      }
    } else if (editingId != null) {
      const existing = raceRiders.find((r) => r.id === editingId);
      if (!existing) return;
      const cat = categories.find(
        (c) => c.name === form.category && c.subCategory === form.subCategory
      );
      const updatedRider = {
        ...existing,
        bibNumber: parseInt(form.bibNumber),
        firstName: form.firstName,
        lastName: form.lastName,
        category: form.category,
        subCategory: form.subCategory,
        heat: parseInt(form.heat) || existing.heat,
        color: form.categoryColor,
        team: form.team || null,
        chipNumber: form.chipNumber || undefined,
        ...extras
      };
      await updateRider(updatedRider);
      if (race) {
        AuditLogService.log({
          race,
          action: "EDIT_RIDER",
          screen: "EditRiders",
          entityType: "rider",
          entityId: existing.bibNumber,
          before: { firstName: existing.firstName, lastName: existing.lastName, category: existing.category },
          after: { firstName: updatedRider.firstName, lastName: updatedRider.lastName, category: updatedRider.category },
        });
      }
    }
    cancelForm();
  };

  // ─ CSV import ──────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target?.result as string);
        if (rows.length === 0) {
          setImportError("No valid rows found in file.");
          return;
        }
        setImportPreview(rows);
      } catch {
        setImportError("Failed to parse file.");
      }
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const confirmImport = async () => {
    if (!importPreview) return;

    // Auto-create missing categories
    const { default: useCategoryStore } =
      await import("@/stores/categoryStore");
    const { COLORS } = await import("@/constants/index");
    const existingCats = useCategoryStore
      .getState()
      .categories.filter((c) => c.raceUuid === raceUuid);

    const uniqueCategories = Array.from(
      new Set(
        importPreview.map((row) =>
          row.subCategory ? `${row.category}::${row.subCategory}` : row.category
        )
      )
    );

    for (const catKey of uniqueCategories) {
      const [name, subCategory] = catKey.includes("::")
        ? catKey.split("::")
        : [catKey, null];

      const exists = existingCats.some(
        (c) => c.name === name && c.subCategory === subCategory
      );

      if (!exists) {
        const colorIndex = existingCats.length % COLORS.length;
        const newCat: CategoryProps = {
          id: Date.now() + existingCats.length,
          raceUuid,
          name,
          subCategory: subCategory || null,
          laps: 5,
          lapsCounter: 0,
          riders: 0,
          startTime: null,
          isConnected: false,
          color: COLORS[colorIndex].code,
          heat: 1,
          status: "upcoming"
        };
        await useCategoryStore.getState().updateCategory(newCat);
        existingCats.push(newCat);
      }
    }

    const now = Date.now();
    const newRiders: RiderProps[] = importPreview.map((row, i) => {
      const cat = existingCats.find(
        (c) => c.name === row.category && c.subCategory === row.subCategory
      );
      return {
        id: now + i,
        raceUuid,
        bibNumber: row.bibNumber,
        firstName: row.firstName,
        lastName: row.lastName,
        category: row.category,
        subCategory: row.subCategory ?? null,
        heat: row.heat,
        color: cat?.color ?? "#63A6FC",
        totalLaps: row.totalLaps || cat?.laps || 0,
        checked: false,
        distance: null,
        elapsedLastLap: null,
        elapsedTimeFromStart: null,
        timeStartRace: null,
        timeArrive: null,
        flag: null,
        lapsCounter: 0,
        lapsDetails: [],
        position_start: row.position_start,
        position_category: 0,
        position_race: 0,
        raceStatus: "upcoming",
        status: "standing",
        viewOrder: 0,
        image: null,
        comment: null,
        team: row.team || null
      };
    });
    await insertRiders(newRiders);
    if (race) {
      AuditLogService.log({
        race,
        action: "IMPORT_RIDERS",
        screen: "EditRiders",
        entityType: "rider",
        details: { riderCount: newRiders.length },
      });
    }
    setImportPreview(null);
  };

  // Delete → a confirmation dialog with the rider's name and bib; nothing changes
  // until Confirm. Riders with race activity are refused (give them a status).
  const askDelete = (rider: RiderProps) => {
    const blocked = riderDeletionBlock(rider);
    if (blocked) {
      toast.warn(`${riderLabel(rider)} cannot be deleted: ${blocked}. Set a status (DNS/DNF/DSQ) instead.`);
      return;
    }
    setDeleteConfirm(rider.id);
  };

  const handleDelete = async (id: number) => {
    const existing = raceRiders.find((r) => r.id === id);
    if (existing && riderDeletionBlock(existing)) {
      setDeleteConfirm(null);
      return;
    }
    await deleteRider(id);
    if (race && existing) {
      AuditLogService.log({
        race,
        action: "DELETE_RIDER",
        screen: "EditRiders",
        entityType: "rider",
        entityId: existing.bibNumber,
        before: { firstName: existing.firstName, lastName: existing.lastName, category: existing.category },
      });
    }
    setDeleteConfirm(null);
  };

  // ─ Render ──────────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        {onBack && (
          <button className={styles.importBtn} onClick={onBack}>
            ← Back
          </button>
        )}
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            className={styles.search}
            placeholder="Name or bib…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className={styles.addBtn} onClick={startAdd}>
          + Add
        </button>
        <button
          className={styles.importBtn}
          onClick={() => fileRef.current?.click()}
        >
          📁 CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          hidden
          onChange={handleFileChange}
        />
      </div>

      {importError && <div className={styles.importError}>{importError}</div>}

      {/* CSV import preview */}
      {importPreview && (
        <div className={styles.importBox}>
          <div className={styles.importTitle}>
            <strong>Import {importPreview.length} riders</strong>
            <span className={styles.importMeta}>
              {[...new Set(importPreview.map((r) => r.heat))]
                .sort((a, b) => a - b)
                .map((h) => (
                  <span key={h}>
                    {" "}
                    Wave {h}: {importPreview.filter((r) => r.heat === h).length}
                  </span>
                ))}
            </span>
          </div>
          <div className={styles.importTable}>
            <div className={styles.importHeader}>
              <span>Bib</span>
              <span>Name</span>
              <span>Category</span>
              <span>Wave</span>
            </div>
            {importPreview.slice(0, 6).map((row, i) => (
              <div key={i} className={styles.importRow}>
                <span>#{row.bibNumber}</span>
                <span>
                  {row.lastName} {row.firstName}
                </span>
                <span>{row.category}</span>
                <span>{row.heat}</span>
              </div>
            ))}
            {importPreview.length > 6 && (
              <div className={styles.importMore}>
                +{importPreview.length - 6} more riders…
              </div>
            )}
          </div>
          <div className={styles.importActions}>
            <button
              className={styles.cancelBtn}
              onClick={() => setImportPreview(null)}
            >
              Cancel
            </button>
            <button className={styles.confirmImportBtn} onClick={confirmImport}>
              Import {importPreview.length} riders
            </button>
          </div>
        </div>
      )}

      {/* Add / edit inline form */}
      {(addingNew || editingId != null) && (
        <div className={styles.form}>
          <div className={styles.formTitle}>
            {addingNew ? "Add Rider" : "Edit Rider"}
          </div>
          <div className={styles.row2}>
            <input
              className={styles.input}
              placeholder="First name *"
              value={form.firstName}
              onChange={(e) => setF("firstName", e.target.value)}
            />
            <input
              className={styles.input}
              placeholder="Last name *"
              value={form.lastName}
              onChange={(e) => setF("lastName", e.target.value)}
            />
          </div>
          <div className={styles.row2}>
            <input
              className={styles.input}
              placeholder="Bib # *"
              type="number"
              value={form.bibNumber}
              onChange={(e) => setF("bibNumber", e.target.value)}
            />
            <input
              className={styles.input}
              placeholder="Chip #"
              value={form.chipNumber}
              onChange={(e) => setF("chipNumber", e.target.value)}
            />
          </div>

          <CategoryManager
            onSelect={(category, subCategory, color) => {
              setForm((f) => ({
                ...f,
                category,
                subCategory,
                categoryColor: color
              }));
            }}
            currentCategory={form.category}
            currentSubCategory={form.subCategory}
            raceUuid={raceUuid}
          />

          <select
            className={styles.input}
            value={form.heat}
            onChange={(e) => setF("heat", e.target.value)}
          >
            {waves.map((w) => (
              <option key={w} value={w}>
                Wave {w}
              </option>
            ))}
          </select>
          <input
            className={styles.input}
            placeholder="Club / team"
            value={form.team}
            onChange={(e) => setF("team", e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="UCI ID (11 digits, optional)"
            aria-label="UCI ID"
            inputMode="numeric"
            data-testid="rider-uci-id"
            value={form.uciNumber}
            onChange={(e) => setF("uciNumber", e.target.value)}
          />
          <input
            className={styles.input}
            dir="auto"
            placeholder="Bib background (empty = category)"
            aria-label="Bib Background Color"
            data-testid="rider-bib-color"
            value={form.bibColor}
            onChange={(e) => setF("bibColor", e.target.value)}
          />
          <input
            className={styles.input}
            dir="auto"
            placeholder="Bib text color (empty = category)"
            aria-label="Bib Text Color"
            data-testid="rider-bib-text-color"
            value={form.bibTextColor}
            onChange={(e) => setF("bibTextColor", e.target.value)}
          />
          <div className={styles.formActions}>
            <button className={styles.cancelBtn} onClick={cancelForm}>
              Cancel
            </button>
            <button className={styles.saveBtn} onClick={saveForm}>
              Save
            </button>
          </div>
        </div>
      )}

      <div className={styles.count}>
        {raceRiders.length} riders{search ? ` · ${filtered.length} shown` : ""}
      </div>

      <div className={styles.list}>
        {filtered.length === 0 && (
          <div className={styles.empty}>
            {search
              ? "No riders match."
              : "No riders yet — use + Add or import a CSV file."}
          </div>
        )}
        {filtered.map((rider) => (
          <div
            key={rider.id}
            className={`${styles.riderRow} ${editingId === rider.id ? styles.editing : ""}`}
          >
            <span className={styles.bib}>#{rider.bibNumber}</span>
            <div className={styles.riderInfo}>
              <span className={styles.riderName}>
                {rider.lastName} {rider.firstName}
              </span>
              <span className={styles.riderMeta}>
                {rider.category}
                {rider.subCategory ? ` - ${rider.subCategory}` : ""} · Wave{" "}
                {rider.heat}
                {rider.team ? ` · ${rider.team}` : ""}
                {rider.chipNumber ? ` · 📡 ${rider.chipNumber}` : ""}
              </span>
            </div>
            <div className={styles.rowActions}>
              <button
                className={styles.editBtn}
                onClick={() =>
                  editingId === rider.id ? cancelForm() : startEdit(rider)
                }
              >
                ✎
              </button>
              <button
                className={styles.deleteBtn}
                onClick={() => askDelete(rider)}
                aria-label={`Delete ${riderLabel(rider)}`}
                title="Delete rider"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {deleteConfirm !== null && (() => {
        const target = raceRiders.find((r) => r.id === deleteConfirm);
        if (!target) return null;
        return (
          <DeleteConfirmModal
            requireTyping={false}
            title="Delete rider?"
            description={`${riderLabel(target)} will be removed from this race. This cannot be undone.`}
            onConfirm={() => handleDelete(target.id)}
            onCancel={() => setDeleteConfirm(null)}
          />
        );
      })()}
    </div>
  );
};

export default EditRiders;
