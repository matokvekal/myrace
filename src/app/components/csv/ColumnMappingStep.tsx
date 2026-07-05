"use client";

import { useState, useEffect, useRef } from "react";
import type { ColumnMapping, RiderFieldKey, MappingTemplate } from "@/types/csv.types";
import { FIELD_KEYWORDS } from "@/types/csv.types";
import {
  getColumnSuggestions,
  confirmMapping,
  detectNameSplitting
} from "@/services/csvMapper";
import {
  getAllTemplates,
  saveTemplate,
  touchTemplate,
  removeTemplate
} from "@/services/templateStorage";
import ClubDictionaryManager from "./ClubDictionaryManager";
import styles from "./columnMappingStep.module.css";

interface ColumnMappingStepProps {
  headers: string[];
  mappings: ColumnMapping[];
  sampleRows: string[][];
  onConfirm: (mappings: ColumnMapping[]) => void;
  onBack: () => void;
  suggestedName?: string;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diffMs = now - ts;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString();
}

export default function ColumnMappingStep({
  headers,
  mappings: initialMappings,
  sampleRows,
  onConfirm,
  onBack,
  suggestedName = ""
}: ColumnMappingStepProps) {
  const [mappings, setMappings] = useState<ColumnMapping[]>(initialMappings);
  const [splitFullName, setSplitFullName] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<MappingTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [savingName, setSavingName] = useState("");
  const [appliedMsg, setAppliedMsg] = useState("");
  const saveInputRef = useRef<HTMLInputElement>(null);

  // Dictionary manager state
  const [showDictionary, setShowDictionary] = useState(false);

  useEffect(() => {
    const { shouldSplit } = detectNameSplitting(mappings);
    setSplitFullName(shouldSplit);
  }, [mappings]);

  useEffect(() => {
    getAllTemplates().then(setTemplates);
  }, []);

  useEffect(() => {
    if (showSaveForm) saveInputRef.current?.focus();
  }, [showSaveForm]);

  const handleFieldChange = async (
    index: number,
    newField: RiderFieldKey | null
  ) => {
    const updated = [...mappings];
    updated[index] = {
      ...updated[index],
      targetField: newField,
      confidence: newField ? 100 : 0,
      isAutoMapped: false,
      needsConfirmation: false
    };
    setMappings(updated);
    if (newField) {
      await confirmMapping(updated[index].sourceColumn, newField);
    }
  };

  const handleApplyTemplate = async (tpl: MappingTemplate) => {
    const norm = (s: string) => s.toLowerCase().trim();
    const updated = mappings.map((m) => {
      const match = tpl.mappings.find(
        (t) => norm(t.sourceColumn) === norm(m.sourceColumn)
      );
      if (match !== undefined) {
        return {
          ...m,
          targetField: match.targetField,
          confidence: 100,
          isAutoMapped: false,
          needsConfirmation: false
        };
      }
      return m;
    });
    setMappings(updated);
    await touchTemplate(tpl.id);
    const matched = updated.filter((m, i) => {
      const orig = tpl.mappings.find(
        (t) => norm(t.sourceColumn) === norm(mappings[i].sourceColumn)
      );
      return orig !== undefined;
    }).length;
    setAppliedMsg(`Applied "${tpl.name}" — ${matched} of ${tpl.mappings.length} columns matched`);
    setShowTemplates(false);
    setTimeout(() => setAppliedMsg(""), 4000);
  };

  const handleDeleteTemplate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await removeTemplate(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const handleSaveTemplate = async () => {
    if (!savingName.trim()) return;
    await saveTemplate(savingName.trim(), headers, mappings);
    const refreshed = await getAllTemplates();
    setTemplates(refreshed);
    setSavingName("");
    setShowSaveForm(false);
    setShowTemplates(true);
  };

  const handleConfirm = () => {
    const hasBibNumber = mappings.some((m) => m.targetField === "bibNumber");
    if (!hasBibNumber) {
      alert("Please map at least the Bib Number field to continue.");
      return;
    }
    onConfirm(mappings);
  };

  const FIELD_LABELS: Record<string, string> = {
    bibNumber: "Bib #",
    firstName: "First Name",
    middleName: "Middle Name",
    lastName: "Last Name",
    fullName: "Full Name",
    firstNameEnglish: "First Name (English)",
    lastNameEnglish: "Last Name (English)",
    category: "Category",
    subCategory: "Sub-Category",
    team: "Team / Club",
    gender: "Gender",
    heat: "Wave Number",
    startTime: "Start Time",
    totalLaps: "Total Laps",
    position: "Start Position",
    standing: "Standing / Ranking",
    raceDay: "Race Day",
    points: "Points",
    federation: "Federation",
    uciNumber: "UCI Number",
    idNumber: "ID Number",
    birthDate: "Birth Date",
    federationNumber: "Federation Number",
    federationChip: "Federation Chip",
    roadNumber: "Road Number",
    chip: "Chip",
    notes: "Notes",
  };

  const FIELD_HINTS: Partial<Record<string, string>> = {
    category: "Main group — e.g. Men Junior, Gravel, MTB",
    subCategory: "Sub-group within a category — e.g. age range 19-29, 30-39",
    heat: "Wave group number — e.g. 1, 2, 3  (not a clock time)",
    startTime: "Clock start time — e.g. 09:00, 11:30  (not a wave number)",
  };

  const getFieldLabel = (field: RiderFieldKey): string =>
    FIELD_LABELS[field] || field;

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 85) {
      return (
        <span className={`${styles.badge} ${styles.badgeHigh}`}>
          High {confidence}%
        </span>
      );
    } else if (confidence >= 60) {
      return (
        <span className={`${styles.badge} ${styles.badgeMedium}`}>
          Medium {confidence}%
        </span>
      );
    } else {
      return (
        <span className={`${styles.badge} ${styles.badgeLow}`}>Manual</span>
      );
    }
  };

  const usedFields = new Set(
    mappings
      .filter((m) => m.targetField !== null)
      .map((m) => m.targetField as RiderFieldKey)
  );

  const availableFields: (RiderFieldKey | null)[] = [
    null,
    ...FIELD_KEYWORDS.map((f) => f.field).filter(
      (f) => !usedFields.has(f) || mappings.find((m) => m.targetField === f)
    )
  ];

  const mappedCount = mappings.filter((m) => m.targetField !== null).length;
  const needsConfirmationCount = mappings.filter(
    (m) => m.needsConfirmation
  ).length;

  return (
    <div className={styles.mappingStep}>
      <div className={styles.header}>
        <h3>Map CSV Columns to Fields</h3>
        <div className={styles.stats}>
          <span className={styles.stat}>
            <strong>{mappedCount}</strong> of <strong>{mappings.length}</strong>{" "}
            columns mapped
          </span>
          {needsConfirmationCount > 0 && (
            <span className={styles.stat}>
              <strong>{needsConfirmationCount}</strong> need confirmation
            </span>
          )}
        </div>
      </div>

      {/* ── Saved templates panel ── */}
      {templates.length > 0 && (
        <div className={styles.templateSection}>
          <button
            className={styles.templateToggle}
            onClick={() => setShowTemplates((v) => !v)}
          >
            {showTemplates ? "▾" : "▸"} Saved templates ({templates.length})
          </button>
          {showTemplates && (
            <div className={styles.templateList}>
              {templates.map((tpl) => (
                <div key={tpl.id} className={styles.templateItem}>
                  <div className={styles.templateInfo}>
                    <strong dir="auto">{tpl.name}</strong>
                    <span>
                      {tpl.mappings.filter((m) => m.targetField).length} columns ·{" "}
                      {formatDate(tpl.lastUsed)}
                      {tpl.usedCount > 0 && ` · used ${tpl.usedCount}×`}
                    </span>
                  </div>
                  <div className={styles.templateBtns}>
                    <button
                      className={styles.applyBtn}
                      onClick={() => handleApplyTemplate(tpl)}
                    >
                      Apply
                    </button>
                    <button
                      className={styles.deleteTplBtn}
                      onClick={(e) => handleDeleteTemplate(tpl.id, e)}
                      title="Delete template"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {appliedMsg && <div className={styles.appliedMsg}>{appliedMsg}</div>}

      {/* Club Dictionary Manager Button */}
      <div className={styles.dictionarySection}>
        <button
          className={styles.dictionaryBtn}
          onClick={() => setShowDictionary(true)}
          title="Manage club name dictionary mappings"
        >
          📖 Club Dictionary
        </button>
      </div>

      {showDictionary && (
        <ClubDictionaryManager
          onClose={() => setShowDictionary(false)}
        />
      )}

      {splitFullName && (
        <div className={styles.nameSplitWarning}>
          <strong>ℹ️ Name Splitting:</strong> Full Name field detected. Names
          will be automatically split into First Name and Last Name.
        </div>
      )}

      <div className={styles.mappingTable}>
        <div className={styles.tableHeader}>
          <div className={styles.colCSV}>CSV Column</div>
          <div className={styles.colSample}>Sample Data</div>
          <div className={styles.colArrow}></div>
          <div className={styles.colField}>App Field</div>
          <div className={styles.colConfidence}>Confidence</div>
        </div>

        {mappings.map((mapping, index) => (
          <div key={index} className={styles.mappingRow}>
            <div className={styles.colCSV} dir="auto" data-label="CSV Column">
              <strong>{mapping.sourceColumn}</strong>
            </div>

            <div className={styles.colSample} data-label="Sample Data">
              <div className={styles.sampleData}>
                {sampleRows.map((row, i) => (
                  <div key={i} className={styles.sampleItem} dir="auto">
                    {row[index] || "-"}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.colArrow}>→</div>

            <div className={styles.colField} data-label="App Field">
              <select
                value={mapping.targetField || ""}
                onChange={(e) =>
                  handleFieldChange(
                    index,
                    (e.target.value as RiderFieldKey) || null
                  )
                }
                className={styles.fieldSelect}
              >
                {availableFields.map((field) => (
                  <option key={field || "none"} value={field || ""}>
                    {field ? getFieldLabel(field) : "(Skip this column)"}
                  </option>
                ))}
              </select>
              {mapping.targetField && FIELD_HINTS[mapping.targetField] && (
                <div className={styles.fieldHint}>
                  {FIELD_HINTS[mapping.targetField]}
                </div>
              )}
            </div>

            <div className={styles.colConfidence} data-label="Confidence">
              {getConfidenceBadge(mapping.confidence)}
            </div>
          </div>
        ))}
      </div>

      {/* ── Save as template ── */}
      <div className={styles.saveTemplate}>
        {!showSaveForm ? (
          <button
            className={styles.saveTplBtn}
            onClick={() => { setShowSaveForm(true); if (!savingName) setSavingName(suggestedName); }}
          >
            💾 Save as template
          </button>
        ) : (
          <div className={styles.saveForm}>
            <input
              ref={saveInputRef}
              className={styles.saveInput}
              type="text"
              placeholder="Template name…"
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTemplate();
                if (e.key === "Escape") {
                  setShowSaveForm(false);
                  setSavingName("");
                }
              }}
            />
            <button
              className={styles.saveConfirmBtn}
              onClick={handleSaveTemplate}
              disabled={!savingName.trim()}
            >
              Save
            </button>
            <button
              className={styles.cancelTplBtn}
              onClick={() => {
                setShowSaveForm(false);
                setSavingName("");
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button onClick={onBack} className={styles.backButton}>
          ← Back
        </button>
        <button
          onClick={handleConfirm}
          className={styles.confirmButton}
          disabled={mappedCount === 0}
        >
          Continue to Preview →
        </button>
      </div>
    </div>
  );
}
