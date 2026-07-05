"use client";

import { useState } from "react";
import type {
  CSVParseResult,
  ColumnMapping,
  ValidationResult,
  ImportProgress,
  MappingTemplate
} from "@/types/csv.types";
import type { RiderProps, RaceProps } from "@/types/types";
import { parseCSVFile } from "@/utils/csvParser";
import { parseXLSXFile } from "@/utils/xlsxParser";
import { autoMapColumns, splitFullName } from "@/services/csvMapper";
import { touchTemplate } from "@/services/templateStorage";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import useRaceStore from "@/stores/racesStore";
import useClubDictionaryStore from "@/stores/clubDictionaryStore";
import UploadStep from "./UploadStep";
import ColumnMappingStep from "./ColumnMappingStep";
import PreviewStep from "./PreviewStep";
import ImportProgressStep from "./ImportProgressStep";
import MultiDayDialog from "./MultiDayDialog";
import ImageCapture from "@/components/importImage/ImageCapture";
import styles from "./csvImportWizard.module.css";

type WizardStep = "upload" | "mapping" | "preview" | "importing";

interface CSVImportWizardProps {
  raceUuid: string;
  onClose: () => void;
  onComplete?: (count: number) => void;
  /** "scan" opens directly on the photo-OCR source instead of file upload */
  initialMode?: "file" | "scan";
}

const STEP_ORDER: WizardStep[] = ["upload", "mapping", "preview", "importing"];

function rowToRider(
  row: string[],
  mappings: ColumnMapping[],
  raceUuid: string,
  index: number,
  heatNameToNumber: Map<string, number> = new Map(),
  clubDictionary?: typeof useClubDictionaryStore
): RiderProps {
  const data: Record<string, any> = {};

  mappings.forEach((mapping, colIdx) => {
    if (!mapping.targetField) return;
    const value = row[colIdx]?.trim() || "";

    switch (mapping.targetField) {
      case "bibNumber":
        data.bibNumber = parseInt(value) || 0;
        break;
      case "firstName":
        data.firstName = value;
        break;
      case "middleName":
        data.middleName = value || null;
        break;
      case "lastName":
        data.lastName = value;
        break;
      case "fullName": {
        const { firstName, lastName } = splitFullName(value);
        data.firstName = firstName;
        data.lastName = lastName;
        break;
      }
      case "category":
        data.category = value;
        break;
      case "subCategory":
        data.subCategory = value || null;
        break;
      case "team": {
        let teamValue = value || null;
        // Apply club dictionary mapping if available
        if (clubDictionary && teamValue) {
          const getStandardName = clubDictionary.getState().getStandardName;
          const standardName = getStandardName(teamValue);
          if (standardName) {
            teamValue = standardName;
            const incrementUsageCount = clubDictionary.getState().incrementUsageCount;
            // Find the matching entry to increment usage
            const entries = clubDictionary.getState().getAllEntries();
            const entry = entries.find(e =>
              e.hebrewName.toLowerCase() === value.toLowerCase() ||
              e.alternateNames.some(alt => alt.toLowerCase() === value.toLowerCase())
            );
            if (entry) incrementUsageCount(entry.id);
          }
        }
        data.team = teamValue;
        break;
      }
      case "heat": {
        const numVal = parseInt(value);
        // Use numeric value if available, otherwise look up from name map
        data.heat = !isNaN(numVal) ? numVal : (heatNameToNumber.get(value) ?? 0);
        break;
      }
      case "startTime":
        data.timeStartRace = value || null;
        break;
      case "totalLaps":
        data.totalLaps = parseInt(value) || 0;
        break;
      case "position":
        data.position_start = parseInt(value) || null;
        break;
      case "standing":
        data.standing = parseInt(value) || null;
        break;
      case "points":
        data.points = parseFloat(value) || null;
        break;
      case "federation":
        data.federation = value || null;
        break;
      case "firstNameEnglish":
        data.firstNameEnglish = value || null;
        break;
      case "lastNameEnglish":
        data.lastNameEnglish = value || null;
        break;
      case "uciNumber":
        data.uciNumber = value || null;
        break;
      case "idNumber":
        data.idNumber = value || null;
        break;
      case "birthDate":
        data.birthDate = value || null;
        break;
      case "federationNumber":
        data.federationNumber = value || null;
        break;
      case "federationChip":
        data.federationChip = value || null;
        break;
      case "roadNumber":
        data.roadNumber = value || null;
        break;
      case "chip":
        data.chip = value || null;
        break;
      case "notes":
        data.notes = value || null;
        break;
      case "raceDay":
        // grouping only — not stored on rider
        break;
    }
  });

  return {
    id: Date.now() + index,
    raceUuid,
    bibNumber: data.bibNumber ?? 0,
    firstName: data.firstName ?? "",
    middleName: data.middleName ?? null,
    lastName: data.lastName ?? "",
    category: data.category ?? "",
    team: data.team ?? null,
    heat: data.heat ?? 0,
    totalLaps: data.totalLaps ?? 0,
    timeStartRace: data.timeStartRace ?? null,
    position_start: data.position_start ?? null,
    lapsCounter: 0,
    lapsDetails: [],
    checked: false,
    distance: 0,
    elapsedTimeFromStart: "0",
    timeArrive: null,
    flag: null,
    position_category: 0,
    position_race: 0,
    raceStatus: "upcoming",
    status: "standing",
    viewOrder: 0,
    color: null,
    elapsedLastLap: null,
    image: null,
    comment: null,
    points: data.points ?? null,
    federation: data.federation ?? null
  };
}

export default function CSVImportWizard({
  raceUuid,
  onClose,
  onComplete,
  initialMode = "file"
}: CSVImportWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("upload");
  const [scanMode, setScanMode] = useState(initialMode === "scan");
  const [parseResult, setParseResult] = useState<CSVParseResult | null>(null);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [skippedIssues, setSkippedIssues] = useState<import("@/types/csv.types").ValidationIssue[]>([]);
  const [suggestedName, setSuggestedName] = useState("");
  const [showMultiDayDialog, setShowMultiDayDialog] = useState(false);
  const [multiDayValues, setMultiDayValues] = useState<string[]>([]);
  const [multiDayRowCounts, setMultiDayRowCounts] = useState<Record<string, number>>({});

  const insertRiders = useRiderStore((state) => state.insertRiders);
  const rebuildCategoriesFromRiders = useCategoryStore((state) => state.rebuildCategoriesFromRiders);
  const races = useRaceStore((state) => state.races);
  const insertRace = useRaceStore((state) => state.insertRace);
  const updateRace = useRaceStore((state) => state.updateRace);
  const clubDictionary = useClubDictionaryStore;

  const handleFileUpload = async (file: File, template?: MappingTemplate) => {
    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      const result = isExcel ? await parseXLSXFile(file) : await parseCSVFile(file);
      setParseResult(result);
      const autoMappings = await autoMapColumns(result.headers);
      setSuggestedName(file.name.replace(/\.(xlsx?|csv)$/i, ""));

      if (template) {
        // Apply template: match sourceColumn case-insensitively, then jump to Preview
        const norm = (s: string) => s.toLowerCase().trim();
        const applied = autoMappings.map((m) => {
          const match = template.mappings.find(
            (t) => norm(t.sourceColumn) === norm(m.sourceColumn)
          );
          return match !== undefined
            ? { ...m, targetField: match.targetField, confidence: 100, isAutoMapped: false, needsConfirmation: false }
            : m;
        });
        setColumnMappings(applied);
        await touchTemplate(template.id);
        setCurrentStep("preview");
      } else {
        setColumnMappings(autoMappings);
        setCurrentStep("mapping");
      }
    } catch (error) {
      console.error("Failed to parse file:", error);
      alert("Failed to parse file. Please check the file format.");
    }
  };

  // Photo-OCR source: same handoff as handleFileUpload, minus file parsing
  const handleOcrParsed = async (result: CSVParseResult) => {
    setParseResult(result);
    const autoMappings = await autoMapColumns(result.headers);
    setSuggestedName("Scanned start list");
    setColumnMappings(autoMappings);
    setScanMode(false);
    setCurrentStep("mapping");
  };

  const handleMappingConfirm = (mappings: ColumnMapping[]) => {
    setColumnMappings(mappings);

    // Detect multi-day data
    const dayIdx = mappings.findIndex((m) => m.targetField === "raceDay");
    if (dayIdx >= 0 && parseResult) {
      const counts: Record<string, number> = {};
      for (const row of parseResult.rows) {
        const val = row[dayIdx]?.trim();
        if (val) counts[val] = (counts[val] ?? 0) + 1;
      }
      const days = Object.keys(counts).sort();
      if (days.length > 1) {
        setMultiDayValues(days);
        setMultiDayRowCounts(counts);
        setShowMultiDayDialog(true);
        return;
      }
    }

    setCurrentStep("preview");
  };

  const handleMultiDayAll = () => {
    setShowMultiDayDialog(false);
    setCurrentStep("preview");
  };

  const handleSplitByDay = async () => {
    if (!parseResult) return;
    setShowMultiDayDialog(false);
    setCurrentStep("importing");

    const dayIdx = columnMappings.findIndex((m) => m.targetField === "raceDay");
    const currentRace = races.find((r) => r.uuid === raceUuid);
    if (!currentRace) return;

    // Group rows by day value
    const grouped = new Map<string, string[][]>();
    for (const day of multiDayValues) grouped.set(day, []);
    for (const row of parseResult.rows) {
      const dayVal = row[dayIdx]?.trim() || multiDayValues[0];
      const target = grouped.has(dayVal) ? dayVal : multiDayValues[0];
      grouped.get(target)!.push(row);
    }

    let totalSuccessful = 0;
    const totalRows = parseResult.rows.length;

    setImportProgress({ total: totalRows, processed: 0, successful: 0, failed: 0, status: "importing" });

    for (let i = 0; i < multiDayValues.length; i++) {
      const day = multiDayValues[i];
      const rows = grouped.get(day) || [];
      let targetRaceUuid = raceUuid;

      if (i === 0) {
        // Rename current race to include day label
        await updateRace({ ...currentRace, name: `${currentRace.name} - ${day}` });
      } else {
        // Create a new race for this day
        const newUuid = crypto.randomUUID();
        const newRace: RaceProps = {
          ...currentRace,
          id: Date.now() + i,
          uuid: newUuid,
          name: `${currentRace.name} - ${day}`,
          createdAt: new Date(),
          lastUpdateAt: new Date()
        };
        await insertRace(newRace);
        targetRaceUuid = newUuid;
      }

      // Build heat name → number map
      const heatNameToNumber = new Map<string, number>();
      const heatColIdx = columnMappings.findIndex((m) => m.targetField === "heat");
      if (heatColIdx >= 0) {
        let nextHeatNum = 1;
        for (const row of rows) {
          const val = row[heatColIdx]?.trim();
          if (val && isNaN(Number(val)) && !heatNameToNumber.has(val)) {
            heatNameToNumber.set(val, nextHeatNum++);
          }
        }
      }

      const riders = rows.map((row, idx) =>
        rowToRider(row, columnMappings, targetRaceUuid, totalSuccessful + idx, heatNameToNumber, clubDictionary)
      );
      await insertRiders(riders);
      await rebuildCategoriesFromRiders(targetRaceUuid);
      totalSuccessful += riders.length;
    }

    setImportProgress({
      total: totalRows,
      processed: totalRows,
      successful: totalSuccessful,
      failed: 0,
      status: "completed"
    });
    onComplete?.(totalSuccessful);
  };

  const handleStartImport = async (validation: ValidationResult) => {
    if (!parseResult) return;
    setCurrentStep("importing");

    const errorIssues = validation.issues.filter((i) => i.severity === "error");
    const errorRowIndices = new Set(
      errorIssues.map((i) => i.row - parseResult.detection.headerRow - 1)
    );

    const totalInFile = parseResult.rows.length;
    const validRows = parseResult.rows.filter((_, i) => !errorRowIndices.has(i));
    const failedCount = errorRowIndices.size;

    setSkippedIssues(errorIssues);
    setImportProgress({
      total: totalInFile,
      processed: 0,
      successful: 0,
      failed: failedCount,
      status: "importing"
    });

    // Build text-heat → number map if heat column contains non-numeric strings
    const heatColIdx = columnMappings.findIndex((m) => m.targetField === "heat");
    const heatNameToNumber = new Map<string, number>();
    if (heatColIdx >= 0) {
      let nextHeatNum = 1;
      for (const row of parseResult.rows) {
        const val = row[heatColIdx]?.trim();
        if (val && isNaN(Number(val)) && !heatNameToNumber.has(val)) {
          heatNameToNumber.set(val, nextHeatNum++);
        }
      }
    }

    try {
      const riders = validRows.map((row, i) =>
        rowToRider(row, columnMappings, raceUuid, i, heatNameToNumber, clubDictionary)
      );
      await insertRiders(riders);
      await rebuildCategoriesFromRiders(raceUuid);
      setImportProgress({
        total: totalInFile,
        processed: totalInFile,
        successful: validRows.length,
        failed: failedCount,
        status: "completed"
      });
      onComplete?.(validRows.length);
    } catch (err) {
      console.error("Import failed:", err);
      setImportProgress((prev) =>
        prev
          ? { ...prev, processed: prev.total, successful: 0, failed: prev.total, status: "completed" }
          : null
      );
    }
  };

  const handleBack = () => {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx > 0) setCurrentStep(STEP_ORDER[idx - 1]);
  };

  const handleClose = () => {
    setCurrentStep("upload");
    setScanMode(false);
    setParseResult(null);
    setColumnMappings([]);
    setImportProgress(null);
    setSkippedIssues([]);
    setSuggestedName("");
    setShowMultiDayDialog(false);
    setMultiDayValues([]);
    setMultiDayRowCounts({});
    onClose();
  };

  const currentRaceName = races.find((r) => r.uuid === raceUuid)?.name ?? "";

  return (
    <div className={styles.wizard}>
      <div className={styles.header}>
        <h2>{currentStep === "upload" && scanMode ? "Import Riders from Photo" : "Import Riders from CSV"}</h2>
        <button className={styles.closeButton} onClick={handleClose}>
          ✕
        </button>
      </div>

      <div className={styles.progressBar}>
        {STEP_ORDER.map((step, i) => {
          const currentIdx = STEP_ORDER.indexOf(currentStep);
          const isActive = currentStep === step;
          const isCompleted = i < currentIdx;
          return (
            <div
              key={step}
              className={`${styles.step} ${isActive ? styles.active : ""} ${isCompleted ? styles.completed : ""}`}
            >
              <span className={styles.stepNumber}>{i + 1}</span>
              <span className={styles.stepLabel}>
                {step.charAt(0).toUpperCase() + step.slice(1)}
              </span>
            </div>
          );
        })}
      </div>

      {showMultiDayDialog && (
        <MultiDayDialog
          raceName={currentRaceName}
          dayValues={multiDayValues}
          rowCounts={multiDayRowCounts}
          onSplit={handleSplitByDay}
          onImportAll={handleMultiDayAll}
          onCancel={() => setShowMultiDayDialog(false)}
        />
      )}

      <div className={styles.content}>
        {currentStep === "upload" &&
          (scanMode ? (
            <ImageCapture
              onComplete={handleOcrParsed}
              onCancel={() => setScanMode(false)}
            />
          ) : (
            <UploadStep
              onFileUpload={(file, tpl) => handleFileUpload(file, tpl)}
              onScanClick={() => setScanMode(true)}
            />
          ))}
        {currentStep === "mapping" && parseResult && (
          <ColumnMappingStep
            headers={parseResult.headers}
            mappings={columnMappings}
            sampleRows={parseResult.rows.slice(0, 3)}
            onConfirm={handleMappingConfirm}
            onBack={handleBack}
            suggestedName={suggestedName}
          />
        )}
        {currentStep === "preview" && parseResult && (
          <PreviewStep
            parseResult={parseResult}
            mappings={columnMappings}
            onStartImport={handleStartImport}
            onBack={handleBack}
            onClose={handleClose}
          />
        )}
        {currentStep === "importing" && importProgress && (
          <ImportProgressStep
            progress={importProgress}
            skippedIssues={skippedIssues}
            onClose={handleClose}
          />
        )}
      </div>
    </div>
  );
}
