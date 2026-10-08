import React, { useMemo, useState, useEffect } from "react";
import styles from "./categories.module.css";
import Button from "@/components/ui/Button";
import { Plus, Trash2, Edit2, Check, X, Users, Bell, Flag } from "lucide-react";
import { CategoryProps, CategoryTemplate, RiderProps } from "@/types/types";
import { COLORS } from "@/constants/index";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, catWaveKey, toMinutes } from "../schedule/Schedule";
import { getCategoryStatusInfo } from "@/utils/statusChip";
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
  const [showAddFromBank, setShowAddFromBank] = useState(false);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<CategoryProps>>({});
  const [showRidersFor, setShowRidersFor] = useState<CategoryProps | null>(null);
  const [riderFilter, setRiderFilter] = useState<"all" | "with" | "without">("with");
  const [showQuickLaps, setShowQuickLaps] = useState(false);
  const [quickLapsValues, setQuickLapsValues] = useState<Record<number, number | null>>({});
  const [newCategoryForm, setNewCategoryForm] = useState({
    name: "",
    color: "#63A6FC",
    laps: 5,
    heat: 1
  });

  const { categories, updateCategory, getCategories } = useCategoryStore();
  const { riders, updateRider } = useRiderStore();
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));

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
    setShowAddFromBank(false);
    // Force refresh categories
    getCategories(raceUuid);
  };

  const startEdit = (category: CategoryProps) => {
    setEditingId(category.id);
    setEditForm({ ...category });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
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
  const updateCategoryAndSyncRiders = async (updated: CategoryProps) => {
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
  };

  const saveEdit = async () => {
    if (editingId === null) return;

    const category = raceCategories.find((c) => c.id === editingId);
    if (!category) return;

    const updatedCategory = {
      ...category,
      ...editForm
    } as CategoryProps;

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
        `Delete category "${category.name}${category.subCategory ? " · " + category.subCategory : ""}"?`
      )
    ) {
      return;
    }

    // Remove from store and IndexedDB
    const updatedCategories = categories.filter((c) => c.id !== category.id);
    useCategoryStore.setState({ categories: updatedCategories });

    try {
      const { initIndexedDB } =
        await import("@/stores/indexDb/indexedDbHelper");
      const db = await initIndexedDB();
      const tx = db.transaction("categories", "readwrite");
      await tx.objectStore("categories").delete(category.id);
      await tx.done;
      db.close();
    } catch (error) {
      console.error("Error deleting category from IDB:", error);
    }

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
      heat: newCategoryForm.heat,
      status: "upcoming"
    };

    await updateCategory(newCat);
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
    setShowCreateNew(false);
    setNewCategoryForm({
      name: "",
      color: "#63A6FC",
      laps: 5,
      heat: 1
    });
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

  const emptyCount = raceCategories.filter(
    (cat) => (riderCounts.find((rc) => rc.id === cat.id)?.count ?? 0) === 0
  ).length;

  const filteredCategories = raceCategories
    .filter((cat) => {
      const count = riderCounts.find((rc) => rc.id === cat.id)?.count ?? 0;
      if (riderFilter === "with") return count > 0;
      if (riderFilter === "without") return count === 0;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "upload") return byUploadOrder(a, b);
      const aFinished = a.status === "finished" ? 1 : 0;
      const bFinished = b.status === "finished" ? 1 : 0;
      return aFinished - bFinished;
    });

  // Set Laps panel follows the same order, so it reads top to bottom like the schedule
  const quickLapsCategories =
    sortMode === "upload" ? [...raceCategories].sort(byUploadOrder) : raceCategories;

  return (
    <div className={styles.container}>
      <div className={styles.headerControls}>
          <Button
            variant={sortMode === "now" ? "primary" : "secondary"}
            size="sm"
            onClick={() => changeSortMode("now")}
            title="Current order (finished categories last)"
          >
            Now
          </Button>
          <Button
            variant={sortMode === "upload" ? "primary" : "secondary"}
            size="sm"
            onClick={() => changeSortMode("upload")}
            title="Order of the uploaded file (the schedule)"
          >
            Upload order
          </Button>
          {showQuickLaps ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowQuickLaps(false)}
              >
                <X size={13} /> Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  for (const cat of raceCategories) {
                    const newLaps = quickLapsValues[cat.id];
                    if (newLaps !== null && newLaps !== undefined && newLaps !== cat.laps) {
                      await updateCategoryAndSyncRiders({ ...cat, laps: newLaps });
                    }
                  }
                  setShowQuickLaps(false);
                }}
              >
                <Check size={13} /> Save
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const init: Record<number, number | null> = {};
                  raceCategories.forEach((c) => { init[c.id] = null; });
                  setQuickLapsValues(init);
                  setShowQuickLaps(true);
                }}
              >
                Set Laps
              </Button>
              <Button
                variant="primary"
                size="sm"
                startIcon={<Plus size={14} />}
                onClick={() => setShowCreateNew(true)}
              >
                Create New
              </Button>
              <Button
                variant="success"
                size="sm"
                startIcon={<Plus size={14} />}
                onClick={() => setShowAddFromBank(true)}
              >
                Add from Bank
              </Button>
            </>
          )}
      </div>

      {showQuickLaps && (
        <div className={styles.quickLapsPanel}>
          <div className={styles.quickLapsTitle}>Set Laps per Category</div>
          <div className={styles.quickLapsList}>
            {quickLapsCategories.map((cat) => (
              <div key={cat.id} className={styles.quickLapsRow}>
                <span className={styles.quickLapsDot} style={{ background: cat.color ?? "#ccc" }} />
                <span className={styles.quickLapsCatName}>{cat.name}</span>
                <input
                  type="number"
                  min="0"
                  className={styles.quickLapsInput}
                  placeholder={cat.laps != null ? String(cat.laps) : "—"}
                  value={quickLapsValues[cat.id] ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? null : parseInt(e.target.value) || 0;
                    setQuickLapsValues((prev) => ({ ...prev, [cat.id]: val }));
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {raceCategories.length === 0 ? (
        <div className={styles.empty}>
          <p>No categories yet. Add categories from the bank to get started.</p>
          <Button
            variant="primary"
            size="md"
            startIcon={<Plus size={16} />}
            onClick={() => setShowAddFromBank(true)}
          >
            Add First Category
          </Button>
        </div>
      ) : (
        <div className={styles.list}>
          {filteredCategories.map((cat) => {
            const isEditing = editingId === cat.id;
            const riderCount =
              riderCounts.find((rc) => rc.id === cat.id)?.count || 0;

            const isDone = cat.status === "finished";
            return (
              <div key={cat.id} className={`${styles.categoryCard} ${isDone ? styles.categoryCardDone : ""}`}>
                {isEditing ? (
                  <div className={styles.editForm} style={{ padding: 16 }}>
                    <div className={styles.editRow}>
                      <div className={styles.colorPicker}>
                        {COLORS.map((color) => (
                          <button
                            key={color.code}
                            className={`${styles.colorBtn} ${editForm.color === color.code ? styles.colorActive : ""}`}
                            style={{ background: color.code }}
                            onClick={() =>
                              setEditForm({ ...editForm, color: color.code })
                            }
                            title={color.name}
                          >
                            {editForm.color === color.code && (
                              <Check size={10} />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className={styles.editRow}>
                      <div className={styles.formGroup}>
                        <label>Laps</label>
                        <div className={styles.stepperWrap}>
                          <button
                            type="button"
                            className={styles.stepBtn}
                            onClick={() => setEditForm({ ...editForm, laps: Math.max(0, (editForm.laps || 0) - 1) })}
                          >−</button>
                          <input
                            type="number"
                            className={`${styles.input} ${styles.stepInput}`}
                            value={editForm.laps || 0}
                            onChange={(e) => setEditForm({ ...editForm, laps: parseInt(e.target.value) || 0 })}
                            min="0"
                          />
                          <button
                            type="button"
                            className={styles.stepBtn}
                            onClick={() => setEditForm({ ...editForm, laps: (editForm.laps || 0) + 1 })}
                          >+</button>
                        </div>
                      </div>

                      <div className={styles.formGroup}>
                        <label>Heat/Wave</label>
                        <input
                          type="number"
                          className={styles.input}
                          value={editForm.heat || 1}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              heat: parseInt(e.target.value) || 1
                            })
                          }
                          min="1"
                        />
                      </div>
                    </div>

                    <label className={styles.linkedFinishRow}>
                      <input
                        type="checkbox"
                        checked={!!editForm.linkedFinish}
                        onChange={(e) => setEditForm({ ...editForm, linkedFinish: e.target.checked })}
                      />
                      <span className={styles.linkedFinishLabel}>
                        <Bell size={14} /> First finishes = all finish
                        <span className={styles.linkedFinishHint}>When the leader completes their last lap, show the bell for all other riders</span>
                      </span>
                    </label>

                    <div className={styles.editActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={cancelEdit}
                      >
                        <X size={14} />
                        Cancel
                      </Button>
                      <Button variant="success" size="sm" onClick={saveEdit}>
                        <Check size={14} />
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.categoryCardInner}>
                    <div className={styles.categoryInfo}>
                      <div
                        className={styles.colorDot}
                        style={{ background: cat.color || "#ccc" }}
                      />
                      <div className={styles.categoryDetails}>
                        <div className={styles.categoryName}>
                          {isDone && <span className={styles.finishedFlag}><Flag size={12} /></span>}
                          {cat.name}
                          {cat.subCategory && (
                            <span className={styles.subCategory}>
                              {" "}
                              · {cat.subCategory}
                            </span>
                          )}
                          {(() => {
                            const info = getCategoryStatusInfo(cat.status);
                            return (
                              <span
                                className={styles.categoryStatusChip}
                                style={{ background: `${info.color}1f`, color: info.color }}
                              >
                                {info.label}
                              </span>
                            );
                          })()}
                        </div>
                        <div className={styles.categoryMeta}>
                          <span className={styles.lapsStepper}>
                            <button
                              className={styles.lapStepBtn}
                              onClick={(e) => { e.stopPropagation(); updateCategoryAndSyncRiders({ ...cat, laps: Math.max(0, (cat.laps ?? 0) - 1) }); }}
                            >−</button>
                            <span>{cat.laps ?? 0} laps</span>
                            <button
                              className={styles.lapStepBtn}
                              onClick={(e) => { e.stopPropagation(); updateCategoryAndSyncRiders({ ...cat, laps: (cat.laps ?? 0) + 1 }); }}
                            >+</button>
                          </span>
                          {" · "}Wave {catWaveMap.get(catWaveKey(cat.name, cat.subCategory)) ?? cat.heat ?? 1} · {riderCount} riders
                          {cat.linkedFinish && <span className={styles.linkedBadge}><Bell size={11} /> linked</span>}
                        </div>
                      </div>
                    </div>
                    <div className={styles.categoryActions}>
                      <Button
                        variant="icon"
                        size="sm"
                        iconOnly
                        title={`Show riders in ${cat.name}`}
                        onClick={() => setShowRidersFor(cat)}
                      >
                        <Users size={14} />
                      </Button>
                      <Button
                        variant="icon"
                        size="sm"
                        iconOnly
                        onClick={() => startEdit(cat)}
                      >
                        <Edit2 size={14} />
                      </Button>
                      <Button
                        variant="icon"
                        size="sm"
                        iconOnly
                        onClick={() => handleDelete(cat)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    </div>
                    {(cat.laps ?? 0) > 0 && (() => {
                      const catRiders = riders.filter((r) => r.raceUuid === raceUuid && r.category === cat.name);
                      const maxLaps = catRiders.length > 0
                        ? Math.max(0, ...catRiders.map((r) => r.lapsCounter || 0))
                        : 0;
                      return (
                        <div className={styles.catLapBar}>
                          {Array.from({ length: cat.laps! }, (_, i) => (
                            <div key={i} className={`${styles.catLapSegment} ${i < maxLaps ? styles.catLapSegmentDone : ""}`} />
                          ))}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddFromBank && (
        <div
          className={styles.bankModal}
          onClick={() => setShowAddFromBank(false)}
        >
          <div
            className={styles.bankContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.bankHeader}>
              <h3>Category Bank</h3>
              <button
                className={styles.closeBtn}
                onClick={() => setShowAddFromBank(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className={styles.bankList}>
              {templates.map((template) => (
                <button
                  key={template.id}
                  className={styles.templateCard}
                  onClick={() => handleAddFromBank(template)}
                >
                  <div
                    className={styles.templateColorDot}
                    style={{ background: template.color }}
                  />
                  <div className={styles.templateInfo}>
                    <div className={styles.templateName}>{template.name}</div>
                    {template.subCategories.length > 0 && (
                      <div className={styles.templateSubs}>
                        {template.subCategories.length} sub-categories
                      </div>
                    )}
                  </div>
                  <Plus size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showCreateNew && (
        <div
          className={styles.bankModal}
          onClick={() => setShowCreateNew(false)}
        >
          <div
            className={styles.bankContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.bankHeader}>
              <h3>Create New Category</h3>
              <button
                className={styles.closeBtn}
                onClick={() => setShowCreateNew(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className={styles.createForm}>
              <div className={styles.formGroup}>
                <label>Category Name *</label>
                <input
                  type="text"
                  className={styles.input}
                  value={newCategoryForm.name}
                  onChange={(e) =>
                    setNewCategoryForm({
                      ...newCategoryForm,
                      name: e.target.value
                    })
                  }
                  placeholder="e.g., Man Elite"
                />
              </div>

              <div className={styles.formGroup}>
                <label>Color</label>
                <div className={styles.colorPicker}>
                  {COLORS.map((color) => (
                    <button
                      key={color.code}
                      className={`${styles.colorBtn} ${newCategoryForm.color === color.code ? styles.colorActive : ""}`}
                      style={{ background: color.code }}
                      onClick={() =>
                        setNewCategoryForm({
                          ...newCategoryForm,
                          color: color.code
                        })
                      }
                      title={color.name}
                    >
                      {newCategoryForm.color === color.code && (
                        <Check size={10} />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.editRow}>
                <div className={styles.formGroup}>
                  <label>Laps</label>
                  <div className={styles.stepperWrap}>
                    <button
                      type="button"
                      className={styles.stepBtn}
                      onClick={() => setNewCategoryForm({ ...newCategoryForm, laps: Math.max(0, (newCategoryForm.laps || 0) - 1) })}
                    >−</button>
                    <input
                      type="number"
                      className={`${styles.input} ${styles.stepInput}`}
                      value={newCategoryForm.laps}
                      onChange={(e) => setNewCategoryForm({ ...newCategoryForm, laps: parseInt(e.target.value) || 0 })}
                      min="0"
                    />
                    <button
                      type="button"
                      className={styles.stepBtn}
                      onClick={() => setNewCategoryForm({ ...newCategoryForm, laps: (newCategoryForm.laps || 0) + 1 })}
                    >+</button>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label>Heat/Wave</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={newCategoryForm.heat}
                    onChange={(e) =>
                      setNewCategoryForm({
                        ...newCategoryForm,
                        heat: parseInt(e.target.value) || 1
                      })
                    }
                    min="1"
                  />
                </div>
              </div>

              <div className={styles.createActions}>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setShowCreateNew(false)}
                >
                  Cancel
                </Button>
                <Button variant="success" size="md" onClick={handleCreateNew}>
                  Create Category
                </Button>
              </div>
            </div>
          </div>
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
