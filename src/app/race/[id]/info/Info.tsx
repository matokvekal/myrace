import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./info.module.css";
import { RaceProps } from "@/types/types";
import Icons from "@/constants/Icons";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import useRaceStore from "@/stores/racesStore";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { useAuthStore } from "@/stores/authStore";
import { Edit2, Check, X, ExternalLink, Download, Upload, ShieldCheck, ScrollText, Flag, Lock, Calendar, Clock, MapPin, Route, Trophy, Bike, Building2, UserRound, Phone, Globe, ImagePlus, Trash2 } from "lucide-react";
import { compressImage } from "@/utils/compressImage";
import { resolveRaceImage } from "@/utils/resolveRaceImage";
// xlsx (~430 kB) and its wrappers load on demand from the handlers below so they
// stay out of the Race page's initial chunk (BUGS.md #1). Types are erased.
import type { VerificationResult } from "@/utils/raceExport";
import type { ImportResult } from "@/utils/raceImport";
import { riderInCategory, catWaveKey } from "../schedule/Schedule";
import ExportCategoriesModal from "./ExportCategoriesModal";
import MergeImportModal, { ImportMode } from "./MergeImportModal";
import AuditLogViewer from "./AuditLogViewer";
import FinishRaceModal from "./FinishRaceModal";
import { AuditLogService } from "@/services/auditLog/auditLogService";
import { CategoryProps } from "@/types/types";
import { finalizeRace } from "@/utils/finalizeRace";
import {
  riderResultsDigest,
  shortToken,
  verifyRaceFinalization,
  type FinalizationCheck,
} from "@/utils/raceSignature";
import { toast } from "react-toastify";
import { isLiveRace } from "@/services/live/liveBridge";

interface Props {
  race: RaceProps;
  onDeleteRace?: () => Promise<void>;
}

type EditForm = Pick<
  RaceProps,
  "name" | "date" | "time" | "location" | "distance" | "type" | "level" |
  "orgenizer" | "manager" | "phone" | "site" | "takanon" | "image" | "logo" | "federationLogo"
>;

/** "2026-06-12" → "Fri, 12 June 2026" (date-only string, parsed as a local date). */
const formatEventDate = (d: string): string => {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return d || "";
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
};

const Info: React.FC<Props> = ({ race, onDeleteRace }) => {
  const [showDeleteRace, setShowDeleteRace] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<EditForm>({} as EditForm);
  const [originalForm, setOriginalForm] = useState<EditForm>({} as EditForm);
  const [importing, setImporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [pendingImport, setPendingImport] = useState<ImportResult | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const verifyRef = useRef<HTMLInputElement>(null);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showFinishRace, setShowFinishRace] = useState(false);
  const [finalCheck, setFinalCheck] = useState<FinalizationCheck | null>(null);
  const updateRace = useRaceStore((s) => s.updateRace);
  const currentUser = useAuthStore((s) => s.currentUser);
  const { riders, deleteRidersByRace, insertRiders } = useRiderStore();
  const { categories } = useCategoryStore();

  const raceRiders = useMemo(
    () => riders.filter((r) => r.raceUuid === race.uuid),
    [riders, race.uuid]
  );
  const raceCats = useMemo(
    () => categories.filter((c) => c.raceUuid === race.uuid),
    [categories, race.uuid]
  );

  /** Identity stamped on exports and on the finalization record. */
  const actingUser = currentUser?.email || currentUser?.id || "anonymous";
  const finalized = race.finalized;

  // Re-verify the certificate against the riders actually in the store, so a
  // race whose data was altered out-of-band (dev tools, a hand-edited import)
  // is reported as broken instead of presenting itself as official.
  //
  // The dependency is the results DIGEST, not the rider count: the whole point
  // is to notice a swapped placing or a flipped status, and neither of those
  // changes how many riders there are.
  const storedDigest = useMemo(
    () => (finalized ? riderResultsDigest(raceRiders) : ""),
    [finalized, raceRiders]
  );

  useEffect(() => {
    // A shared race's official result is keyed by rider uuid and signed by the server.
    if (!finalized || isLiveRace(race.uuid)) { setFinalCheck(null); return; }
    let cancelled = false;
    verifyRaceFinalization(finalized, raceRiders)
      .then((result) => { if (!cancelled) setFinalCheck(result); })
      .catch(() => { if (!cancelled) setFinalCheck(null); });
    return () => { cancelled = true; };
    // raceRiders is covered by storedDigest — depending on the array itself
    // would re-hash on every unrelated store write.
  }, [finalized, storedDigest]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFinishRace = async () => {
    if (isLiveRace(race.uuid)) {
      // Shared race: the server closes every wave, computes and signs the official result.
      try {
        const { finalizeShared } = await import("@/services/live/liveClient");
        const n = await finalizeShared(race.uuid);
        setShowFinishRace(false);
        toast.success(`Race finished — ${n} results are official (signed by the server).`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not finish the race");
      }
      return;
    }
    const result = await finalizeRace(race, actingUser);
    AuditLogService.log({
      race,
      action: "FINISH_RACE",
      screen: "Info",
      entityType: "race",
      entityId: race.uuid,
      details: {
        finalizedBy: result.finalized.by,
        finalizedAt: result.finalized.at,
        token: result.finalized.token,
        riderCount: result.riderCount,
        categoryCount: result.categoryCount,
      },
    });
    setShowFinishRace(false);
    toast.success(
      `Race finished — ${result.riderCount} results locked and signed.`
    );
  };

  const handleExportConfirm = async (selected: CategoryProps[]) => {
    const partial = selected.length !== raceCats.length;
    // Full export keeps every rider (even ones without a category);
    // partial export only takes riders of the chosen categories.
    const exportRiders = partial
      ? raceRiders.filter((r) => selected.some((c) => riderInCategory(r, c)))
      : raceRiders;
    // Stamp the file with whoever is signed in, so a results sheet arriving at
    // the main commissaire can be traced back and checked for edits.
    const exportedBy = currentUser?.email || currentUser?.id || "anonymous";
    try {
      const { exportRaceToXlsx } = await import("@/utils/raceExport");
      await exportRaceToXlsx(
        race,
        selected,
        exportRiders,
        partial ? "partial" : undefined,
        exportedBy
      );
    } catch (err) {
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      AuditLogService.log({
        race,
        action: "EXPORT_RACE",
        screen: "Info",
        entityType: "race",
        entityId: race.uuid,
        details: { partial, categoryCount: selected.length },
        success: false,
      });
      return;
    }
    AuditLogService.log({
      race,
      action: "EXPORT_RACE",
      screen: "Info",
      entityType: "race",
      entityId: race.uuid,
      details: { partial, categoryCount: selected.length, riderCount: exportRiders.length },
    });
    setShowExportModal(false);
  };

  /**
   * Check a received workbook against its own Signature sheet (BUGS.md #28).
   * Read-only — it never imports anything, so a tampered file can be inspected
   * safely before deciding what to do with it.
   */
  const handleVerifyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setVerifying(true);
    setVerification(null);
    try {
      const [XLSX, { verifyRaceWorkbook }] = await Promise.all([
        import("xlsx"),
        import("@/utils/raceExport"),
      ]);
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      setVerification(await verifyRaceWorkbook(wb));
    } catch (err) {
      setVerification({
        status: "invalid",
        message: `Could not read that file: ${err instanceof Error ? err.message : "unsupported format"}`,
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const { importRaceFromXlsx } = await import("@/utils/raceImport");
      const data = await importRaceFromXlsx(file);
      setPendingImport(data);
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleImportConfirm = async (selected: CategoryProps[], mode: ImportMode) => {
    if (!pendingImport) return;
    setImporting(true);
    try {
      const { replaceCategoriesForRace, mergeCategoriesIntoRace } = await import(
        "@/utils/raceImport"
      );
      // Remap to current race UUID (supports cross-device import)
      const remappedCats = pendingImport.categories.map((c) => ({ ...c, raceUuid: race.uuid }));
      const remappedRiders = pendingImport.riders.map((r) => ({ ...r, raceUuid: race.uuid }));

      if (mode === "replace") {
        await deleteRidersByRace(race.uuid);
        await replaceCategoriesForRace(race.uuid, remappedCats);
        useCategoryStore.setState((s) => ({
          categories: [
            ...s.categories.filter((c) => c.raceUuid !== race.uuid),
            ...remappedCats,
          ],
        }));
        await insertRiders(remappedRiders);
        // A full replace makes this race BE the imported one, so a file from a
        // finished race brings its lock with it — that's how a final result
        // handed to another commissaire stays final on their device. Stamped
        // last, after the data is in, or the store guards would block the writes
        // above. Merge mode deliberately does NOT adopt it: a partial merge is
        // still someone's own in-progress race.
        // Course maps travel with the file (files from before multi-map support
        // carry none, so the race keeps the maps it has). They go in the SAME
        // update as the lock — a second write after it would be blocked.
        const importedMaps =
          pendingImport.tracks && pendingImport.tracks.length > 0
            ? { tracks: pendingImport.tracks }
            : {};
        if (pendingImport.finalized) {
          await updateRace({
            ...race,
            ...importedMaps,
            status: "finished",
            finalized: pendingImport.finalized,
          });
        } else if (importedMaps.tracks) {
          await updateRace({ ...race, ...importedMaps });
        }
        toast.success(
          (pendingImport.finalized
            ? `Imported final results — ${remappedRiders.length} riders. This race is now read-only.`
            : `Imported ${remappedRiders.length} riders across ${remappedCats.length} categories`) +
            (importedMaps.tracks ? ` and ${importedMaps.tracks.length} maps` : "")
        );
        AuditLogService.log({
          race,
          action: "IMPORT_RACE",
          screen: "Info",
          entityType: "race",
          entityId: race.uuid,
          details: {
            mode,
            raceName: pendingImport.raceName,
            riderCount: remappedRiders.length,
            categoryCount: remappedCats.length,
          },
        });
      } else {
        const selectedKeys = new Set(selected.map((c) => catWaveKey(c.name, c.subCategory)));
        const catsToMerge = remappedCats.filter((c) =>
          selectedKeys.has(catWaveKey(c.name, c.subCategory))
        );
        const ridersToMerge = remappedRiders.filter((r) =>
          catsToMerge.some((c) => riderInCategory(r, c))
        );

        const result = await mergeCategoriesIntoRace(race.uuid, catsToMerge, ridersToMerge);

        // Sync Zustand with what actually landed in IDB
        useCategoryStore.setState((s) => ({
          categories: [
            ...s.categories.filter(
              (c) =>
                !(c.raceUuid === race.uuid && selectedKeys.has(catWaveKey(c.name, c.subCategory)))
            ),
            ...result.categories,
          ],
        }));
        useRiderStore.setState((s) => ({
          riders: [
            ...s.riders.filter(
              (r) =>
                !(r.raceUuid === race.uuid && catsToMerge.some((c) => riderInCategory(r, c)))
            ),
            ...result.riders,
          ],
        }));
        toast.success(
          `Merged ${result.riders.length} riders in ${result.categories.length} ${
            result.categories.length === 1 ? "category" : "categories"
          }`
        );
        AuditLogService.log({
          race,
          action: "IMPORT_RACE",
          screen: "Info",
          entityType: "race",
          entityId: race.uuid,
          details: {
            mode,
            raceName: pendingImport.raceName,
            riderCount: result.riders.length,
            categoryCount: result.categories.length,
          },
        });
      }
      setPendingImport(null);
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      AuditLogService.log({
        race,
        action: "IMPORT_RACE",
        screen: "Info",
        entityType: "race",
        entityId: race.uuid,
        details: { mode, raceName: pendingImport?.raceName },
        success: false,
      });
    } finally {
      setImporting(false);
    }
  };

  const openEdit = () => {
    const snapshot: EditForm = {
      name: race.name ?? "",
      date: race.date ?? "",
      time: race.time ?? "",
      location: race.location ?? "",
      distance: race.distance ?? 0,
      type: race.type ?? "",
      level: race.level ?? "",
      orgenizer: race.orgenizer ?? "",
      manager: race.manager ?? "",
      phone: race.phone ?? "",
      site: race.site ?? "",
      takanon: race.takanon ?? "",
      image: race.image ?? "",
      logo: race.logo ?? null,
      federationLogo: race.federationLogo ?? null,
    };
    setForm(snapshot);
    setOriginalForm(snapshot);
    setEditMode(true);
  };

  const handleSave = async () => {
    await updateRace({ ...race, ...form });
    AuditLogService.log({
      race,
      action: "EDIT_RACE",
      screen: "Info",
      entityType: "race",
      entityId: race.uuid,
      before: originalForm,
      after: form,
    });
    setEditMode(false);
  };

  const handleCancel = () => setEditMode(false);

  const set = (field: keyof EditForm, value: string | number | null) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Banner and logos: compressed like the race cover (logos stay PNG for transparency).
  const uploadImage = async (field: "image" | "logo" | "federationLogo", file?: File) => {
    if (!file) return;
    try {
      const data =
        field === "image"
          ? await compressImage(file)
          : await compressImage(file, { maxDimension: 512, maxBytes: 120_000, mimeType: "image/png" });
      set(field, data);
    } catch {
      toast.error("Couldn't process that image. Please pick a JPG or PNG.");
    }
  };

  return (
    <div className={styles.container}>
      {/* Edit / Save / Cancel bar — gone once the race is finalized: race
          details are part of the signed record and the store rejects changes. */}
      <div className={styles.editBar}>
        {finalized ? (
          <span className={styles.lockedNote} data-testid="info-locked-note">
            <Lock size={13} /> Race details are locked
          </span>
        ) : !editMode ? (
          <button className={styles.editBarBtn} onClick={openEdit}>
            <Edit2 size={14} />
            Edit Race Info
          </button>
        ) : (
          <>
            <button className={styles.cancelBarBtn} onClick={handleCancel}>
              <X size={14} /> Cancel
            </button>
            <button className={styles.saveBarBtn} onClick={handleSave}>
              <Check size={14} /> Save
            </button>
          </>
        )}
      </div>

      {editMode && !finalized ? (
        /* ── EDIT FORM ── */
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Branding</div>
            <div className={styles.brandGrid}>
              {([
                ["image", "Banner"],
                ["logo", "Event logo"],
                ["federationLogo", "Federation / organizer logo"],
              ] as const).map(([field, label]) => (
                <div key={field} className={styles.brandItem}>
                  <span className={styles.brandLabel}>{label}</span>
                  <div className={field === "image" ? styles.brandBannerPreview : styles.brandLogoPreview}>
                    {field === "image" ? (
                      <img src={resolveRaceImage(form.image)} alt="" />
                    ) : form[field] ? (
                      <img src={form[field] as string} alt="" />
                    ) : (
                      <span className={styles.brandEmpty}>No logo</span>
                    )}
                  </div>
                  <div className={styles.brandActions}>
                    <label className={styles.brandBtn}>
                      <ImagePlus size={14} /> {field === "image" || form[field] ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => { void uploadImage(field, e.target.files?.[0]); e.target.value = ""; }}
                      />
                    </label>
                    {field !== "image" && form[field] && (
                      <button type="button" className={styles.brandBtn} onClick={() => set(field, null)} aria-label={`Remove ${label}`}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Race Details</div>
            <FormRow label="Name">
              <input className={styles.formInput} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </FormRow>
            <FormRow label="Date">
              <input className={styles.formInput} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </FormRow>
            <FormRow label="Start time">
              <input className={styles.formInput} type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
            </FormRow>
            <FormRow label="Location">
              <input className={styles.formInput} value={form.location} onChange={(e) => set("location", e.target.value)} />
            </FormRow>
            <FormRow label="Distance (km)">
              <input className={styles.formInput} type="number" min="0" value={form.distance} onChange={(e) => set("distance", parseFloat(e.target.value) || 0)} />
            </FormRow>
            <FormRow label="Type">
              <input className={styles.formInput} value={form.type} onChange={(e) => set("type", e.target.value)} />
            </FormRow>
            <FormRow label="Level">
              <input className={styles.formInput} value={form.level} onChange={(e) => set("level", e.target.value)} />
            </FormRow>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Organisation</div>
            <FormRow label="Organiser">
              <input className={styles.formInput} value={form.orgenizer} onChange={(e) => set("orgenizer", e.target.value)} />
            </FormRow>
            <FormRow label="Manager">
              <input className={styles.formInput} value={form.manager} onChange={(e) => set("manager", e.target.value)} />
            </FormRow>
            <FormRow label="Phone">
              <input className={styles.formInput} type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </FormRow>
            <FormRow label="Website">
              <input className={styles.formInput} type="url" placeholder="https://" value={form.site} onChange={(e) => set("site", e.target.value)} />
            </FormRow>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Rules / תקנון</div>
            <FormRow label="URL">
              <input className={styles.formInput} type="url" placeholder="https://…" value={form.takanon} onChange={(e) => set("takanon", e.target.value)} />
            </FormRow>
          </div>
        </>
      ) : (
        /* ── VIEW MODE: event presentation ── */
        <>
          <section className={styles.evHero}>
            <div className={styles.evBanner} style={{ backgroundImage: `url("${resolveRaceImage(race.image)}")` }} role="img" aria-label="Event banner" />
            <div className={styles.evHead}>
              {race.logo && <img className={styles.evLogo} src={race.logo} alt="Event logo" />}
              <div className={styles.evTitleBlock}>
                <div className={styles.evKicker}>
                  {[race.raceType ?? "MTB", race.type, race.level].filter(Boolean).join(" · ")}
                </div>
                <h2 className={styles.evName} dir="auto">{race.name}</h2>
                <div className={styles.evChips}>
                  {race.date && <span className={styles.evChip}><Calendar size={14} /> {formatEventDate(race.date)}</span>}
                  {race.time && <span className={styles.evChip}><Clock size={14} /> {race.time}</span>}
                  {race.location && <span className={styles.evChip} dir="auto"><MapPin size={14} /> {race.location}</span>}
                </div>
              </div>
              {race.federationLogo && <img className={styles.evFedLogo} src={race.federationLogo} alt="Organizer logo" />}
            </div>
          </section>

          <div className={styles.evGrid}>
            <section className={styles.evCard}>
              <h3 className={styles.evCardTitle}><Trophy size={15} /> Race details</h3>
              <InfoItem icon={<Calendar size={15} />} label="Date" value={formatEventDate(race.date)} />
              <InfoItem icon={<Clock size={15} />} label="Start" value={race.time} />
              <InfoItem icon={<Route size={15} />} label="Distance" value={race.distance ? `${race.distance} km` : ""} />
              <InfoItem icon={<Bike size={15} />} label="Discipline" value={race.raceType ?? "MTB"} />
              <InfoItem icon={<Flag size={15} />} label="Type" value={race.type} />
              <InfoItem icon={<Trophy size={15} />} label="Level" value={race.level} />
            </section>

            <section className={styles.evCard}>
              <h3 className={styles.evCardTitle}><MapPin size={15} /> Venue</h3>
              <InfoItem icon={<MapPin size={15} />} label="Location" value={race.location} />
              {race.location && (
                <a
                  className={styles.evLink}
                  href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(race.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={13} /> Open in map
                </a>
              )}
            </section>

            <section className={styles.evCard}>
              <h3 className={styles.evCardTitle}><Building2 size={15} /> Organisation</h3>
              <InfoItem icon={<Building2 size={15} />} label="Organiser" value={race.orgenizer} />
              <InfoItem icon={<UserRound size={15} />} label="Race manager" value={race.manager} />
            </section>

            <section className={styles.evCard}>
              <h3 className={styles.evCardTitle}><Phone size={15} /> Contact</h3>
              <InfoItem
                icon={<Phone size={15} />}
                label="Phone"
                value={race.phone}
                href={race.phone ? `tel:${race.phone.replace(/[^\d+]/g, "")}` : undefined}
              />
              <InfoItem icon={<Globe size={15} />} label="Website" value={race.site} href={race.site || undefined} external />
            </section>

            <section className={styles.evCard}>
              <h3 className={styles.evCardTitle}><ScrollText size={15} /> Rules / תקנון</h3>
              {race.takanon ? (
                <a href={race.takanon} target="_blank" rel="noopener noreferrer" className={styles.takanonLink}>
                  <ExternalLink size={14} />
                  View Rules Document
                </a>
              ) : (
                <div className={styles.takanonEmpty}>No rules document yet.</div>
              )}
            </section>

            <section className={styles.evCard}>
              <h3 className={styles.evCardTitle}><Flag size={15} /> Status</h3>
              <div className={`${styles.statusBadge} ${styles[race.status ?? "upcoming"]}`}>
                {race.status ?? "upcoming"}
              </div>
            </section>
          </div>
        </>
      )}

      {/* ── Export / Import ── */}
      <div className={styles.dataSection}>
        <div className={styles.dataSectionTitle}>Data Transfer</div>
        <div className={styles.dataBody}>
          <div className={styles.dataText}>
            {finalized
              ? "Export the final results to Excel. The file carries the race's signature, so whoever receives it can verify nothing was changed."
              : "Export race data (riders, categories, lap results) to Excel — all of it, or only your categories so the main commissaire can merge everyone's results after the race."}
          </div>
          <div className={styles.dataButtons}>
            <button className={styles.exportBtn} onClick={() => setShowExportModal(true)}>
              <Download size={14} />
              Export to Excel
            </button>
            {/* Importing rewrites riders and categories — impossible once the
                race is finalized, so the button goes rather than failing. */}
            {!finalized && (
              <button
                className={styles.importBtn}
                onClick={() => importRef.current?.click()}
                disabled={importing}
              >
                <Upload size={14} />
                {importing ? "Importing…" : "Import from Excel"}
              </button>
            )}
            <button
              className={styles.importBtn}
              onClick={() => verifyRef.current?.click()}
              disabled={verifying}
            >
              <ShieldCheck size={14} />
              {verifying ? "Checking…" : "Verify signature"}
            </button>
          </div>

          {/* Signature check result (BUGS.md #28) */}
          {verification && (
            <div
              className={`${styles.verifyBox} ${styles[`verify_${verification.status}`] ?? ""}`}
              data-testid="verify-result"
              data-status={verification.status}
            >
              <div className={styles.verifyHeadline}>
                {verification.status === "valid" && "✓ Signature valid"}
                {verification.status === "results-modified" && "⚠ Results were changed"}
                {verification.status === "invalid" && "✕ Signature invalid"}
                {verification.status === "unsigned" && "• Not signed"}
              </div>
              <div className={styles.verifyMessage}>{verification.message}</div>
              {verification.exportedBy && (
                <div className={styles.verifyMeta}>
                  Exported by <strong>{verification.exportedBy}</strong>
                  {verification.exportedAt ? ` on ${verification.exportedAt}` : ""}
                </div>
              )}
              {verification.finalizedBy && (
                <div className={styles.verifyMeta}>
                  🔒 Final results — race closed by{" "}
                  <strong>{verification.finalizedBy}</strong>
                  {verification.finalizedAt
                    ? ` on ${new Date(verification.finalizedAt).toLocaleString()}`
                    : ""}
                </div>
              )}
            </div>
          )}
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleImportFile}
        />
        <input
          ref={verifyRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleVerifyFile}
        />
      </div>

      {/* ── Audit Log — only for races run from here, not downloaded view-only copies ── */}
      {!race.viewOnly && (
        <div className={styles.dataSection}>
          <div className={styles.dataSectionTitle}>Audit</div>
          <div className={styles.dataBody}>
            <div className={styles.dataText}>
              A local, read-only record of who did what on this race — race edits,
              imports/exports, and more.
            </div>
            <div className={styles.dataButtons}>
              <button className={styles.importBtn} onClick={() => setShowAuditLog(true)}>
                <ScrollText size={14} />
                View Log
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Finish Race ──────────────────────────────────────────────────
          The footer action, deliberately placed after everything else: it is
          the last thing you do to a race. Hidden on a downloaded view-only
          copy — you can't close someone else's event. */}
      {!race.viewOnly && !finalized && (
        <div className={styles.finishZone}>
          <div className={styles.finishTitle}>
            <Flag size={15} /> Finish Race
          </div>
          <div className={styles.finishBody}>
            <div className={styles.finishText}>
              Close the race and publish the final classification. Every rider gets
              their final placing and total time, all categories are closed, and the
              race becomes read-only and signed — no live timing, imports or edits
              afterwards. This cannot be undone.
            </div>
            <button
              className={styles.finishBtn}
              onClick={() => setShowFinishRace(true)}
              data-testid="finish-race-btn"
            >
              <Flag size={14} /> Finish Race
            </button>
          </div>
        </div>
      )}

      {/* ── Finalization certificate ── */}
      {finalized && (
        <div
          className={styles.certificate}
          data-testid="race-certificate"
          data-check={finalCheck ?? "checking"}
        >
          <div className={styles.certTitle}>
            <Lock size={15} /> Final Results
          </div>
          <div className={styles.certBody}>
            <div className={styles.certRow}>
              <span className={styles.certLabel}>Closed by</span>
              <span className={styles.certValue}>{finalized.by}</span>
            </div>
            <div className={styles.certRow}>
              <span className={styles.certLabel}>Closed at</span>
              <span className={styles.certValue}>
                {new Date(finalized.at).toLocaleString()}
              </span>
            </div>
            <div className={styles.certRow}>
              <span className={styles.certLabel}>Results</span>
              <span className={styles.certValue}>
                {finalized.riderCount} riders · {finalized.categoryCount} categories
              </span>
            </div>
            <div className={styles.certRow}>
              <span className={styles.certLabel}>Signature</span>
              <span className={styles.certToken} title={finalized.token}>
                {finalized.algo} · {shortToken(finalized.token)}
              </span>
            </div>

            {/* Live re-check against the riders currently stored. */}
            {finalCheck === "valid" && (
              <div className={styles.certOk}>
                ✓ Verified — the stored results still match this signature.
              </div>
            )}
            {finalCheck === "results-modified" && (
              <div className={styles.certBad}>
                ⚠ The signature is authentic, but the results stored on this device no
                longer match it. Treat the exported file, not this copy, as the record.
              </div>
            )}
            {finalCheck === "invalid" && (
              <div className={styles.certBad}>
                ✕ This finalization record does not verify against itself. It was not
                produced by finishing the race here.
              </div>
            )}
          </div>
        </div>
      )}

      {onDeleteRace && (
        race.viewOnly ? (
          /* Downloaded, view-only race: light one-tap remove — it's a disposable
             read-only copy you can re-download, so no heavy confirm (BUGS.md #8). */
          <div className={styles.viewOnlyZone}>
            <div className={styles.viewOnlyText}>
              This is a downloaded race, kept only to view results. Removing it
              deletes the local copy — you can download it again anytime.
            </div>
            <button
              className={styles.removeDownloadBtn}
              onClick={async () => {
                AuditLogService.log({
                  race,
                  action: "DELETE_RACE",
                  screen: "Info",
                  entityType: "race",
                  entityId: race.uuid,
                  before: { id: race.uuid, name: race.name, raceId: race.raceId },
                  details: { viewOnly: true },
                });
                await onDeleteRace();
              }}
            >
              🗑 Remove downloaded race
            </button>
          </div>
        ) : (
          <div className={styles.dangerZone}>
            <div className={styles.dangerTitle}>Danger Zone</div>
            <div className={styles.dangerBody}>
              <div className={styles.dangerText}>
                Permanently delete this race, all its riders, and all categories. This cannot be undone.
              </div>
              <button className={styles.deleteRaceBtn} onClick={() => setShowDeleteRace(true)}>
                🗑 Delete Race
              </button>
            </div>
          </div>
        )
      )}

      {showExportModal && (
        <ExportCategoriesModal
          categories={raceCats}
          riders={raceRiders}
          onConfirm={handleExportConfirm}
          onCancel={() => setShowExportModal(false)}
        />
      )}

      {pendingImport && (
        <MergeImportModal
          fileRaceName={pendingImport.raceName}
          fileFinalized={Boolean(pendingImport.finalized)}
          fileCategories={pendingImport.categories}
          fileRiders={pendingImport.riders}
          localCategories={raceCats}
          localRiders={raceRiders}
          onConfirm={handleImportConfirm}
          onCancel={() => { if (!importing) setPendingImport(null); }}
        />
      )}

      {showDeleteRace && onDeleteRace && (
        <DeleteConfirmModal
          title={`Delete "${race.name}"`}
          description="This will permanently delete the race and all associated riders, categories, and data. This cannot be undone."
          onConfirm={async () => {
            AuditLogService.log({
              race,
              action: "DELETE_RACE",
              screen: "Info",
              entityType: "race",
              entityId: race.uuid,
              before: { id: race.uuid, name: race.name, raceId: race.raceId },
            });
            await onDeleteRace();
            setShowDeleteRace(false);
          }}
          onCancel={() => setShowDeleteRace(false)}
        />
      )}

      {showAuditLog && (
        <AuditLogViewer race={race} onClose={() => setShowAuditLog(false)} />
      )}

      {showFinishRace && (
        <FinishRaceModal
          raceName={race.name}
          riders={raceRiders}
          categories={raceCats}
          onConfirm={handleFinishRace}
          onCancel={() => setShowFinishRace(false)}
        />
      )}
    </div>
  );
};

const Row: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <div className={styles.row}>
    <img src={icon} alt="" width={16} height={16} className={styles.rowIcon} />
    <span className={styles.rowLabel}>{label}</span>
    <span className={styles.rowValue}>{value || "—"}</span>
  </div>
);

/** One labelled value in an Info card; empty shows "—" (never hidden). */
const InfoItem: React.FC<{ icon: React.ReactNode; label: string; value?: string | null; href?: string; external?: boolean }> = ({
  icon, label, value, href, external,
}) => (
  <div className={styles.evItem}>
    <span className={styles.evItemIcon}>{icon}</span>
    <span className={styles.evItemLabel}>{label}</span>
    {value ? (
      href ? (
        <a className={styles.evItemValue} href={href} dir="auto" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {value}
        </a>
      ) : (
        <span className={styles.evItemValue} dir="auto">{value}</span>
      )
    ) : (
      <span className={`${styles.evItemValue} ${styles.evItemEmpty}`}>—</span>
    )}
  </div>
);

const FormRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className={styles.formRow}>
    <span className={styles.formLabel}>{label}</span>
    <div className={styles.formField}>{children}</div>
  </div>
);

export default Info;
