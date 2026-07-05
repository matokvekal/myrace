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
  const [startDate,   setStartDate]   = useState(today);
  const [location,    setLocation]    = useState("TBD");
  const [status,      setStatus]      = useState("");
  const [ridersFile,  setRidersFile]  = useState<File | null>(null);
  const [loading,     setLoading]     = useState(false);

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
    try {
      // Shrink large uploads to ~100–200 KB so they don't bloat storage.
      const compressed = await compressImage(file);
      setSelectedImage(compressed);
    } catch {
      // Compression failed (unusual) — fall back to the raw image.
      const reader = new FileReader();
      reader.onload = (e) => setSelectedImage(e.target?.result as string);
      reader.readAsDataURL(file);
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
        setAddNewwRace
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
