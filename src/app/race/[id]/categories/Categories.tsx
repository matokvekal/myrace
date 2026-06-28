import React, { useState, useEffect } from "react";
import styles from "./categories.module.css";
import Button from "@/components/ui/Button";
import { Plus, Trash2, Edit2, Check, X, Users } from "lucide-react";
import { CategoryProps, CategoryTemplate, RiderProps } from "@/types/types";
import { COLORS } from "@/constants/index";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";

interface CategoriesProps {
  raceUuid: string;
}

const PREDEFINED_TEMPLATES: CategoryTemplate[] = [
  {
    id: "man-juniors",
    name: "Man Juniors",
    subCategories: [],
    color: "#63A6FC",
    createdAt: new Date(),
    lastUsed: new Date()
  },
  {
    id: "woman-juniors",
    name: "Woman Juniors",
    subCategories: [],
    color: "#E05585",
    createdAt: new Date(),
    lastUsed: new Date()
  },
  {
    id: "man-masters",
    name: "Man Masters",
    subCategories: ["19-29", "30-39", "40-49", "50-59", "60+"],
    color: "#3EDDA4",
    createdAt: new Date(),
    lastUsed: new Date()
  },
  {
    id: "woman-masters",
    name: "Woman Masters",
    subCategories: ["19-29", "30-39", "40-49", "50-59", "60+"],
    color: "#FFC300",
    createdAt: new Date(),
    lastUsed: new Date()
  },
  {
    id: "man-elite",
    name: "Man Elite",
    subCategories: [],
    color: "#9D4EDD",
    createdAt: new Date(),
    lastUsed: new Date()
  },
  {
    id: "woman-elite",
    name: "Woman Elite",
    subCategories: [],
    color: "#FF006E",
    createdAt: new Date(),
    lastUsed: new Date()
  }
];

const Categories: React.FC<CategoriesProps> = ({ raceUuid }) => {
  const [templates, setTemplates] = useState<CategoryTemplate[]>([]);
  const [showAddFromBank, setShowAddFromBank] = useState(false);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<CategoryProps>>({});
  const [showRidersFor, setShowRidersFor] = useState<CategoryProps | null>(null);
  const [riderFilter, setRiderFilter] = useState<"all" | "with" | "without">("with");
  const [quickLapsMode, setQuickLapsMode] = useState(false);
  const [quickLapsValues, setQuickLapsValues] = useState<Record<number, number>>({})
  const [newCategoryForm, setNewCategoryForm] = useState({
    name: "",
    subCategory: "",
    color: "#63A6FC",
    laps: 5,
    heat: 1
  });

  const { categories, updateCategory, getCategories } = useCategoryStore();
  const { riders, updateRider } = useRiderStore();

  const raceCategories = categories.filter((c) => c.raceUuid === raceUuid);

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
      // Add each sub-category as a separate category
      template.subCategories.forEach((subCat, idx) => {
        const newCat: CategoryProps = {
          id: Date.now() + idx,
          raceUuid,
          name: template.name,
          subCategory: subCat,
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

  const saveEdit = async () => {
    if (editingId === null) return;

    const category = raceCategories.find((c) => c.id === editingId);
    if (!category) return;

    const updatedCategory = {
      ...category,
      ...editForm
    } as CategoryProps;

    await updateCategory(updatedCategory);

    // Update all riders in this category with new color/laps
    const categoryRiders = riders.filter(
      (r) =>
        r.raceUuid === raceUuid &&
        r.category === updatedCategory.name &&
        (r.subCategory ?? null) === (updatedCategory.subCategory ?? null)
    );

    for (const rider of categoryRiders) {
      await updateRider({
        ...rider,
        color: updatedCategory.color,
        totalLaps: updatedCategory.laps || rider.totalLaps
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
      subCategory: newCategoryForm.subCategory.trim() || null,
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
    setShowCreateNew(false);
    setNewCategoryForm({
      name: "",
      subCategory: "",
      color: "#63A6FC",
      laps: 5,
      heat: 1
    });
    getCategories(raceUuid);
  };

  const handleQuickLapsSaveAll = async () => {
    try {
      for (const cat of raceCategories) {
        const newLaps = quickLapsValues[cat.id];
        if (newLaps === undefined) continue;

        const updatedCategory = { ...cat, laps: newLaps } as CategoryProps;
        await updateCategory(updatedCategory);

        const categoryRiders = riders.filter(
          (r) =>
            r.raceUuid === raceUuid &&
            r.category === updatedCategory.name &&
            (r.subCategory ?? null) === (updatedCategory.subCategory ?? null)
        );

        for (const rider of categoryRiders) {
          await updateRider({
            ...rider,
            totalLaps: newLaps
          });
        }
      }

      await getCategories(raceUuid);
    } catch (error) {
      console.error("Error saving laps:", error);
      alert("Error saving laps. Check console for details.");
    } finally {
      setQuickLapsMode(false);
      setQuickLapsValues({});
    }
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
      const aFinished = a.status === "finished" ? 1 : 0;
      const bFinished = b.status === "finished" ? 1 : 0;
      return aFinished - bFinished;
    });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>Race Categories</h3>
          {emptyCount > 0 && (
            <button
              className={`${styles.emptyToggle} ${riderFilter === "all" ? styles.emptyToggleActive : ""}`}
              onClick={() => setRiderFilter(riderFilter === "all" ? "with" : "all")}
            >
              {riderFilter === "all"
                ? `Hide empty (${emptyCount})`
                : `Show empty (${emptyCount})`}
            </button>
          )}
        </div>
        <div className={styles.headerActions}>
          {quickLapsMode && (
            <>
              <Button
                variant="success"
                size="sm"
                onClick={handleQuickLapsSaveAll}
              >
                ✓ Save All
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuickLapsMode(false);
                  setQuickLapsValues({});
                }}
              >
                Cancel
              </Button>
            </>
          )}
          {raceCategories.length > 0 && !quickLapsMode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setQuickLapsMode(true);
                const initialValues: Record<number, number> = {};
                raceCategories.forEach(cat => {
                  initialValues[cat.id] = cat.laps ?? 0;
                });
                setQuickLapsValues(initialValues);
              }}
            >
              ⚡ Quick Laps
            </Button>
          )}
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
        </div>
      </div>

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
            const hasNoRiders = riderCount === 0;
            const hasNoLaps = !cat.laps || cat.laps === 0;
            const hasIssue = hasNoRiders || hasNoLaps;

            return (
              <div key={cat.id} className={`${styles.categoryCard} ${isDone ? styles.categoryCardDone : ""} ${quickLapsMode ? styles.categoryCardQuickLaps : ""} ${hasIssue ? styles.categoryCardIssue : ""}`}>
                {quickLapsMode ? (
                  <div className={styles.quickLapsForm}>
                    <div className={styles.quickLapsLabel}>
                      <span>{cat.name}{cat.subCategory ? ` · ${cat.subCategory}` : ""}</span>
                    </div>
                    <input
                      type="number"
                      className={styles.quickLapsInput}
                      value={quickLapsValues[cat.id] === 0 ? "" : (quickLapsValues[cat.id] ?? "")}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : parseInt(e.target.value) || 0;
                        setQuickLapsValues({ ...quickLapsValues, [cat.id]: val });
                      }}
                      min="0"
                      placeholder="—"
                    />
                  </div>
                ) : isEditing ? (
                  <div className={styles.editForm}>
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
                        🔔 First finishes = all finish
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
                    <div className={styles.categoryInfo}>
                      <div
                        className={styles.colorDot}
                        style={{ background: cat.color || "#ccc" }}
                      />
                      <div className={styles.categoryDetails}>
                        <div className={styles.categoryName}>
                          {isDone && <span className={styles.finishedFlag}>🏁</span>}
                          {hasIssue && <span className={styles.issueFlag}>⚠️</span>}
                          {cat.name}
                          {cat.subCategory && (
                            <span className={styles.subCategory}>
                              {" "}
                              · {cat.subCategory}
                            </span>
                          )}
                        </div>
                        <div className={styles.categoryMeta}>
                          <span className={hasNoLaps ? styles.issueText : ""}>
                            {cat.laps ? `${cat.laps} laps` : "No laps set"}
                          </span>
                          · Wave {cat.heat || 1} ·{" "}
                          <span className={hasNoRiders ? styles.issueText : ""}>
                            {riderCount} riders
                          </span>
                          {cat.linkedFinish && <span className={styles.linkedBadge}>🔔 linked</span>}
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
                <label>Sub-Category (optional)</label>
                <input
                  type="text"
                  className={styles.input}
                  value={newCategoryForm.subCategory}
                  onChange={(e) =>
                    setNewCategoryForm({
                      ...newCategoryForm,
                      subCategory: e.target.value
                    })
                  }
                  placeholder="e.g., 30-39"
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
