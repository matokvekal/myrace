"use client";

import { useRef, useState, Suspense, lazy } from "react";
import type {
  CSVParseResult,
  ColumnMapping,
  ValidationResult,
  ValidationIssue,
  ImportProgress,
  MappingTemplate
} from "@/types/csv.types";
import type { RiderProps, RaceProps } from "@/types/types";
import { parseCSVFile } from "@/utils/csvParser";
// parseXLSXFile pulls in xlsx (~430 kB) — loaded only when an Excel file is
// actually uploaded (BUGS.md #1). CSV uploads never touch it.
import { autoMapColumns } from "@/services/csvMapper";
import { fetchSharedMappings } from "@/services/sharedColumnMappings";
import { buildHeatNameMap, filterImportRows, importSkipReason, rowToRider } from "@/services/riderRowMapper";
import { isLiveRace } from "@/services/live/liveBridge";
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
import BibConflictStep from "./BibConflictStep";
import ImportStages, { type ImportStage } from "./ImportStages";
import {
  findBibConflicts,
  type BibConflictGroup,
  type BibCorrection,
  type ExistingBibRider,
  type ImportBibRow,
} from "@/utils/bibConflicts";
import { logImportBibCorrections } from "@/stores/checkInChangesStore";
// The photo-OCR capture pulls in tesseract.js — load it only when the user
// actually chooses "scan" (BUGS.md #1).
const ImageCapture = lazy(() => import("@/components/importImage/ImageCapture"));
import styles from "./csvImportWizard.module.css";
import { newLocalId } from "@/utils/localId";

type WizardStep = "upload" | "mapping" | "preview" | "bibs" | "importing";

/** Everything the save needs, built once from the preview (kept while the organizer resolves bibs). */
interface PreparedImport {
  riders: RiderProps[];
  rowNumbers: number[];
  totalInFile: number;
  failedCount: number;
  errorIssues: ValidationIssue[];
  bibRows: ImportBibRow[];
  existing: ExistingBibRider[];
  conflicts: BibConflictGroup[];
}

const riderName = (r: Pick<RiderProps, "firstName" | "lastName">) => [r.firstName, r.lastName].filter(Boolean).join(" ");

interface CSVImportWizardProps {
  raceUuid: string;
  onClose: () => void;
  onComplete?: (count: number) => void;
  /** "scan" opens directly on the photo-OCR source instead of file upload */
  initialMode?: "file" | "scan";
}

const STEP_ORDER: WizardStep[] = ["upload", "mapping", "preview", "bibs", "importing"];
const STEP_LABEL: Record<WizardStep, string> = { upload: "Upload", mapping: "Mapping", preview: "Preview", bibs: "Bibs", importing: "Importing" };

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
  // A shared race's import that was refused as a whole (nothing imported), with the rows to fix.
  const [refusal, setRefusal] = useState<{ message: string; problems: string[] } | null>(null);
  const [suggestedName, setSuggestedName] = useState("");
  const [showMultiDayDialog, setShowMultiDayDialog] = useState(false);
  const [multiDayValues, setMultiDayValues] = useState<string[]>([]);
  const [multiDayRowCounts, setMultiDayRowCounts] = useState<Record<string, number>>({});
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  // What is running now (null = idle). The ref is the double-submit guard: state
  // updates are async, a second tap in the same frame must already see "busy".
  const [stage, setStage] = useState<ImportStage | null>(null);
  const [stageDetail, setStageDetail] = useState<string | undefined>(undefined);
  const busyRef = useRef(false);
  const [splitting, setSplitting] = useState(false);
  const begin = (s: ImportStage, detail?: string) => {
    setStage(s);
    setStageDetail(detail);
  };
  /** Lets React paint the new stage before a long synchronous step. */
  const paint = () => new Promise<void>((r) => setTimeout(r, 0));
  const finish = () => {
    busyRef.current = false;
    setStage(null);
    setStageDetail(undefined);
  };

  const insertRiders = useRiderStore((state) => state.insertRiders);
  const rebuildCategoriesFromRiders = useCategoryStore((state) => state.rebuildCategoriesFromRiders);
  const races = useRaceStore((state) => state.races);
  const insertRace = useRaceStore((state) => state.insertRace);
  const updateRace = useRaceStore((state) => state.updateRace);
  const clubDictionary = useClubDictionaryStore;

  const handleFileUpload = async (file: File, template?: MappingTemplate) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      // Excel needs the xlsx parser (~430 kB) the first time: say so, it's the slow part.
      begin("reading", isExcel ? `Reading ${file.name} (loading the Excel reader)…` : `Reading ${file.name}…`);
      const result = isExcel
        ? await (await import("@/utils/xlsxParser")).parseXLSXFile(file)
        : await parseCSVFile(file);
      begin("mapping", `Matching ${result.headers.length} columns…`);
      await paint();
      // ONE request for every header (signed in only, short timeout, skipped offline).
      const shared = await fetchSharedMappings(result.headers);
      const autoMappings = await autoMapColumns(result.headers, result.rows, shared);
      setParseResult(result);
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
    } finally {
      finish();
    }
  };

  // Photo-OCR source: same handoff as handleFileUpload, minus file parsing
  const handleOcrParsed = async (result: CSVParseResult) => {
    setParseResult(result);
    const autoMappings = await autoMapColumns(result.headers, result.rows, await fetchSharedMappings(result.headers));
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
    if (!parseResult || busyRef.current) return;
    busyRef.current = true;
    try {
      await splitByDay();
    } finally {
      finish();
    }
  };

  const splitByDay = async () => {
    if (!parseResult) return;
    begin("saving", "Creating one race per day…");
    setSplitting(true);
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
    let processedRows = 0;
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
          id: newLocalId(),
          uuid: newUuid,
          name: `${currentRace.name} - ${day}`,
          createdAt: new Date(),
          lastUpdateAt: new Date()
        };
        await insertRace(newRace);
        targetRaceUuid = newUuid;
      }

      // Header / blank / invalid rows never become riders or number a wave.
      const dataRows = filterImportRows(rows, parseResult.headers, columnMappings).rows;
      const heatNameToNumber = buildHeatNameMap(dataRows, columnMappings);

      const riders = dataRows.map((row, idx) =>
        rowToRider(row, columnMappings, targetRaceUuid, totalSuccessful + idx, heatNameToNumber, clubDictionary)
      );
      await insertRiders(riders);
      await rebuildCategoriesFromRiders(targetRaceUuid);
      totalSuccessful += riders.length;
      processedRows += rows.length;
      // Measurable here: one race per day, so the bar is real.
      setImportProgress({ total: totalRows, processed: processedRows, successful: totalSuccessful, failed: 0, status: "importing" });
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

  /** Preview → riders of the batch + their duplicate bibs. Nothing is saved here. */
  const prepareImport = async (validation: ValidationResult): Promise<PreparedImport | null> => {
    if (!parseResult) return null;
    const headerRow = parseResult.detection.headerRow;
    const errorIssues = validation.issues.filter((i) => i.severity === "error");
    const errorRowIndices = new Set(errorIssues.map((i) => i.row - headerRow - 1));

    // Rows with validation errors, repeated header rows, blank rows and rows
    // without a bib or a name are all skipped — before text waves are numbered.
    const kept = parseResult.rows
      .map((row, i) => ({ row, i }))
      .filter(({ row, i }) => !errorRowIndices.has(i) && !importSkipReason(row, parseResult.headers, columnMappings));
    const validRows = kept.map(({ row }) => row);
    const rowNumbers = kept.map(({ i }) => i + headerRow + 1);

    // Text heats → numbers, from the rows that become riders only.
    const heatNameToNumber = buildHeatNameMap(validRows, columnMappings);
    const riders = validRows.map((row, i) =>
      rowToRider(row, columnMappings, raceUuid, i, heatNameToNumber, clubDictionary)
    );

    // Bibs are unique race-wide (every wave, every status — the server counts them all).
    await useRiderStore.getState().getRiders(raceUuid);
    const existing: ExistingBibRider[] = useRiderStore.getState().riders
      .filter((r) => r.raceUuid === raceUuid && r.bibNumber > 0)
      .map((r) => ({ bib: r.bibNumber, name: riderName(r), category: r.category, heat: r.heat ?? null }));
    const bibRows: ImportBibRow[] = riders.map((r, index) => ({
      index, row: rowNumbers[index], bib: r.bibNumber, name: riderName(r), category: r.category, heat: r.heat ?? null,
    }));
    return {
      riders, rowNumbers, errorIssues, existing, bibRows,
      totalInFile: parseResult.rows.length,
      failedCount: parseResult.rows.length - validRows.length,
      conflicts: findBibConflicts(bibRows, existing),
    };
  };

  const handleStartImport = async (validation: ValidationResult) => {
    if (busyRef.current) return; // a second tap on Import does nothing
    busyRef.current = true;
    let prep: PreparedImport | null = null;
    try {
      begin("validating", "Checking the riders…");
      await paint();
      prep = await prepareImport(validation);
      if (!prep) return;
      begin("duplicates", "Checking bib numbers across the race…");
      setPrepared(prep);
      setRefusal(null);
      if (prep.conflicts.length > 0) {
        setCurrentStep("bibs"); // the organizer decides; nothing is saved yet
        return;
      }
    } catch (err) {
      console.error("Could not prepare the import:", err);
      alert(`Could not prepare the import: ${err instanceof Error ? err.message : String(err)}`);
      prep = null; // stays on Preview with everything as it was
      return;
    } finally {
      if (!prep || prep.conflicts.length > 0) finish();
    }
    await runImport(prep, [], true);
  };

  /** Saves the prepared batch with the confirmed renumbering applied. */
  const runImport = async (prep: PreparedImport, corrections: BibCorrection[], guarded = false) => {
    if (!guarded) {
      if (busyRef.current) return;
      busyRef.current = true;
    }
    try {
      await saveImport(prep, corrections);
    } finally {
      finish();
    }
  };

  const saveImport = async (prep: PreparedImport, corrections: BibCorrection[]) => {
    const { totalInFile, failedCount } = prep;
    const fix = new Map(corrections.map((c) => [c.index, c]));
    const riders = prep.riders.map((r, i) => (fix.has(i) ? { ...r, bibNumber: fix.get(i)!.correctedBib } : r));

    begin("saving", isLiveRace(raceUuid)
      ? `Sending ${riders.length} riders to the server…`
      : `Saving ${riders.length} riders on this device…`);
    setCurrentStep("importing");
    setRefusal(null);
    setSkippedIssues(prep.errorIssues);
    setImportProgress({ total: totalInFile, processed: 0, successful: 0, failed: failedCount, status: "importing" });

    try {
      if (isLiveRace(raceUuid)) {
        // Shared race: riders AND categories go to the server in one Action, and
        // nothing is saved here until the server confirmed it (no half import).
        // The renumbering travels in the same Action: the server's event is the audit.
        const live = await import("@/services/live/liveClient");
        try {
          await live.importIntoSharedRace(raceUuid, riders, prep.rowNumbers, corrections);
        } catch (err) {
          if (!(err instanceof live.ImportRefused)) throw err;
          setRefusal({ message: err.message, problems: err.problems.map((p) => p.message) });
          setImportProgress({ total: totalInFile, processed: totalInFile, successful: 0, failed: totalInFile, status: "error" });
          return;
        }
      } else {
        await insertRiders(riders);
        await rebuildCategoriesFromRiders(raceUuid);
        await logImportBibCorrections(
          raceUuid,
          corrections.map((c) => ({ rider: riders[c.index], originalBib: c.originalBib, reason: c.reason }))
        ).catch((e) => console.warn("Could not log the bib corrections", e));
      }
      setImportProgress({
        total: totalInFile,
        processed: totalInFile,
        successful: riders.length,
        failed: failedCount,
        status: "completed"
      });
      setPrepared(null);
      onComplete?.(riders.length);
    } catch (err) {
      console.error("Import failed:", err);
      setRefusal({ message: `Nothing was imported. ${err instanceof Error ? err.message : String(err)}`, problems: [] });
      setImportProgress({ total: totalInFile, processed: totalInFile, successful: 0, failed: totalInFile, status: "error" });
    }
  };

  const handleBack = () => {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx > 0) setCurrentStep(STEP_ORDER[idx - 1] === "bibs" ? "preview" : STEP_ORDER[idx - 1]);
  };

  const handleClose = () => {
    setCurrentStep("upload");
    setScanMode(false);
    setParseResult(null);
    setColumnMappings([]);
    setImportProgress(null);
    setSkippedIssues([]);
    setRefusal(null);
    setPrepared(null);
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
        {STEP_ORDER.filter((step) => step !== "bibs" || currentStep === "bibs").map((step, i, shown) => {
          const currentIdx = shown.indexOf(currentStep);
          const isActive = currentStep === step;
          const isCompleted = i < currentIdx;
          return (
            <div
              key={step}
              className={`${styles.step} ${isActive ? styles.active : ""} ${isCompleted ? styles.completed : ""}`}
            >
              <span className={styles.stepNumber}>{i + 1}</span>
              <span className={styles.stepLabel}>{STEP_LABEL[step]}</span>
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
            <>
              {stage && <ImportStages stage={stage} detail={stageDetail} />}
              <UploadStep busy={!!stage} onFileUpload={(file, tpl) => handleFileUpload(file, tpl)} />
            </>
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
          <>
            {stage && <ImportStages stage={stage} detail={stageDetail} />}
            <PreviewStep
              parseResult={parseResult}
              mappings={columnMappings}
              onStartImport={handleStartImport}
              onBack={handleBack}
              busy={!!stage}
            />
          </>
        )}
        {currentStep === "bibs" && prepared && (
          <BibConflictStep
            groups={prepared.conflicts}
            rows={prepared.bibRows}
            existing={prepared.existing}
            onCancel={() => setCurrentStep("preview")}
            onConfirm={(corrections) => runImport(prepared, corrections)}
            busy={!!stage}
          />
        )}
        {currentStep === "importing" && importProgress && (
          <ImportProgressStep
            progress={importProgress}
            skippedIssues={skippedIssues}
            refusal={refusal}
            onClose={handleClose}
            stage={stage}
            stageDetail={stageDetail}
            measurable={splitting}
            // Nothing was saved: go back with the file and the mapping as they were.
            onBackToPreview={parseResult ? () => { setRefusal(null); setImportProgress(null); setCurrentStep("preview"); } : undefined}
          />
        )}
      </div>
    </div>
  );
}
