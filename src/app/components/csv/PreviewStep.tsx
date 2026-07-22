"use client";

import { useState, useEffect } from "react";
import type {
  CSVParseResult,
  ColumnMapping,
  ValidationResult,
  ValidationIssue,
  RiderFieldKey
} from "@/types/csv.types";
import { splitFullName } from "@/services/csvMapper";
import styles from "./previewStep.module.css";

interface PreviewStepProps {
  parseResult: CSVParseResult;
  mappings: ColumnMapping[];
  onStartImport: (validation: ValidationResult) => void;
  onBack: () => void;
  onClose?: () => void;
}

interface ParsedRider {
  [key: string]: string;
}

const FIELD_LABELS: Record<RiderFieldKey, string> = {
  bibNumber: "Bib #",
  firstName: "First Name",
  middleName: "Middle Name",
  lastName: "Last Name",
  fullName: "Full Name",
  firstNameEnglish: "First Name (EN)",
  lastNameEnglish: "Last Name (EN)",
  category: "Category",
  subCategory: "Sub-Category",
  team: "Team / Club",
  gender: "Gender",
  heat: "Wave / Heat",
  startTime: "Start Time",
  totalLaps: "Total Laps",
  position: "Position",
  standing: "Standing",
  raceDay: "Race Day",
  points: "Points",
  uciPoints: "UCI Points",
  federation: "Federation",
  uciNumber: "UCI Number",
  idNumber: "ID Number",
  birthDate: "Birth Date",
  federationNumber: "Fed. Number",
  federationChip: "Fed. Chip",
  roadNumber: "Road Number",
  chip: "Chip",
  notes: "Notes",
  infoField: "Info (on card)",
};

export default function PreviewStep({
  parseResult,
  mappings,
  onStartImport,
  onBack,
  onClose
}: PreviewStepProps) {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [activeTab, setActiveTab] = useState<"mapped" | "original">("mapped");

  useEffect(() => {
    validateData();
  }, [parseResult, mappings]);

  const parseRowToRider = (row: string[]): ParsedRider => {
    const rider: ParsedRider = {};
    mappings.forEach((mapping, index) => {
      if (mapping.targetField && row[index]) {
        const value = row[index].trim();
        if (mapping.targetField === "fullName") {
          const { firstName, lastName } = splitFullName(value);
          rider.firstName = firstName;
          rider.lastName = lastName;
        } else {
          rider[mapping.targetField] = value;
        }
      }
    });
    return rider;
  };

  const validateData = () => {
    const issues: ValidationIssue[] = [];
    const bibNumbers = new Set<string>();

    parseResult.rows.forEach((row, rowIndex) => {
      const rider = parseRowToRider(row);
      const lineNumber = rowIndex + 1 + parseResult.detection.headerRow;

      if (!rider.bibNumber) {
        issues.push({ row: lineNumber, field: "bibNumber", message: "Bib number is required", severity: "error", value: "" });
      } else if (bibNumbers.has(rider.bibNumber)) {
        issues.push({ row: lineNumber, field: "bibNumber", message: "Duplicate bib number", severity: "error", value: rider.bibNumber });
      } else {
        bibNumbers.add(rider.bibNumber);
      }

      if (!rider.firstName && !rider.fullName) {
        issues.push({ row: lineNumber, field: "firstName", message: "First name is required", severity: "warning", value: "" });
      }

      if (rider.heat) {
        const heatNum = parseInt(rider.heat);
        if (isNaN(heatNum) || heatNum < 1 || heatNum > 99) {
          issues.push({ row: lineNumber, field: "heat", message: "Heat must be a number between 1-99", severity: "warning", value: rider.heat });
        }
      }

      if (rider.startTime) {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
        if (!timeRegex.test(rider.startTime)) {
          issues.push({ row: lineNumber, field: "startTime", message: "Start time must be in HH:MM or HH:MM:SS format", severity: "warning", value: rider.startTime });
        }
      }

      if (rider.totalLaps) {
        const laps = parseInt(rider.totalLaps);
        if (isNaN(laps) || laps < 1 || laps > 99) {
          issues.push({ row: lineNumber, field: "totalLaps", message: "Total laps must be a number between 1-99", severity: "info", value: rider.totalLaps });
        }
      }
    });

    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    const infos = issues.filter((i) => i.severity === "info");

    setValidation({
      isValid: errors.length === 0,
      issues,
      summary: {
        total: parseResult.rows.length,
        errors: errors.length,
        warnings: warnings.length,
        info: infos.length
      }
    });
  };

  const handleStartImport = () => {
    if (!validation) return;
    if (validation.summary.errors > 0) {
      const confirmImport = window.confirm(
        `There are ${validation.summary.errors} errors in the data. Rows with errors will be skipped. Continue?`
      );
      if (!confirmImport) return;
    }
    onStartImport(validation);
  };

  const getVisibleRows = () => {
    if (!showOnlyErrors || !validation) return parseResult.rows;
    const errorRows = new Set(
      validation.issues
        .filter((i) => i.severity === "error")
        .map((i) => i.row - parseResult.detection.headerRow - 1)
    );
    return parseResult.rows.filter((_, index) => errorRows.has(index));
  };

  const getRowIssues = (rowIndex: number): ValidationIssue[] => {
    if (!validation) return [];
    const lineNumber = rowIndex + 1 + parseResult.detection.headerRow;
    return validation.issues.filter((i) => i.row === lineNumber);
  };

  const visibleRows = getVisibleRows();
  const mappedFields = mappings.filter((m) => m.targetField !== null);

  return (
    <div className={styles.previewStep}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button onClick={onBack} className={styles.backButtonTop}>← Back</button>
          <h3>Preview & Validate</h3>
        </div>
        <div className={styles.headerRight}>
          {validation && (
            <div className={styles.validationSummary}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Total:</span>
                <span className={styles.summaryValue}>{validation.summary.total}</span>
              </div>
              {validation.summary.errors > 0 && (
                <div className={`${styles.summaryItem} ${styles.error}`}>
                  <span className={styles.summaryLabel}>Errors:</span>
                  <span className={styles.summaryValue}>{validation.summary.errors}</span>
                </div>
              )}
              {validation.summary.warnings > 0 && (
                <div className={`${styles.summaryItem} ${styles.warning}`}>
                  <span className={styles.summaryLabel}>Warnings:</span>
                  <span className={styles.summaryValue}>{validation.summary.warnings}</span>
                </div>
              )}
            </div>
          )}
          {onClose && (
            <button onClick={onClose} className={styles.closeButton} title="Close wizard">✕</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === "mapped" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("mapped")}
        >
          Mapped Data
          {mappedFields.length > 0 && (
            <span className={styles.tabBadge}>{mappedFields.length} fields</span>
          )}
        </button>
        <button
          className={`${styles.tab} ${activeTab === "original" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("original")}
        >
          Original File
          <span className={styles.tabBadge}>{parseResult.headers.length} columns</span>
        </button>
      </div>

      {/* Error alert */}
      {validation && validation.summary.errors > 0 && (
        <div className={styles.errorAlert}>
          <strong>Validation Errors Found</strong>
          <p>Rows with errors will be skipped during import. Fix the CSV file or continue to skip error rows.</p>
          <label className={styles.filterCheckbox}>
            <input
              type="checkbox"
              checked={showOnlyErrors}
              onChange={(e) => setShowOnlyErrors(e.target.checked)}
            />
            Show only rows with errors
          </label>
        </div>
      )}

      {/* MAPPED TAB */}
      {activeTab === "mapped" && (
        <>
          {mappedFields.length === 0 ? (
            <div className={styles.errorAlert}>
              <strong>No Columns Mapped</strong>
              <p>Please go back to the mapping step and map at least one column to continue.</p>
            </div>
          ) : (
            <div className={styles.previewTable}>
              <table>
                <thead>
                  <tr>
                    <th className={styles.rowNumCol}>#</th>
                    {mappedFields.map((mapping, index) => (
                      <th key={index}>
                        {FIELD_LABELS[mapping.targetField!] || mapping.targetField}
                        <div className={styles.originalColName}>{mapping.sourceColumn}</div>
                      </th>
                    ))}
                    <th className={styles.issuesCol}>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, rowIndex) => {
                    const actualRowIndex = showOnlyErrors ? parseResult.rows.indexOf(row) : rowIndex;
                    const issues = getRowIssues(actualRowIndex);
                    const hasError = issues.some((i) => i.severity === "error");
                    return (
                      <tr key={actualRowIndex} className={hasError ? styles.errorRow : ""}>
                        <td className={styles.rowNumCol}>{actualRowIndex + 1}</td>
                        {mappedFields.map((mapping, colIndex) => {
                          const headerIndex = mappings.indexOf(mapping);
                          const value = row[headerIndex] || "-";
                          const fieldIssues = issues.filter((i) => i.field === mapping.targetField);
                          return (
                            <td key={colIndex} dir="auto" className={fieldIssues.length > 0 ? styles.errorCell : ""}>
                              {value}
                            </td>
                          );
                        })}
                        <td className={styles.issuesCol}>
                          {issues.length > 0 && (
                            <div className={styles.issuesList}>
                              {issues.map((issue, i) => (
                                <div
                                  key={i}
                                  className={`${styles.issue} ${styles[issue.severity]}`}
                                  title={issue.message}
                                >
                                  {issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️"}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ORIGINAL FILE TAB */}
      {activeTab === "original" && (
        <div className={styles.previewTable}>
          <table>
            <thead>
              <tr>
                <th className={styles.rowNumCol}>#</th>
                {parseResult.headers.map((header, colIndex) => {
                  const mapping = mappings[colIndex];
                  const isMapped = mapping?.targetField != null;
                  return (
                    <th key={colIndex} className={isMapped ? styles.mappedHeader : styles.unmappedHeader}>
                      <div className={styles.originalHeaderName}>{header}</div>
                      {isMapped ? (
                        <div className={styles.mappedBadge}>
                          → {FIELD_LABELS[mapping.targetField!] || mapping.targetField}
                        </div>
                      ) : (
                        <div className={styles.ignoredBadge}>ignored</div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {parseResult.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className={styles.rowNumCol}>{rowIndex + 1}</td>
                  {parseResult.headers.map((_, colIndex) => {
                    const mapping = mappings[colIndex];
                    const isMapped = mapping?.targetField != null;
                    return (
                      <td
                        key={colIndex}
                        dir="auto"
                        className={isMapped ? "" : styles.unmappedCell}
                      >
                        {row[colIndex] || "-"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        <button onClick={onBack} className={styles.backButton}>← Back to Mapping</button>
        <button
          onClick={handleStartImport}
          className={styles.importButton}
          disabled={
            !validation ||
            mappedFields.length === 0 ||
            (validation.summary.errors > 0 && validation.summary.errors === validation.summary.total)
          }
        >
          Import {validation && validation.summary.total - validation.summary.errors} Riders →
        </button>
      </div>
    </div>
  );
}
