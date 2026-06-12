import React, { useState, useEffect } from "react";
import styles from "./categories.module.css";
import Button from "@/components/ui/Button";
import { Plus, Trash2, Edit2, Check, X } from "lucide-react";
import { CategoryProps, CategoryTemplate } from "@/types/types";
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
        r.subCategory === updatedCategory.subCategory
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
        r.subCategory === category.subCategory
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

  const riderCounts = raceCategories.map((cat) => {
    const count = riders.filter(
      (r) =>
        r.raceUuid === raceUuid &&
        r.category === cat.name &&
        r.subCategory === cat.subCategory
    ).length;
    return { id: cat.id, count };
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Race Categories</h3>
        <div className={styles.headerActions}>
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
          {raceCategories.map((cat) => {
            const isEditing = editingId === cat.id;
            const riderCount =
              riderCounts.find((rc) => rc.id === cat.id)?.count || 0;

            return (
              <div key={cat.id} className={styles.categoryCard}>
                {isEditing ? (
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
                        <input
                          type="number"
                          className={styles.input}
                          value={editForm.laps || 0}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              laps: parseInt(e.target.value) || 0
                            })
                          }
                          min="0"
                        />
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
                          {cat.name}
                          {cat.subCategory && (
                            <span className={styles.subCategory}>
                              {" "}
                              · {cat.subCategory}
                            </span>
                          )}
                        </div>
                        <div className={styles.categoryMeta}>
                          {cat.laps ? `${cat.laps} laps` : "No laps set"} · Wave{" "}
                          {cat.heat || 1} · {riderCount} riders
                        </div>
                      </div>
                    </div>
                    <div className={styles.categoryActions}>
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
                  <input
                    type="number"
                    className={styles.input}
                    value={newCategoryForm.laps}
                    onChange={(e) =>
                      setNewCategoryForm({
                        ...newCategoryForm,
                        laps: parseInt(e.target.value) || 0
                      })
                    }
                    min="0"
                  />
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
    </div>
  );
};

export default Categories;
