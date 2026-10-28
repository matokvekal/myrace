import React, { useMemo, useState, useEffect } from "react";
import styles from "./categories.module.css";
import Button from "@/components/ui/Button";
import { Plus, Minus, Edit2, Check, X, Users, Bell, Flag } from "lucide-react";
import { CategoryProps, CategoryTemplate, RiderProps } from "@/types/types";
import { COLORS } from "@/constants/index";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, catWaveKey, toMinutes, normalizeTime } from "../schedule/Schedule";
import { getCategoryStatusInfo } from "@/utils/statusChip";
import { getCategoryLocks } from "@/utils/categoryLocks";
import { finishGroupLabel } from "@/utils/finishGroups";
import { normalizeColor } from "@/utils/bibColors";
import BibBadge from "@/components/ui/BibBadge";
import { formatMinLap, LEGACY_MIN_LAP_SECONDS, MIN_LAP_CHOICES } from "@/utils/minLap";
import { isLeaderFinishAll } from "@/utils/linkedGroups";
import { PREDEFINED_CATEGORY_TEMPLATES } from "@/constants/categoryTemplates";
import { AuditLogService } from "@/services/auditLog/auditLogService";

interface CategoriesProps {
  raceUuid: string;
}

// Built-in category bank — single source of truth (BUGS.md #5).
const PREDEFINED_TEMPLATES = PREDEFINED_CATEGORY_TEMPLATES;

type SortMode = "now" | "upload";
const SORT_KEY = "categoriesSortMode";

/** The uploaded file's order is the race schedule. Races imported before the
 *  order was recorded fall back to start time, then name. */
const byUploadOrder = (a: CategoryProps, b: CategoryProps) =>
  (a.importOrder ?? Infinity) - (b.importOrder ?? Infinity) ||
  toMinutes(a.startTime) - toMinutes(b.startTime) ||
  a.name.localeCompare(b.name);

const Categories: React.FC<CategoriesProps> = ({ raceUuid }) => {
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try {
      return localStorage.getItem(SORT_KEY) === "upload" ? "upload" : "now";
    } catch {
      return "now";
    }
  });
  const changeSortMode = (mode: SortMode) => {
    setSortMode(mode);
    try {
      localStorage.setItem(SORT_KEY, mode);
    } catch {
      /* preference only */
    }
  };
  const [templates, setTemplates] = useState<CategoryTemplate[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [colorFor, setColorFor] = useState<number | "new" | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<CategoryProps>>({});
  const [colorOpen, setColorOpen] = useState(false);
  const [editError, setEditError] = useState("");
  const [showRidersFor, setShowRidersFor] = useState<CategoryProps | null>(null);
  // New Category needs only a name and a colour; laps 5 and wave 1 are the existing defaults.
  const [newCategoryForm, setNewCategoryForm] = useState({ name: "", color: "#63A6FC", laps: 5 });
  const [moreOpen, setMoreOpen] = useState(false);

  const { categories, updateCategory, getCategories } = useCategoryStore();
  const { riders, updateRider } = useRiderStore();
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  const updateRace = useRaceStore((s) => s.updateRace);

  const raceCategories = categories.filter((c) => c.raceUuid === raceUuid);

  const catWaveMap = useMemo(() => {
    const schedule = buildSchedule(raceCategories, DEFAULT_WAVE_GAP_MINUTES);
    const map = new Map<string, number>();
    schedule.forEach((startMap, waveNum) => {
      startMap.forEach((cats) => cats.forEach((cat) => map.set(catWaveKey(cat.name, cat.subCategory), waveNum)));
    });
    return map;
  }, [raceCategories]);

  useEffect(() => {
    getCategories(raceUuid);
  }, [raceUuid, getCategories]);

  useEffect(() => {
    const stored = localStorage.getItem("categoryTemplates");
    if (stored) {
      const custom = JSON.parse(stored);
      setTemplates([...PREDEFINED_TEMPLATES, ...custom]);
    } else {
      setTemplates(PREDEFINED_TEMPLATES);
    }
  }, []);

  const handleAddFromBank = (template: CategoryTemplate) => {
    if (template.subCategories.length > 0) {
      // Legacy template saved before BUGS.md #2 — flatten each sub-category into
      // its own standalone category ("Man Masters" + "30-39" → "Man Masters 30-39")
      // instead of creating nested ones.
      template.subCategories.forEach((subCat, idx) => {
        const newCat: CategoryProps = {
          id: Date.now() + idx,
          raceUuid,
          name: `${template.name} ${subCat}`.trim(),
          subCategory: null,
          laps: 5,
          lapsCounter: 0,
          riders: 0,
          startTime: null,
          isConnected: false,
          color: template.color,
          heat: 1,
          status: "upcoming"
        };
        updateCategory(newCat);
      });
    } else {
      const newCat: CategoryProps = {
        id: Date.now(),
        raceUuid,
        name: template.name,
        subCategory: null,
        laps: 5,
        lapsCounter: 0,
        riders: 0,
        startTime: null,
        isConnected: false,
        color: template.color,
        heat: 1,
        status: "upcoming"
      };
      updateCategory(newCat);
    }
    if (race) {
      AuditLogService.log({
        race,
        action: "ADD_CATEGORY",
        screen: "Categories",
        entityType: "category",
        entityId: template.name,
        details: { source: "bank" },
      });
    }
    // Force refresh categories
    getCategories(raceUuid);
  };

  const startEdit = (category: CategoryProps) => {
    setEditingId(category.id);
    setEditForm({ ...category });
    setColorOpen(false);
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
    setColorOpen(false);
    setEditError("");
  };

  /**
   * Persist a category AND push its laps/color onto every rider in it.
   *
   * Riders imported without a laps column start at totalLaps 0, so a category's
   * lap count has to follow through to them — otherwise the live screen shows
   * 0/0 instead of 0/5 (BUGS.md #7). Every place that changes `laps` must go
   * through here, not straight to updateCategory.
   *
   * `laps || rider.totalLaps` is deliberate: a category sitting at 0/null means
   * "not set yet" and must not wipe lap counts that came from the start list.
   */
  const updateCategoryAndSyncRiders = async (updated: CategoryProps): Promise<boolean> => {
    // Race safety for EVERY laps write (edit dialog, Set Laps, ± stepper): a
    // finished category's laps are fixed, and laps never drop below what a rider
    // already rode. Returns false when the change was refused.
    const stored = raceCategories.find((c) => c.id === updated.id) ?? updated;
    const locks = getCategoryLocks(stored, riders.filter((r) => r.raceUuid === raceUuid));
    if (locks.laps && (updated.laps ?? 0) !== (stored.laps ?? 0)) return false;
    if ((updated.laps ?? 0) !== (stored.laps ?? 0) && (updated.laps ?? 0) < locks.minLaps) return false;

    await updateCategory(updated);

    const categoryRiders = riders.filter(
      (r) =>
        r.raceUuid === raceUuid &&
        r.category === updated.name &&
        (r.subCategory ?? null) === (updated.subCategory ?? null)
    );

    for (const rider of categoryRiders) {
      await updateRider({
        ...rider,
        color: updated.color,
        totalLaps: updated.laps || rider.totalLaps
      });
    }
    return true;
  };

  const saveEdit = async () => {
    if (editingId === null) return;

    const category = raceCategories.find((c) => c.id === editingId);
    if (!category) return;

    // Race safety: whatever the form says, fields the lifecycle has locked keep
    // their stored value, and laps can't drop below what riders already rode.
    const locks = getCategoryLocks(category, riders.filter((r) => r.raceUuid === raceUuid));
    const updatedCategory = { ...category, ...editForm } as CategoryProps;
    // Bib colours: stored normalized (#RRGGBB) or empty; an unknown value is refused, not guessed.
    for (const [field, label] of [["bibColor", "Bib background"], ["bibTextColor", "Bib text"]] as const) {
      const typed = String(editForm[field] ?? "").trim();
      const norm = normalizeColor(typed);
      if (typed && !norm) {
        setEditError(`${label} color "${typed}" is not recognised — use a colour name or #RRGGBB.`);
        return;
      }
      updatedCategory[field] = norm;
    }
    if (locks.color) updatedCategory.color = category.color;
    if (locks.wave) updatedCategory.heat = category.heat;
    if (locks.startTime) updatedCategory.startTime = category.startTime;
    if (locks.laps) updatedCategory.laps = category.laps;
    if ((updatedCategory.laps ?? 0) < locks.minLaps) {
      setEditError(`Laps cannot be fewer than ${locks.minLaps} - riders have already completed that many.`);
      return;
    }

    await updateCategoryAndSyncRiders(updatedCategory);
    if (race) {
      AuditLogService.log({
        race,
        action: "EDIT_CATEGORY",
        screen: "Categories",
        entityType: "category",
        entityId: category.name,
        before: { laps: category.laps, color: category.color, heat: category.heat },
        after: { laps: updatedCategory.laps, color: updatedCategory.color, heat: updatedCategory.heat },
      });
    }

    cancelEdit();
  };

  const handleDelete = async (category: CategoryProps) => {
    const categoryRiders = riders.filter(
      (r) =>
        r.raceUuid === raceUuid &&
        r.category === category.name &&
        (r.subCategory ?? null) === (category.subCategory ?? null)
    );

    if (categoryRiders.length > 0) {
      alert(
        `Cannot delete category with ${categoryRiders.length} riders. Please remove all riders first or use Edit to change the category settings.`
      );
      return;
    }

    // Only allow delete if no riders
    if (
      !window.confirm(
        `Remove "${category.name}${category.subCategory ? " · " + category.subCategory : ""}" from this race? It stays in the category library.`
      )
    ) {
      return;
    }

    // Through the store, so the finalized lock and shared races (CategoryDeleted) apply.
    await useCategoryStore.getState().deleteCategory(category.id);

    if (race) {
      AuditLogService.log({
        race,
        action: "DELETE_CATEGORY",
        screen: "Categories",
        entityType: "category",
        entityId: category.name,
        before: { name: category.name, subCategory: category.subCategory, laps: category.laps },
      });
    }
  };

  const handleCreateNew = async () => {
    if (!newCategoryForm.name.trim()) {
      alert("Category name is required");
      return;
    }

    const newCat: CategoryProps = {
      id: Date.now(),
      raceUuid,
      name: newCategoryForm.name.trim(),
      // Sub-categories are no longer authored — one category per age band (BUGS.md #2)
      subCategory: null,
      laps: newCategoryForm.laps,
      lapsCounter: 0,
      riders: 0,
      startTime: null,
      isConnected: false,
      color: newCategoryForm.color,
      heat: 1,
      status: "upcoming"
    };

    await updateCategory(newCat);
    // Remember it in the category library so later races can reuse it.
    if (!templates.some((t) => t.name.toLowerCase() === newCat.name.toLowerCase())) {
      const tpl: CategoryTemplate = {
        id: `custom-${newCat.id}`,
        name: newCat.name,
        subCategories: [],
        color: newCat.color ?? "#63A6FC",
        createdAt: new Date(),
        lastUsed: new Date(),
      };
      try {
        const stored = localStorage.getItem("categoryTemplates");
        const custom = stored ? JSON.parse(stored) : [];
        localStorage.setItem("categoryTemplates", JSON.stringify([...custom, tpl]));
      } catch {
        /* library is a convenience; the race category is already saved */
      }
      setTemplates((prev) => [...prev, tpl]);
    }
    if (race) {
      AuditLogService.log({
        race,
        action: "ADD_CATEGORY",
        screen: "Categories",
        entityType: "category",
        entityId: newCat.name,
        details: { source: "new", laps: newCat.laps, heat: newCat.heat },
      });
    }
    setCreating(false);
    setColorFor(null);
    setNewCategoryForm({ name: "", color: "#63A6FC", laps: 5 });
    getCategories(raceUuid);
  };

  const riderCounts = raceCategories.map((cat) => {
    const count = riders.filter(
      (r) =>
        r.raceUuid === raceUuid &&
        r.category === cat.name &&
        (r.subCategory ?? null) === (cat.subCategory ?? null)
    ).length;
    return { id: cat.id, count };
  });

  const orderedCategories = [...raceCategories].sort((a, b) => {
    if (sortMode === "upload") return byUploadOrder(a, b);
    const aFinished = a.status === "finished" ? 1 : 0;
    const bFinished = b.status === "finished" ? 1 : 0;
    return aFinished - bFinished;
  });

  // Library entries not yet in this race (matched by name, case-insensitive).
  const inRace = new Set(raceCategories.map((c) => c.name.trim().toLowerCase()));
  const available = templates.filter((t) => !inRace.has(t.name.trim().toLowerCase()));

  const raceRiders = riders.filter((r) => r.raceUuid === raceUuid);

  /** Compact colour picker: a swatch button that opens the palette in place. */
  const colorCell = (key: number | "new", value: string | null, locked: boolean, onPick: (code: string) => void) => (
    <div className={styles.cpWrap}>
      <button
        type="button"
        className={styles.cpSwatch}
        style={{ background: value ?? "#ccc" }}
        disabled={locked}
        aria-label="Color"
        aria-expanded={colorFor === key}
        title={COLORS.find((c) => c.code === value)?.name ?? value ?? ""}
        onClick={() => setColorFor(colorFor === key ? null : key)}
        data-testid={key === "new" ? "new-category-color" : "category-color-trigger"}
      />
      {colorFor === key && (
        <div className={styles.cpPalette} data-testid="category-color-palette">
          {COLORS.map((color) => (
            <button
              key={color.code}
              type="button"
              className={`${styles.cpOption} ${value === color.code ? styles.cpOptionActive : ""}`}
              style={{ background: color.code }}
              title={color.name}
              aria-label={color.name}
              onClick={() => { onPick(color.code); setColorFor(null); }}
            >
              {value === color.code && <Check size={10} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  /** − [n] + stepper used by the table rows and the Add/Edit form. */
  const lapsStepper = (value: number, locked: boolean, onChange: (n: number) => void, label: string) => (
    <div className={styles.lapsCell}>
      <button type="button" className={styles.stepMini} disabled={locked} aria-label={`Fewer laps for ${label}`} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <input
        type="number"
        min="0"
        className={styles.lapsInput}
        aria-label={`Laps for ${label}`}
        data-testid="category-laps"
        disabled={locked}
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
      />
      <button type="button" className={styles.stepMini} disabled={locked} aria-label={`More laps for ${label}`} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );

  /** First finish – all finish and Min lap time are stored once per race and
   *  apply to every category; shown (and edited) in the Add/Edit form. */
  const raceRuleFields = race ? (
    <>
      <label className={styles.formLine} title="When a category's first rider starts the last lap, every rider in it gets the bell. When the first rider finishes, everyone finishes on their next crossing. Applies to all categories.">
        <span className={styles.fieldLabel}>First finish</span>
        <input
          type="checkbox"
          className={styles.switch}
          data-testid="leader-finish-all"
          checked={isLeaderFinishAll(race)}
          disabled={!!race.finalized}
          onChange={(e) => void updateRace({ ...race, leaderFinishAll: e.target.checked })}
        />
        <span className={styles.allNote}>all categories</span>
      </label>
      <label className={styles.formLine} title="A rider's next passage counts only after this long. New races: 3 min. Applies to all categories.">
        <span className={styles.fieldLabel}>Min lap time</span>
        <select
          className={styles.ruleSelect}
          data-testid="min-lap-seconds"
          value={race.minLapSeconds ?? LEGACY_MIN_LAP_SECONDS}
          disabled={!!race.finalized}
          onChange={(e) => void updateRace({ ...race, minLapSeconds: Number(e.target.value) })}
        >
          {[...new Set([...MIN_LAP_CHOICES, race.minLapSeconds ?? LEGACY_MIN_LAP_SECONDS])].sort((a, b) => a - b).map((sec) => (
            <option key={sec} value={sec}>{formatMinLap(sec)}</option>
          ))}
        </select>
        <span className={styles.allNote}>all categories</span>
      </label>
    </>
  ) : null;

  return (
    <div className={styles.container}>
      {/* Actions: New Category · Add From (· order, once there is a table) */}
      <div className={styles.catActions}>
        <button
          type="button"
          className={styles.primaryMini}
          onClick={() => { cancelEdit(); setLibraryOpen(false); setCreating(true); }}
          data-testid="new-category-btn"
        >
          <Plus size={14} /> New Category
        </button>
        <button
          type="button"
          className={`${styles.secondaryMini} ${libraryOpen ? styles.secondaryMiniActive : ""}`}
          aria-expanded={libraryOpen}
          onClick={() => { setCreating(false); setLibraryOpen((o) => !o); }}
          data-testid="add-from-btn"
        >
          <Plus size={14} /> Add From
          <span className={styles.libraryCount}>{available.length}</span>
        </button>
        {raceCategories.length > 1 && (
          <select
            className={`${styles.ruleSelect} ${styles.orderSelect}`}
            value={sortMode}
            onChange={(e) => changeSortMode(e.target.value as SortMode)}
            aria-label="Category order"
            title="Now: finished categories last. Upload: the order of the uploaded file (the schedule)."
          >
            <option value="now">Order: now</option>
            <option value="upload">Order: upload</option>
          </select>
        )}
      </div>

      {/* Library: hidden until "Add From"; closes after a pick */}
      {libraryOpen && (
        <div className={styles.library}>
          {available.length === 0 && <div className={styles.emptyRow}>Every library category is already in this race.</div>}
          {available.map((template) => (
            <button
              key={template.id}
              type="button"
              className={styles.libRow}
              onClick={() => { handleAddFromBank(template); setLibraryOpen(false); }}
              data-testid="library-add"
            >
              <span className={styles.libDot} style={{ background: template.color }} />
              <span className={styles.libName} dir="auto">
                {template.name}
                {template.subCategories.length > 0 && ` (${template.subCategories.length})`}
              </span>
              <Plus size={14} className={styles.libPlus} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {/* New Category: the same compact form as Edit */}
      {creating && (
        <div className={styles.catForm} data-testid="new-category-form">
          <div className={styles.formLine}>
            {colorCell("new", newCategoryForm.color, false, (code) => setNewCategoryForm({ ...newCategoryForm, color: code }))}
            <input
              type="text"
              dir="auto"
              autoFocus
              className={styles.nameInput}
              placeholder="Category name"
              aria-label="Category name"
              data-testid="new-category-name"
              value={newCategoryForm.name}
              onChange={(e) => setNewCategoryForm({ ...newCategoryForm, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateNew();
                if (e.key === "Escape") setCreating(false);
              }}
            />
          </div>
          <div className={styles.formLine}>
            <span className={styles.fieldLabel}>Laps</span>
            {lapsStepper(newCategoryForm.laps, false, (n) => setNewCategoryForm({ ...newCategoryForm, laps: n }), "new category")}
          </div>
          {raceRuleFields}
          <div className={styles.formButtons}>
            <button type="button" className={styles.secondaryMini} onClick={() => setCreating(false)}>Cancel</button>
            <button type="button" className={styles.primaryMini} onClick={() => void handleCreateNew()} data-testid="new-category-save">
              <Check size={14} /> Add
            </button>
          </div>
        </div>
      )}

      {/* Table only when the race has categories: colour | name | laps | edit | remove */}
      {orderedCategories.length > 0 && (
        <div className={styles.table} role="table" aria-label="Categories in this race">
          <div className={`${styles.row} ${styles.headRow}`} role="row">
            <span role="columnheader" />
            <span role="columnheader">Category</span>
            <span role="columnheader" className={styles.center}>Laps</span>
            <span role="columnheader" />
            <span role="columnheader" />
          </div>

          {orderedCategories.map((cat) => {
            const isEditing = editingId === cat.id;
            const riderCount = riderCounts.find((rc) => rc.id === cat.id)?.count || 0;
            const locks = getCategoryLocks(cat, raceRiders);
            const isDone = cat.status === "finished";
            const info = getCategoryStatusInfo(cat.status);
            return (
              <React.Fragment key={cat.id}>
                <div className={`${styles.row} ${isDone ? styles.rowDone : ""}`} role="row">
                  {colorCell(cat.id, cat.color, locks.color, (code) => void updateCategoryAndSyncRiders({ ...cat, color: code }))}
                  <div className={styles.nameCell} dir="auto">
                    {isDone && <Flag size={12} className={styles.doneFlag} aria-hidden="true" />}
                    <span className={styles.catName}>{cat.name}{cat.subCategory ? ` · ${cat.subCategory}` : ""}</span>
                    {cat.status && cat.status !== "upcoming" && (
                      <span className={styles.statusChip} style={{ background: `${info.color}1f`, color: info.color }}>{info.label}</span>
                    )}
                  </div>
                  {lapsStepper(cat.laps ?? 0, locks.laps, (n) => void updateCategoryAndSyncRiders({ ...cat, laps: n }), cat.name)}
                  <button
                    type="button"
                    className={`${styles.iconMini} ${isEditing ? styles.iconMiniActive : ""}`}
                    aria-label={`Edit ${cat.name}`}
                    aria-expanded={isEditing}
                    onClick={() => { setCreating(false); if (isEditing) cancelEdit(); else { startEdit(cat); setMoreOpen(false); } }}
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconMini} ${styles.removeBtn}`}
                    title={riderCount > 0 ? `${riderCount} riders are in ${cat.name}; move them first` : `Remove ${cat.name} from this race`}
                    aria-label={`Remove ${cat.name} from this race`}
                    data-testid="category-remove"
                    onClick={() => handleDelete(cat)}
                  >
                    <Minus size={14} />
                  </button>
                </div>

                {isEditing && (
                  <div className={`${styles.catForm} ${styles.catFormInline}`} data-testid="category-edit-form">
                    {locks.reason && <div className={styles.lockNote} data-testid="category-lock-note">{locks.reason}</div>}
                    <div className={styles.formLine}>
                      {colorCell(-cat.id, editForm.color ?? null, locks.color, (code) => setEditForm({ ...editForm, color: code }))}
                      <input
                        type="text"
                        dir="auto"
                        className={styles.nameInput}
                        aria-label="Category name"
                        title={riderCount > 0 ? "Riders are linked to this name; move them before renaming" : undefined}
                        disabled={riderCount > 0}
                        value={editForm.name ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </div>
                    <div className={styles.formLine}>
                      <span className={styles.fieldLabel}>Laps</span>
                      {lapsStepper(editForm.laps ?? 0, locks.laps, (n) => { setEditError(""); setEditForm({ ...editForm, laps: n }); }, cat.name)}
                      <button type="button" className={styles.ridersBtn} onClick={() => setShowRidersFor(cat)} title={`Show riders in ${cat.name}`}>
                        <Users size={12} aria-hidden="true" /> {riderCount}
                      </button>
                    </div>
                    {raceRuleFields}

                    <button
                      type="button"
                      className={styles.moreToggle}
                      aria-expanded={moreOpen}
                      onClick={() => setMoreOpen((o) => !o)}
                    >
                      More {moreOpen ? "▴" : "▾"}
                    </button>
                    {moreOpen && (
                      <div className={styles.moreFields}>
                        <label className={styles.formLine}>
                          <span className={styles.fieldLabel}>Wave</span>
                          <input
                            type="number"
                            min="1"
                            className={styles.smallInput}
                            disabled={locks.wave}
                            value={editForm.heat || 1}
                            onChange={(e) => setEditForm({ ...editForm, heat: parseInt(e.target.value) || 1 })}
                          />
                        </label>
                        <label className={styles.formLine}>
                          <span className={styles.fieldLabel}>Start time</span>
                          <input
                            type="time"
                            className={styles.smallInput}
                            data-testid="category-start-time"
                            disabled={locks.startTime}
                            value={normalizeTime(editForm.startTime)?.slice(0, 5) ?? ""}
                            onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value || null })}
                          />
                        </label>
                        <label className={styles.formLine} title="Categories with the same group name ring the bell / finish together. Empty = this category alone.">
                          <span className={styles.fieldLabel}><Bell size={12} aria-hidden="true" /> Bell group</span>
                          <input
                            type="text"
                            dir="auto"
                            className={styles.smallInput}
                            placeholder="e.g. Masters"
                            value={editForm.linkGroup ?? ""}
                            onChange={(e) => setEditForm({ ...editForm, linkGroup: e.target.value })}
                          />
                        </label>
                        <div className={styles.formLine} title='A colour name (e.g. "blue", "צהוב") or #RRGGBB. Empty = plain bib.'>
                          <span className={styles.fieldLabel}>Bib colors</span>
                          <input
                            type="text"
                            dir="auto"
                            className={styles.smallInput}
                            aria-label="Bib Background Color"
                            data-testid="category-bib-color"
                            placeholder="Background"
                            value={editForm.bibColor ?? ""}
                            onChange={(e) => setEditForm({ ...editForm, bibColor: e.target.value })}
                          />
                          <input
                            type="text"
                            dir="auto"
                            className={styles.smallInput}
                            aria-label="Bib Text Color"
                            data-testid="category-bib-text-color"
                            placeholder="Digits"
                            value={editForm.bibTextColor ?? ""}
                            onChange={(e) => setEditForm({ ...editForm, bibTextColor: e.target.value })}
                          />
                          <BibBadge rider={{ bibNumber: 123, bibColor: null, bibTextColor: null, raceUuid, category: "", subCategory: null }} category={{ bibColor: normalizeColor(editForm.bibColor), bibTextColor: normalizeColor(editForm.bibTextColor) }} />
                        </div>
                      </div>
                    )}

                    {editError && <div className={styles.lockNote} role="alert" data-testid="category-edit-error">{editError}</div>}
                    <div className={styles.formButtons}>
                      <button type="button" className={styles.secondaryMini} onClick={cancelEdit}>Cancel</button>
                      <button type="button" className={styles.primaryMini} onClick={() => void saveEdit()}>
                        <Check size={14} /> Save
                      </button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {showRidersFor && (
        <CategoryRidersModal
          category={showRidersFor}
          riders={riders.filter(
            (r) =>
              r.raceUuid === raceUuid &&
              r.category === showRidersFor.name &&
              (r.subCategory ?? null) === (showRidersFor.subCategory ?? null)
          )}
          onClose={() => setShowRidersFor(null)}
        />
      )}
    </div>
  );
};

function CategoryRidersModal({
  category,
  riders,
  onClose
}: {
  category: CategoryProps;
  riders: RiderProps[];
  onClose: () => void;
}) {
  return (
    <div className={styles.bankModal} onClick={onClose}>
      <div className={styles.bankContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.bankHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: category.color ?? "#ccc", flexShrink: 0 }} />
            <h3 style={{ margin: 0, fontSize: 16 }}>
              {category.name}{category.subCategory ? ` · ${category.subCategory}` : ""}
            </h3>
            <span style={{ fontSize: 12, color: "#7a8aa8", fontWeight: 600 }}>({riders.length})</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className={styles.bankList}>
          {riders.length === 0 ? (
            <div style={{ textAlign: "center", color: "#7a8aa8", padding: "32px 16px", fontSize: 13 }}>
              No riders in this category
            </div>
          ) : (
            riders
              .slice()
              .sort((a, b) => a.bibNumber - b.bibNumber)
              .map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    background: "#fff",
                    border: "1px solid #e8f0fc",
                    borderRadius: 10,
                    fontSize: 13
                  }}
                >
                  <span style={{ fontWeight: 800, color: "#4a8ee7", minWidth: 32 }}>#{r.bibNumber}</span>
                  <span style={{ fontWeight: 600, color: "#1a304f", flex: 1 }}>{r.firstName} {r.lastName}</span>
                  {r.team && <span style={{ fontSize: 11, color: "#7a8aa8" }}>{r.team}</span>}
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

export default Categories;
