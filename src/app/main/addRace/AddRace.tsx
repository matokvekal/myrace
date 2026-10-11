import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./addRace.module.css";
import Images from "@/constants/Images";
import Button from "@/components/ui/Button";
import { saveRace } from "@/utils/saveRace";
import { compressImage } from "@/utils/compressImage";
import useRaceStore from "@/stores/racesStore";
import { ArrowLeft, ImagePlus } from "lucide-react";

interface Props {
  setAddNewwRace: (value: boolean) => void;
}

const FALLBACK_IMAGES = [
  Images.bikeMountainSplash,
  Images.bikeSplash,
  Images.peloton1,
  Images.racebefore,
  Images.defaultRaceBike,
];

// Race discipline. MTB is the only one live for now; the rest are shown as a
// "Soon" preview so organizers know they're coming (and disabled until ready).
type RaceType = "MTB" | "Gravel";
const RACE_TYPES: { value: RaceType; label: string; soon?: boolean }[] = [
  { value: "MTB", label: "MTB" },
  { value: "Gravel", label: "Gravel", soon: true },
];

const today = new Date().toISOString().split("T")[0];
const BASE = import.meta.env.BASE_URL; // "/commissire-race/" in prod, "/" in dev

const AddRace: React.FC<Props> = ({ setAddNewwRace }) => {
  const { races } = useRaceStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaultFallback = useMemo(
    () => FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)],
    []
  );

  const [raceName,    setRaceName]    = useState(`Race ${races.length + 1}`);
  const [raceType,    setRaceType]    = useState<RaceType>("MTB");
  const [startDate,   setStartDate]   = useState(today);
  const [location,    setLocation]    = useState("TBD");
  const [status,      setStatus]      = useState("");
  const [ridersFile,  setRidersFile]  = useState<File | null>(null);
  const [loading,     setLoading]     = useState(false);
  // On by default — most organizers want colours picked for them (BUGS.md #6)
  const [autoColor,   setAutoColor]   = useState(true);

  // Selected image: either an "images/filename" gallery path or a base64 data: URL
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  // Gallery filenames fetched from manifest
  const [gallery, setGallery] = useState<string[]>([]);

  useEffect(() => {
    fetch(`${BASE}images/manifest.json`)
      .then(r => r.json())
      .then((data: { images: string[] }) => {
        setGallery(data.images);
        // Pick a random gallery image as default if nothing is selected yet
        if (!selectedImage && data.images.length > 0) {
          const randomFile = data.images[Math.floor(Math.random() * data.images.length)];
          setSelectedImage(`images/${randomFile}`);
        }
      })
      .catch(() => { /* no manifest — fall through to asset fallback */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolved URL to show in the preview
  const previewSrc = (() => {
    if (!selectedImage) return defaultFallback;
    if (selectedImage.startsWith("data:") || selectedImage.startsWith("http")) return selectedImage;
    if (selectedImage.startsWith("images/")) return BASE + selectedImage;
    return defaultFallback;
  })();

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Reset the input so re-picking the SAME file still fires onChange.
    event.target.value = "";
    try {
      // Shrink large uploads to ~100–200 KB so they don't bloat storage.
      const compressed = await compressImage(file);
      setSelectedImage(compressed);
    } catch (err) {
      // Never store the raw full-resolution photo — a multi-MB base64 bloats
      // IndexedDB and can crash rendering on phones (BUGS.md #13). Keep the
      // current cover and tell the user instead.
      console.error("Image processing failed:", err);
      alert(
        "Couldn't process that image (it may be an unsupported format such as HEIC). Please pick a different photo or choose a cover from the gallery."
      );
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setRidersFile(file);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    try {
      await saveRace(
        event,
        raceName,
        startDate,
        location,
        status,
        selectedImage,
        ridersFile,
        setAddNewwRace,
        autoColor,
        raceType
      );
    } catch (error) {
      console.error("Failed to save race:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.addRace}>
      <header className={styles.header}>
        <div className={styles.headerleft}>
          <Button
            variant="icon"
            size="md"
            iconOnly
            className={styles.backButton}
            onClick={() => setAddNewwRace(false)}
            aria-label="Go back"
            type="button"
          >
            <ArrowLeft size={18} />
          </Button>
        </div>
        <div className={styles.headercenter}>Add Race</div>
        <div className={styles.headerright}></div>
      </header>

      <form onSubmit={handleSubmit} className={styles.form}>

        {/* ── Cover preview ── */}
        <div className={styles.imageUpload}>
          <img src={previewSrc} alt="Cover" className={styles.coverImage} />
        </div>

        {/* ── Gallery strip ── */}
        {gallery.length > 0 && (
          <div className={styles.galleryStrip}>
            {gallery.map((filename) => {
              const path = `images/${filename}`;
              const isSelected = selectedImage === path;
              return (
                <button
                  key={filename}
                  type="button"
                  className={`${styles.galleryThumb} ${isSelected ? styles.galleryThumbSelected : ""}`}
                  onClick={() => setSelectedImage(path)}
                >
                  <img src={`${BASE}${path}`} alt={filename} />
                </button>
              );
            })}

            {/* Upload custom */}
            <button
              type="button"
              className={styles.galleryUploadBtn}
              onClick={() => fileInputRef.current?.click()}
              title="Upload custom image"
            >
              <ImagePlus size={20} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: "none" }}
            />
          </div>
        )}

        <div className={styles.lowerPart}>
          {/* ── Race type ── MTB is live; others are previewed as "Soon". */}
          <div className={styles.raceTypeField}>
            <span className={styles.raceTypeLabel}>Race Type</span>
            <div className={styles.raceTypeOptions}>
              {RACE_TYPES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`${styles.raceTypeBtn} ${raceType === opt.value ? styles.raceTypeBtnActive : ""}`}
                  onClick={() => !opt.soon && setRaceType(opt.value)}
                  disabled={opt.soon}
                  aria-pressed={raceType === opt.value}
                  title={opt.soon ? `${opt.label} — coming soon` : `${opt.label} race`}
                >
                  {opt.label}
                  {opt.soon && <span className={styles.raceTypeSoon}>Soon</span>}
                </button>
              ))}
            </div>
          </div>

          <input
            type="text"
            placeholder="Race Name"
            value={raceName}
            onChange={(e) => setRaceName(e.target.value)}
            className={styles.input}
          />

          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={styles.input}
          />

          <input
            type="text"
            placeholder="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={styles.input}
          />

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={styles.input}
          >
            <option value="">Select Status</option>
            <option value="Scheduled">Scheduled</option>
            <option value="running">Ongoing</option>
            <option value="finished">Completed</option>
          </select>

          <div className={styles.fileUpload}>
            <label htmlFor="ridersFileUpload" className={styles.fileLabel}>
              Upload Riders File
            </label>
            <input
              id="ridersFileUpload"
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
            {ridersFile && <p>{ridersFile.name}</p>}
          </div>

          <label className={styles.autoColorRow}>
            <input
              type="checkbox"
              checked={autoColor}
              onChange={(e) => setAutoColor(e.target.checked)}
            />
            <span className={styles.autoColorText}>
              <strong>Auto color categories</strong>
              <small>
                Picks a colour per category, keeping starts that overlap on
                course clearly different. Uncheck to choose colours yourself.
              </small>
            </span>
          </label>

          <Button
            type="submit"
            variant="success"
            size="md"
            className={styles.submitButton}
          >
            {loading ? "Saving..." : "Done"}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AddRace;
