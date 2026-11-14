"use client";

import { useState, useEffect, useRef } from "react";
import { Check, ChevronDown, Layers, Plus, Save, Search, X } from "lucide-react";
import type { ColumnMapping, RiderFieldKey, MappingTemplate } from "@/types/csv.types";
import { FIELD_KEYWORDS, IGNORED_FIELDS, OPT_IN_FIELDS, isIdColumnHeader } from "@/types/csv.types";
import {
  confirmMapping,
  detectNameSplitting,
  resolveColumnRules
} from "@/services/csvMapper";
import { rememberSharedMappings } from "@/services/sharedColumnMappings";
import {
  getAllTemplates,
  saveTemplate,
  touchTemplate,
  removeTemplate
} from "@/services/templateStorage";
import styles from "./columnMappingStep.module.css";

interface ColumnMappingStepProps {
  headers: string[];
  mappings: ColumnMapping[];
  sampleRows: string[][];
  /** Every data row — needed to tell whether a column is empty throughout. */
  allRows: string[][];
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

/** The fields nearly every start list needs: listed first in the picker. */
const MAIN_FIELDS: RiderFieldKey[] = [
  "bibNumber", "firstName", "lastName", "fullName", "category", "team", "gender", "startTime", "heat", "totalLaps",
];

export default function ColumnMappingStep({
  headers,
  mappings: initialMappings,
  sampleRows,
  allRows,
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


  // Column whose app field is being chosen, and columns opened to show their data
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [bibMissing, setBibMissing] = useState(false);
  // Phase 2: "remember these mappings?" — asked once on Continue, never saved silently.
  const [rememberAsk, setRememberAsk] = useState<{ index: number; header: string; field: RiderFieldKey; checked: boolean }[] | null>(null);
  const [remembering, setRemembering] = useState(false);
  const [sharedUnconfirmed, setSharedUnconfirmed] = useState(false);

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

  useEffect(() => {
    if (pickerFor === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPickerFor(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerFor]);

  const handleFieldChange = async (
    index: number,
    newField: RiderFieldKey | null
  ) => {
    // A field feeds from one column: taking it frees whichever column had it
    // (info is the exception, many columns can be info).
    const updated = mappings.map((m, i) =>
      i !== index && newField && newField !== "infoField" && m.targetField === newField
        ? { ...m, targetField: null, confidence: 0, isAutoMapped: false, needsConfirmation: false, required: undefined, unique: undefined }
        : m
    );
    updated[index] = {
      ...updated[index],
      targetField: newField,
      confidence: newField ? 100 : 0,
      isAutoMapped: false,
      needsConfirmation: false,
      // A different field gets fresh defaults, not the old field's choices
      required: undefined,
      unique: undefined
    };
    setMappings(updated);
    if (newField === "bibNumber") setBibMissing(false);
    // Nothing is remembered here any more (Phase 2): Continue OFFERS to remember the
    // corrections; "Keep as info" is per file and never remembered (BUGS.md #7).
  };

  /** Keeps the suggested field and marks it confirmed. */
  const confirmSuggested = (index: number) => {
    setMappings((prev) => prev.map((m, i) => (i === index ? { ...m, needsConfirmation: false, confidence: 100 } : m)));
  };

  /**
   * What the organizer decided by hand: a field changed from what was proposed, or other
   * organizers' suggestion confirmed. Those are worth remembering; untouched built-in
   * matches are not. Never "Keep as info", never an identity column.
   */
  const rememberCandidates = () =>
    mappings.flatMap((m, index) => {
      const field = m.targetField;
      if (!field || field === "infoField" || isIdColumnHeader(m.sourceColumn)) return [];
      const initial = initialMappings[index];
      const changed = initial?.targetField !== field;
      const confirmedShared = m.source === "shared" && !m.needsConfirmation;
      return changed || confirmedShared ? [{ index, header: m.sourceColumn, field, checked: true }] : [];
    });

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

  const proceed = () =>
    // Freeze the effective rules so the preview validates exactly what was shown
    onConfirm(
      mappings.map((m, i) => ({ ...m, ...resolveColumnRules(m, i, allRows) }))
    );

  const handleConfirm = () => {
    const hasBibNumber = mappings.some((m) => m.targetField === "bibNumber");
    if (!hasBibNumber) {
      setBibMissing(true);
      return;
    }
    // Other organizers' suggestions are never taken on trust: confirm or change each.
    if (mappings.some((m) => m.source === "shared" && m.needsConfirmation && m.targetField)) {
      setSharedUnconfirmed(true);
      return;
    }
    setSharedUnconfirmed(false);
    const ask = rememberCandidates();
    if (ask.length > 0 && rememberAsk === null) {
      setRememberAsk(ask);
      return;
    }
    proceed();
  };

  const finishRemember = async (save: boolean) => {
    if (remembering) return;
    if (save && rememberAsk) {
      const chosen = rememberAsk.filter((r) => r.checked);
      setRemembering(true);
      try {
        // This device first (works offline), then the account / shared dictionary.
        await Promise.all(chosen.map((r) => confirmMapping(r.header, r.field)));
        await rememberSharedMappings(chosen.map((r) => ({ header: r.header, field: r.field })));
      } finally {
        setRemembering(false);
      }
    }
    setRememberAsk(null);
    proceed();
  };

  const setRule = (index: number, rule: "required" | "unique", value: boolean) => {
    setMappings((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [rule]: value } : m))
    );
  };

  const FIELD_LABELS: Record<string, string> = {
    bibNumber: "Bib",
    firstName: "First Name",
    middleName: "Middle Name",
    lastName: "Last Name",
    fullName: "Full Name",
    firstNameEnglish: "First Name (English)",
    lastNameEnglish: "Last Name (English)",
    category: "Category",
    subCategory: "Sub-Category (not imported)",
    team: "Team / Club",
    gender: "Gender",
    heat: "Wave Number",
    startTime: "Start Time",
    totalLaps: "Total Laps",
    position: "Start Position",
    standing: "Standing / Ranking",
    raceDay: "Race Day",
    points: "Points",
    uciPoints: "UCI Points",
    federation: "Federation",
    uciNumber: "UCI ID (11 digits)",
    bibColor: "Bib Background Color",
    bibTextColor: "Bib Text Color",
    birthDate: "Birth Date",
    federationNumber: "Federation Number",
    federationChip: "Federation Chip",
    roadNumber: "Road Number",
    chip: "Chip",
    notes: "Notes",
    infoField: "Keep as info (show on card)",
  };

  const FIELD_HINTS: Partial<Record<string, string>> = {
    infoField:
      "Stored as-is under this column's name and shown in the rider card's \"More info\" — not used by the app. Several columns can be info.",
    category: "Main group — e.g. Men Junior, Gravel, MTB",
    subCategory:
      "Not imported — categories are flat. Put the age band in the category itself, e.g. \"Man Masters 30-39\"",
    heat: "Wave group number — e.g. 1, 2, 3  (not a clock time)",
    startTime: "Clock start time — e.g. 09:00, 11:30  (not a wave number)",
  };

  const getFieldLabel = (field: RiderFieldKey): string =>
    FIELD_LABELS[field] || field;

  // IGNORED_FIELDS stay out of the picker — they are detected only so their
  // column isn't misread as something else, never imported (BUGS.md #2).
  const pickableFields = [...new Set([...FIELD_KEYWORDS.map((f) => f.field), ...OPT_IN_FIELDS])].filter((f) => !IGNORED_FIELDS.has(f));
  const mainFields = MAIN_FIELDS.filter((f) => pickableFields.includes(f));
  const moreFields = pickableFields.filter((f) => !MAIN_FIELDS.includes(f));

  const toggleExpanded = (index: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const firstValue = (index: number) => sampleRows.map((r) => r[index]?.trim()).find(Boolean) ?? "";
  const filledCount = (index: number) => allRows.filter((r) => r[index]?.trim()).length;

  const openPicker = (index: number) => {
    setPickerSearch("");
    setPickerFor(index);
  };

  const pick = (field: RiderFieldKey) => {
    if (pickerFor === null) return;
    void handleFieldChange(pickerFor, field);
    setPickerFor(null);
  };

  /** Phase 2: where an automatic mapping came from (only what the organizer should know). */
  const provenance = (m: ColumnMapping) =>
    m.source === "personal" && m.isAutoMapped ? (
      <span className={styles.provenance} data-testid="map-provenance">Your saved mapping</span>
    ) : m.source === "shared" ? (
      <span className={styles.provenance} data-source="shared" data-testid="map-provenance">
        {m.needsConfirmation ? "Suggested" : "Confirmed"} · used by {m.sharedUsers ?? 2} organizers
      </span>
    ) : m.sharedConflict ? (
      <span className={styles.provenance} data-source="conflict" data-testid="map-provenance">Organizers map this column differently</span>
    ) : null;

  const isUsed = (m: ColumnMapping) => m.targetField !== null && !isIdColumnHeader(m.sourceColumn);
  const rows = mappings.map((mapping, index) => ({ mapping, index }));
  const notUsed = rows.filter((r) => !isUsed(r.mapping));
  const used = rows.filter((r) => isUsed(r.mapping));
  const mappedCount = used.length;
  const toCheckCount = used.filter((r) => r.mapping.needsConfirmation).length;

  const expandButton = (index: number, name: string) => (
    <button
      type="button"
      className={styles.iconBtn}
      aria-expanded={expanded.has(index)}
      aria-label={`${expanded.has(index) ? "Hide" : "Show"} data of ${name}`}
      onClick={() => toggleExpanded(index)}
    >
      <ChevronDown size={16} className={expanded.has(index) ? styles.chevronOpen : undefined} />
    </button>
  );

  const dataPanel = (index: number, extra?: React.ReactNode) =>
    expanded.has(index) && (
      <div className={styles.dataPanel} data-testid={`map-data-${index}`}>
        <div className={styles.dataCount}>{filledCount(index)} of {allRows.length} rows filled</div>
        <div className={styles.dataCount}>Examples</div>
        <div className={styles.dataValues}>
          {sampleRows.map((row, i) => (
            <span key={i} className={styles.dataValue} dir="auto">{row[index]?.trim() || "—"}</span>
          ))}
        </div>
        {extra}
      </div>
    );

  const fieldOption = (field: RiderFieldKey) => {
    const current = pickerFor !== null && mappings[pickerFor].targetField === field;
    const holder = field !== "infoField" && !current
      ? mappings.find((m) => m.targetField === field)?.sourceColumn
      : undefined;
    return (
      <button
        key={field}
        type="button"
        className={`${styles.pickerItem} ${current ? styles.pickerItemCurrent : ""}`}
        onClick={() => pick(field)}
        data-testid={`map-field-${field}`}
      >
        <span className={styles.pickerLabel}>{getFieldLabel(field)}</span>
        {holder && <span className={styles.pickerNote} dir="auto">Now: {holder}</span>}
        {current && <Check size={16} aria-hidden="true" />}
      </button>
    );
  };

  const matchesPickerSearch = (field: RiderFieldKey) =>
    getFieldLabel(field).toLowerCase().includes(pickerSearch.trim().toLowerCase());
  const shownMain = mainFields.filter(matchesPickerSearch);
  const shownMore = moreFields.filter(matchesPickerSearch);

  return (
    <div className={styles.mappingStep}>
      <div className={styles.header}>
        <h3>Match your columns</h3>
        <span className={styles.stat} data-testid="map-count">
          {mappedCount} of {mappings.length} imported
          {toCheckCount > 0 && <span className={styles.statCheck}> · {toCheckCount} to check</span>}
        </span>
      </div>

      <div className={styles.tools}>
        {templates.length > 0 && (
          <button
            type="button"
            className={styles.toolBtn}
            aria-expanded={showTemplates}
            onClick={() => setShowTemplates((v) => !v)}
          >
            <Layers size={14} aria-hidden="true" /> Templates ({templates.length})
          </button>
        )}
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => { setShowSaveForm(true); if (!savingName) setSavingName(suggestedName); }}
        >
          <Save size={14} aria-hidden="true" /> Save as template
        </button>
      </div>

      {showTemplates && templates.length > 0 && (
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
                <button className={styles.applyBtn} onClick={() => handleApplyTemplate(tpl)}>
                  Apply
                </button>
                <button
                  className={styles.iconBtn}
                  onClick={(e) => handleDeleteTemplate(tpl.id, e)}
                  title="Delete template"
                  aria-label={`Delete template ${tpl.name}`}
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showSaveForm && (
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
          <button className={styles.applyBtn} onClick={handleSaveTemplate} disabled={!savingName.trim()}>
            Save
          </button>
          <button
            className={styles.iconBtn}
            aria-label="Cancel"
            onClick={() => {
              setShowSaveForm(false);
              setSavingName("");
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {appliedMsg && <div className={styles.note}>{appliedMsg}</div>}



      {splitFullName && (
        <div className={styles.note}>
          Full names will be split into first and last name automatically.
        </div>
      )}

      {bibMissing && (
        <div className={styles.noteError} role="alert">
          Choose which column holds the Bib to continue.
        </div>
      )}

      <div className={styles.columns}>
        {/* Top: what gets imported, starting with everything recognised automatically. X removes one. */}
        <section className={styles.list} data-testid="map-used">
          <h4 className={styles.listTitle}>Imported <span>{used.length}</span></h4>
          {used.length === 0 && <p className={styles.listEmpty}>Tap + below to import a column.</p>}
          {used.length > 0 && (
            <div className={styles.colHead} data-testid="map-col-head">
              <span className={styles.colHeadFile}>In your file</span>
              <span className={styles.equals} aria-hidden="true">=</span>
              <span className={styles.colHeadField}>App field</span>
            </div>
          )}
          {used.map(({ mapping, index }) => {
            const field = mapping.targetField as RiderFieldKey;
            const rules = resolveColumnRules(mapping, index, allRows);
            return (
              <div key={index} className={styles.row}>
                <div className={styles.rowLine}>
                  {expandButton(index, mapping.sourceColumn)}
                  <div className={styles.rowMain}>
                    <strong dir="auto">{mapping.sourceColumn}</strong>
                    <span className={styles.rowSample} dir="auto">{firstValue(index) || "Empty"}</span>
                    {provenance(mapping)}
                  </div>
                  <span className={styles.equals} aria-hidden="true">=</span>
                  <button
                    type="button"
                    className={`${styles.fieldBtn} ${mapping.needsConfirmation ? styles.fieldBtnCheck : ""}`}
                    aria-label={`App field for ${mapping.sourceColumn}: ${getFieldLabel(field)}`}
                    title={mapping.needsConfirmation ? "Best guess: tap to confirm or change" : "Change field"}
                    onClick={() => openPicker(index)}
                    data-testid={`map-field-btn-${index}`}
                  >
                    <span>{getFieldLabel(field)}</span>
                  </button>
                  {mapping.source === "shared" && mapping.needsConfirmation && (
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label={`Confirm ${getFieldLabel(field)} for ${mapping.sourceColumn}`}
                      title="Confirm this suggestion"
                      onClick={() => confirmSuggested(index)}
                      data-testid={`map-confirm-${index}`}
                    >
                      <Check size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.removeBtn}
                    aria-label={`Don't import ${mapping.sourceColumn}`}
                    title="Don't import this column"
                    onClick={() => void handleFieldChange(index, null)}
                    data-testid={`map-return-${index}`}
                  >
                    <X size={18} />
                  </button>
                </div>
                {dataPanel(index, (
                  <>
                    {FIELD_HINTS[field] && <div className={styles.fieldHint}>{FIELD_HINTS[field]}</div>}
                    {field !== "infoField" && (
                      <div className={styles.ruleRow}>
                        <label title="Rows where this is empty are flagged in the preview">
                          <input
                            type="checkbox"
                            checked={rules.required}
                            onChange={(e) => setRule(index, "required", e.target.checked)}
                          />{" "}
                          Required
                        </label>
                        <label title="Rows repeating an earlier value are flagged in the preview">
                          <input
                            type="checkbox"
                            checked={rules.unique}
                            onChange={(e) => setRule(index, "unique", e.target.checked)}
                          />{" "}
                          Unique
                        </label>
                      </div>
                    )}
                  </>
                ))}
              </div>
            );
          })}
        </section>

        {/* Bottom: columns in the file that aren't imported. + sends one up. */}
        <section className={`${styles.list} ${styles.listOff}`} data-testid="map-not-used">
          <h4 className={styles.listTitle}>Not imported <span>{notUsed.length}</span></h4>
          {notUsed.length === 0 && <p className={styles.listEmpty}>Every column is imported.</p>}
          {notUsed.map(({ mapping, index }) => {
            const blocked = isIdColumnHeader(mapping.sourceColumn);
            return (
              <div key={index} className={styles.row}>
                <div className={styles.rowLine}>
                  {expandButton(index, mapping.sourceColumn)}
                  <div className={styles.rowMain}>
                    <strong dir="auto">{mapping.sourceColumn}</strong>
                    {blocked ? (
                      <span className={styles.rowSample} data-testid="id-column-skipped" dir="auto">
                        Never stored: ID and passport numbers
                      </span>
                    ) : (
                      <span className={styles.rowSample} dir="auto">{firstValue(index) || "Empty"}</span>
                    )}
                    {!blocked && provenance(mapping)}
                  </div>
                  {!blocked && (
                    <button
                      type="button"
                      className={styles.addBtn}
                      aria-label={`Import ${mapping.sourceColumn}`}
                      title="Import this column"
                      onClick={() => openPicker(index)}
                      data-testid={`map-use-${index}`}
                    >
                      <Plus size={18} />
                    </button>
                  )}
                </div>
                {dataPanel(index)}
              </div>
            );
          })}
        </section>
      </div>

      {sharedUnconfirmed && (
        <div className={styles.noteError} role="alert" data-testid="map-shared-unconfirmed">
          Confirm (✓) or change the columns suggested by other organizers to continue.
        </div>
      )}

      {rememberAsk && (
        <div className={styles.rememberPanel} role="dialog" aria-label="Remember these column mappings" data-testid="map-remember">
          <strong>Remember {rememberAsk.length === 1 ? "this mapping" : "these mappings"} for next time?</strong>
          <p>Next imports will read these columns the same way for you. Other organizers only see it as a suggestion they must confirm.</p>
          <ul>
            {rememberAsk.map((r) => (
              <li key={r.index}>
                <label>
                  <input
                    type="checkbox"
                    checked={r.checked}
                    onChange={(e) => setRememberAsk((prev) => prev && prev.map((x) => (x.index === r.index ? { ...x, checked: e.target.checked } : x)))}
                  />{" "}
                  <span dir="auto">{r.header}</span> → {getFieldLabel(r.field)}
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.rememberActions}>
            <button type="button" className={styles.backButton} onClick={() => void finishRemember(false)} disabled={remembering} data-testid="map-remember-skip">
              Not now
            </button>
            <button type="button" className={styles.confirmButton} onClick={() => void finishRemember(true)} disabled={remembering} data-testid="map-remember-save">
              {remembering ? "Saving…" : "Remember"}
            </button>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button onClick={onBack} className={styles.backButton}>
          Back
        </button>
        <button
          onClick={handleConfirm}
          className={styles.confirmButton}
          disabled={mappedCount === 0}
          data-testid="map-continue"
        >
          Continue to Preview
        </button>
      </div>

      {pickerFor !== null && (
        <div className={styles.pickerOverlay} onClick={() => setPickerFor(null)}>
          <div
            className={styles.picker}
            role="dialog"
            aria-modal="true"
            aria-label={`Choose the app field for ${mappings[pickerFor].sourceColumn}`}
            onClick={(e) => e.stopPropagation()}
            data-testid="map-picker"
          >
            <div className={styles.pickerHead}>
              <div className={styles.rowMain}>
                <strong dir="auto">{mappings[pickerFor].sourceColumn}</strong>
                <span className={styles.rowSample} dir="auto">{firstValue(pickerFor) || "Empty"}</span>
              </div>
              <button type="button" className={styles.iconBtn} aria-label="Close" onClick={() => setPickerFor(null)}>
                <X size={16} />
              </button>
            </div>
            <div className={styles.pickerSearch}>
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                dir="auto"
                placeholder="Find a field"
                aria-label="Find a field"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
              />
            </div>
            <div className={styles.pickerList}>
              {shownMain.map(fieldOption)}
              {shownMore.length > 0 && <div className={styles.pickerGroup}>More fields</div>}
              {shownMore.map(fieldOption)}
              <div className={styles.pickerGroup}>Not a rider field</div>
              {fieldOption("infoField")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
