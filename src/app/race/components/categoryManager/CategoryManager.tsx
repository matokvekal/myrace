import React, { useState, useEffect } from "react";
import styles from "./categoryManager.module.css";
import Button from "@/components/ui/Button";
import { Plus, X, Check } from "lucide-react";
import { CategoryTemplate } from "@/types/types";
import { COLORS } from "@/constants/index";

interface Props {
  onSelect: (
    category: string,
    subCategory: string | null,
    color: string
  ) => void;
  currentCategory?: string;
  currentSubCategory?: string | null;
  raceUuid: string;
}

const PREDEFINED_CATEGORIES: CategoryTemplate[] = [
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

const CategoryManager: React.FC<Props> = ({
  onSelect,
  currentCategory,
  currentSubCategory,
  raceUuid
}) => {
  const [templates, setTemplates] = useState<CategoryTemplate[]>([]);
  const [addingNew, setAddingNew] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newSubCats, setNewSubCats] = useState<string[]>([]);
  const [newSubCatInput, setNewSubCatInput] = useState("");
  const [selectedColor, setSelectedColor] = useState(COLORS[0].code);
  const [selectedCategory, setSelectedCategory] = useState(
    currentCategory || ""
  );
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(
    currentSubCategory || null
  );

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = () => {
    const stored = localStorage.getItem("categoryTemplates");
    if (stored) {
      const parsed = JSON.parse(stored);
      setTemplates([...PREDEFINED_CATEGORIES, ...parsed]);
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
      subCategories: newSubCats,
      color: selectedColor,
      createdAt: new Date(),
      lastUsed: new Date()
    };

    saveTemplate(newTemplate);
    setSelectedCategory(newTemplate.name);
    setSelectedSubCategory(newTemplate.subCategories[0] || null);

    // Reset form
    setAddingNew(false);
    setNewCatName("");
    setNewSubCats([]);
    setNewSubCatInput("");

    onSelect(
      newTemplate.name,
      newTemplate.subCategories[0] || null,
      newTemplate.color
    );
  };

  const handleAddSubCategory = () => {
    if (!newSubCatInput.trim()) return;
    setNewSubCats([...newSubCats, newSubCatInput.trim()]);
    setNewSubCatInput("");
  };

  const handleRemoveSubCategory = (index: number) => {
    setNewSubCats(newSubCats.filter((_, i) => i !== index));
  };

  const handleSelectCategory = (template: CategoryTemplate) => {
    setSelectedCategory(template.name);
    setSelectedSubCategory(template.subCategories[0] || null);
    onSelect(template.name, template.subCategories[0] || null, template.color);
  };

  const handleSelectSubCategory = (subCat: string | null) => {
    setSelectedSubCategory(subCat);
    const template = templates.find((t) => t.name === selectedCategory);
    if (template) {
      onSelect(selectedCategory, subCat, template.color);
    }
  };

  const currentTemplate = templates.find((t) => t.name === selectedCategory);

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

          <div className={styles.subCatSection}>
            <span className={styles.subLabel}>Sub-categories (optional):</span>
            <div className={styles.subCatInput}>
              <input
                className={styles.input}
                placeholder="e.g., 19-29, 30-39..."
                value={newSubCatInput}
                onChange={(e) => setNewSubCatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddSubCategory()}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddSubCategory}
                disabled={!newSubCatInput.trim()}
              >
                Add
              </Button>
            </div>
            {newSubCats.length > 0 && (
              <div className={styles.subCatList}>
                {newSubCats.map((sub, idx) => (
                  <div key={idx} className={styles.subCatChip}>
                    {sub}
                    <button
                      className={styles.removeBtn}
                      onClick={() => handleRemoveSubCategory(idx)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.formActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAddingNew(false);
                setNewCatName("");
                setNewSubCats([]);
                setNewSubCatInput("");
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
                {template.subCategories.length > 0 && (
                  <span className={styles.badge}>
                    {template.subCategories.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {currentTemplate && currentTemplate.subCategories.length > 0 && (
            <div className={styles.subCategorySection}>
              <span className={styles.label}>Sub-category:</span>
              <div className={styles.subCategoryList}>
                {currentTemplate.subCategories.map((sub) => (
                  <button
                    key={sub}
                    className={`${styles.subCategoryBtn} ${selectedSubCategory === sub ? styles.active : ""}`}
                    onClick={() => handleSelectSubCategory(sub)}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CategoryManager;
