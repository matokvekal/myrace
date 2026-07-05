"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, ScanText, Trash2 } from "lucide-react";
import type { CSVParseResult } from "@/types/csv.types";
import type { CapturedPage, OCRProgress, OcrLanguages, Quad } from "./types";
import { DEFAULT_OCR_LANGUAGES, OCR_LANGUAGES_STORAGE_KEY } from "./types";
import { loadPickedImage, preprocessForOCR } from "./preprocess";
import { warpPerspective } from "./PerspectiveCorrection";
import { runOcrBatch } from "./OCRService";
import ImageCropper from "./ImageCropper";
import styles from "./imageCapture.module.css";

interface ImageCaptureProps {
  onComplete: (result: CSVParseResult) => void;
  onCancel: () => void;
}

const MAX_PAGES = 6;

const LANGUAGE_OPTIONS: { value: OcrLanguages; label: string }[] = [
  { value: "heb", label: "עברית (Hebrew)" },
  { value: "eng", label: "English" },
  { value: "heb+eng", label: "עברית + English (mixed)" },
];

function loadSavedLanguages(): OcrLanguages {
  const saved = localStorage.getItem(OCR_LANGUAGES_STORAGE_KEY);
  return LANGUAGE_OPTIONS.some((o) => o.value === saved)
    ? (saved as OcrLanguages)
    : DEFAULT_OCR_LANGUAGES;
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.85
    );
  });
}

export default function ImageCapture({ onComplete, onCancel }: ImageCaptureProps) {
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [languages, setLanguages] = useState<OcrLanguages>(loadSavedLanguages);
  const [cropperFor, setCropperFor] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [progress, setProgress] = useState<OCRProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef<CapturedPage[]>([]);
  pagesRef.current = pages;

  // Revoke display URLs when the component goes away
  useEffect(
    () => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.displayUrl)),
    []
  );

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_PAGES - pages.length;
    const accepted = Array.from(files).slice(0, room);
    if (files.length > room) {
      alert(`Up to ${MAX_PAGES} photos per scan — extra photos were skipped.`);
    }
    setIsAdding(true);
    try {
      const added: CapturedPage[] = [];
      for (const file of accepted) {
        const canvas = await loadPickedImage(file);
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          displayUrl: await canvasToObjectUrl(canvas),
          width: canvas.width,
          height: canvas.height,
          quad: null,
        });
      }
      setPages((prev) => [...prev, ...added]);
    } catch (err) {
      console.error("Failed to load image:", err);
      setError("Failed to load one of the images. Please try a different photo.");
    } finally {
      setIsAdding(false);
    }
  };

  const removePage = (id: string) => {
    setPages((prev) => {
      const page = prev.find((p) => p.id === id);
      if (page) URL.revokeObjectURL(page.displayUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const movePage = (id: string, delta: -1 | 1) => {
    setPages((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const applyCrop = (id: string, quad: Quad) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, quad } : p)));
    setCropperFor(null);
  };

  const runOcr = async () => {
    setError(null);
    setProgress({ phase: "loading", pageIndex: 0, pageCount: pages.length, progress: 0 });
    try {
      const canvases: HTMLCanvasElement[] = [];
      for (const page of pages) {
        // Re-decode from the file (deterministic size — the quad's space)
        let canvas = await loadPickedImage(page.file);
        if (page.quad) canvas = warpPerspective(canvas, page.quad);
        canvases.push(preprocessForOCR(canvas));
      }
      const result = await runOcrBatch(canvases, setProgress, languages);
      if (result.rows.length === 0) {
        setError(
          "No table rows were detected. Try cropping tighter around the list, or retake the photo with better lighting."
        );
        setProgress(null);
        return;
      }
      onComplete(result);
    } catch (err) {
      console.error("OCR failed:", err);
      setError("Text recognition failed. Please try again.");
      setProgress(null);
    }
  };

  const cropperPage = cropperFor ? pages.find((p) => p.id === cropperFor) : null;
  if (cropperPage) {
    return (
      <ImageCropper
        imageUrl={cropperPage.displayUrl}
        imageWidth={cropperPage.width}
        imageHeight={cropperPage.height}
        initialQuad={cropperPage.quad}
        onConfirm={(quad) => applyCrop(cropperPage.id, quad)}
        onCancel={() => setCropperFor(null)}
      />
    );
  }

  if (progress) {
    const label =
      progress.phase === "loading"
        ? "Loading OCR engine…"
        : `Reading page ${progress.pageIndex + 1} of ${progress.pageCount}…`;
    const percent =
      progress.phase === "loading"
        ? progress.progress
        : (progress.pageIndex + progress.progress) / progress.pageCount;
    return (
      <div className={styles.progressPanel}>
        <ScanText size={48} className={styles.progressIcon} />
        <p className={styles.progressLabel}>{label}</p>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${Math.round(percent * 100)}%` }} />
        </div>
        <p className={styles.progressNote}>
          Recognition runs entirely on this device — no internet needed.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.capture}>
      <div className={styles.instructions}>
        <h3>Scan Start List</h3>
        <p>
          Photograph a printed start list — up to {MAX_PAGES} photos for a multi-page
          list. Rows from all pages are combined; repeated headers and duplicate rows
          are removed automatically. Hebrew and English are supported.
        </p>
      </div>

      <div className={styles.languageRow}>
        <label className={styles.languageLabel} htmlFor="ocr-language">
          List language:
        </label>
        <select
          id="ocr-language"
          className={styles.languageSelect}
          value={languages}
          onChange={(e) => {
            const value = e.target.value as OcrLanguages;
            setLanguages(value);
            localStorage.setItem(OCR_LANGUAGES_STORAGE_KEY, value);
          }}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className={styles.languageHint} dir="auto">
          Single-language lists read best with that language only.
        </span>
      </div>

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className={styles.fileInput}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.fileInput}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {pages.length > 0 && (
        <div className={styles.thumbGrid}>
          {pages.map((page, index) => (
            <div key={page.id} className={styles.thumbCard}>
              <img src={page.displayUrl} alt={`Page ${index + 1}`} className={styles.thumbImage} />
              <span className={styles.pageBadge}>{index + 1}</span>
              {page.quad && <span className={styles.croppedBadge}>✂ cropped</span>}
              <div className={styles.thumbActions}>
                <button type="button" onClick={() => movePage(page.id, -1)} disabled={index === 0} title="Move earlier">
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => movePage(page.id, 1)}
                  disabled={index === pages.length - 1}
                  title="Move later"
                >
                  ▼
                </button>
                <button type="button" onClick={() => setCropperFor(page.id)} title="Crop / straighten">
                  ✂
                </button>
                <button type="button" onClick={() => removePage(page.id)} title="Remove">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.addRow}>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => galleryInputRef.current?.click()}
          disabled={isAdding || pages.length >= MAX_PAGES}
        >
          <ImagePlus size={18} />
          {isAdding ? "Loading…" : "Add Photos"}
        </button>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => cameraInputRef.current?.click()}
          disabled={isAdding || pages.length >= MAX_PAGES}
        >
          <Camera size={18} />
          Take Photo
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          Back
        </button>
        <button
          type="button"
          className={styles.runBtn}
          onClick={runOcr}
          disabled={pages.length === 0 || isAdding}
        >
          <ScanText size={18} />
          Run OCR ({pages.length} {pages.length === 1 ? "photo" : "photos"})
        </button>
      </div>
    </div>
  );
}
