"use client";

import { useState, Suspense, lazy } from "react";
import type {
  CSVParseResult,
  ColumnMapping,
  ValidationResult,
  ImportProgress,
  MappingTemplate
} from "@/types/csv.types";
import type { RiderProps, RaceProps } from "@/types/types";
import { parseCSVFile } from "@/utils/csvParser";
// parseXLSXFile pulls in xlsx (~430 kB) — loaded only when an Excel file is
// actually uploaded (BUGS.md #1). CSV uploads never touch it.
import { autoMapColumns } from "@/services/csvMapper";
import { rowToRider } from "@/services/riderRowMapper";
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
// The photo-OCR capture pulls in tesseract.js — load it only when the user
// actually chooses "scan" (BUGS.md #1).
const ImageCapture = lazy(() => import("@/components/importImage/ImageCapture"));
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
      const result = isExcel
        ? await (await import("@/utils/xlsxParser")).parseXLSXFile(file)
        : await parseCSVFile(file);
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
            <Suspense fallback={<div className={styles.content}>Loading camera…</div>}>
              <ImageCapture
                onComplete={handleOcrParsed}
                onCancel={() => setScanMode(false)}
              />
            </Suspense>
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
            allRows={parseResult.rows}
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
