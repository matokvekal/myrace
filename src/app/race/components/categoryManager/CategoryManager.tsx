import React, { useState, useEffect } from "react";
import styles from "./categoryManager.module.css";
import Button from "@/components/ui/Button";
import { Plus, Check } from "lucide-react";
import { CategoryTemplate } from "@/types/types";
import { COLORS } from "@/constants/index";
import { PREDEFINED_CATEGORY_TEMPLATES } from "@/constants/categoryTemplates";

interface Props {
  /**
   * `subCategory` is always null — categories are flat, one per age band
   * (BUGS.md #2). The parameter is kept so legacy call sites still compile and
   * keep writing null onto their riders.
   */
  onSelect: (
    category: string,
    subCategory: string | null,
    color: string
  ) => void;
  currentCategory?: string;
  /** @deprecated Legacy races only — no longer drives any UI. */
  currentSubCategory?: string | null;
  raceUuid: string;
}

// Built-in category bank — single source of truth (BUGS.md #5).
const PREDEFINED_CATEGORIES = PREDEFINED_CATEGORY_TEMPLATES;

const CategoryManager: React.FC<Props> = ({
  onSelect,
  currentCategory,
  raceUuid
}) => {
  const [templates, setTemplates] = useState<CategoryTemplate[]>([]);
  const [addingNew, setAddingNew] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [selectedColor, setSelectedColor] = useState(COLORS[0].code);
  const [selectedCategory, setSelectedCategory] = useState(
    currentCategory || ""
  );

  useEffect(() => {
    loadTemplates();
  }, []);

  /**
   * Templates saved before BUGS.md #2 may still carry sub-categories. Expand
   * them into standalone flat templates ("Man Masters" + "30-39" → "Man Masters
   * 30-39") so the picker never offers a nested category again.
   */
  const flattenLegacyTemplate = (t: CategoryTemplate): CategoryTemplate[] => {
    if (!t.subCategories || t.subCategories.length === 0) {
      return [{ ...t, subCategories: [] }];
    }
    return t.subCategories.map((sub) => ({
      ...t,
      id: `${t.id}-${sub}`,
      name: `${t.name} ${sub}`.trim(),
      subCategories: []
    }));
  };

  const loadTemplates = () => {
    const stored = localStorage.getItem("categoryTemplates");
    if (stored) {
      const parsed: CategoryTemplate[] = JSON.parse(stored);
      const flattened = parsed.flatMap(flattenLegacyTemplate);
      setTemplates([...PREDEFINED_CATEGORIES, ...flattened]);
    } else {
      setTemplates(PREDEFINED_CATEGORIES);
    }
  };

  const saveTemplate = (template: CategoryTemplate) => {
    const stored = localStorage.getItem("categoryTemplates");
    const custom = stored ? JSON.parse(stored) : [];
    custom.push(template);
    localStorage.setItem("categoryTemplates", JSON.stringify(custom));
    setTemplates([...PREDEFINED_CATEGORIES, ...custom]);
  };

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;

    const newTemplate: CategoryTemplate = {
      id: `custom-${Date.now()}`,
      name: newCatName.trim(),
      subCategories: [],
      color: selectedColor,
      createdAt: new Date(),
      lastUsed: new Date()
    };

    saveTemplate(newTemplate);
    setSelectedCategory(newTemplate.name);

    // Reset form
    setAddingNew(false);
    setNewCatName("");

    onSelect(newTemplate.name, null, newTemplate.color);
  };

  const handleSelectCategory = (template: CategoryTemplate) => {
    setSelectedCategory(template.name);
    onSelect(template.name, null, template.color);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.label}>Category *</span>
        {!addingNew && (
          <Button
            variant="ghost"
            size="sm"
            startIcon={<Plus size={14} />}
            onClick={() => setAddingNew(true)}
            className={styles.addBtn}
          >
            New
          </Button>
        )}
      </div>

      {addingNew ? (
        <div className={styles.addForm}>
          <input
            className={styles.input}
            placeholder="Category name *"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            autoFocus
          />

          <div className={styles.colorPicker}>
            <span className={styles.colorLabel}>Color:</span>
            <div className={styles.colorGrid}>
              {COLORS.map((color) => (
                <button
                  key={color.code}
                  className={`${styles.colorBtn} ${selectedColor === color.code ? styles.colorActive : ""}`}
                  style={{ background: color.code }}
                  onClick={() => setSelectedColor(color.code)}
                  title={color.name}
                >
                  {selectedColor === color.code && <Check size={12} />}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.formActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAddingNew(false);
                setNewCatName("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="success"
              size="sm"
              onClick={handleAddCategory}
              disabled={!newCatName.trim()}
            >
              Create Category
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.categoryList}>
            {templates.map((template) => (
              <button
                key={template.id}
                className={`${styles.categoryBtn} ${selectedCategory === template.name ? styles.active : ""}`}
                onClick={() => handleSelectCategory(template)}
              >
                <span
                  className={styles.colorDot}
                  style={{ background: template.color }}
                />
                {template.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default CategoryManager;
