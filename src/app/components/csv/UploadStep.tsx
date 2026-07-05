"use client";

import { useState, useRef, useEffect, DragEvent } from "react";
import { Camera } from "lucide-react";
import type { MappingTemplate } from "@/types/csv.types";
import { getAllTemplates } from "@/services/templateStorage";
import styles from "./uploadStep.module.css";

interface UploadStepProps {
  onFileUpload: (file: File, template?: MappingTemplate) => void;
  onScanClick?: () => void;
}

const SUPPORTED_EXTS = ['.csv', '.xlsx', '.xls'];
const isSupported = (name: string) => SUPPORTED_EXTS.some((e) => name.toLowerCase().endsWith(e));

function formatDate(ts: number): string {
  const diffDays = Math.floor((Date.now() - ts) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(ts).toLocaleDateString();
}

export default function UploadStep({ onFileUpload, onScanClick }: UploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [templates, setTemplates] = useState<MappingTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<MappingTemplate | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAllTemplates().then(setTemplates);
  }, []);

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (isSupported(file.name)) onFileUpload(file, selectedTemplate ?? undefined);
      else alert("Please upload a CSV or Excel (.xlsx) file");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileUpload(file, selectedTemplate ?? undefined);
  };

  const handleBrowseClick = () => fileInputRef.current?.click();

  const toggleTemplate = (tpl: MappingTemplate) => {
    setSelectedTemplate((prev) => (prev?.id === tpl.id ? null : tpl));
  };

  return (
    <div className={styles.uploadStep}>
      <div className={styles.instructions}>
        <h3>Upload File</h3>
        <p>
          Upload a CSV or Excel (.xlsx) file. Columns can be in any order, in
          Hebrew, English, or any other language.
        </p>

        <div className={styles.supportedFields}>
          <h4>Supported Fields:</h4>
          <ul>
            <li><strong>Bib Number</strong> - מס׳ רוכב / Bib / Number</li>
            <li><strong>First Name</strong> - שם פרטי / First Name</li>
            <li><strong>Last Name</strong> - שם משפחה / Last Name</li>
            <li><strong>Full Name</strong> - שם מלא (will be split automatically)</li>
            <li><strong>Category</strong> - קטגוריה / Category</li>
            <li><strong>Team</strong> - קבוצה / Team / Club</li>
            <li><strong>Heat</strong> - מקצה / Heat</li>
            <li><strong>Total Laps</strong> - סיבובים / Laps</li>
            <li><strong>Start Time</strong> - שעת התחלה / Start Time</li>
            <li><strong>Position</strong> - מיקום / Position</li>
          </ul>
        </div>

        <div className={styles.exampleNote}>
          <strong>Note:</strong> The system will automatically detect encoding,
          delimiter, and skip metadata rows.
        </div>
      </div>

      <div
        className={`${styles.dropZone} ${isDragging ? styles.dragging : ""} ${selectedTemplate ? styles.dropZoneWithTemplate : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileSelect}
          className={styles.fileInput}
        />

        <div className={styles.dropZoneContent}>
          <svg
            className={styles.uploadIcon}
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>

          {isDragging ? (
            <p className={styles.dropText}>Drop file here</p>
          ) : (
            <>
              {selectedTemplate ? (
                <p className={styles.dropText}>
                  Upload file using <strong dir="auto">{selectedTemplate.name}</strong>
                </p>
              ) : (
                <p className={styles.dropText}>Drag & drop CSV or Excel file here</p>
              )}
              <p className={styles.orText}>or</p>
              <button type="button" className={styles.browseButton}>
                {selectedTemplate ? "Browse & Apply Template" : "Browse Files"}
              </button>
              <p className={styles.supportedNote}>.csv · .xlsx · .xls</p>
            </>
          )}
        </div>
      </div>

      {/* ── Photo OCR source ── */}
      {onScanClick && (
        <div className={styles.scanRow}>
          <span className={styles.scanDivider}>or</span>
          <button type="button" className={styles.scanButton} onClick={onScanClick}>
            <Camera size={18} /> Scan Start List (photo)
          </button>
        </div>
      )}

      {/* ── Saved templates ── */}
      {templates.length > 0 && (
        <div className={styles.templateSection}>
          <button
            type="button"
            className={styles.templateToggle}
            onClick={() => setShowTemplates((v) => !v)}
          >
            {showTemplates ? "▾" : "▸"} Saved Templates ({templates.length})
          </button>

          {showTemplates && (
            <>
              <div className={styles.templateHeader}>
                <span className={styles.templateHint}>
                  {selectedTemplate
                    ? "Template selected — upload a file to apply it and skip mapping"
                    : "Select a template to skip the mapping step"}
                </span>
              </div>
              <div className={styles.templateCards}>
                {templates.map((tpl) => {
                  const isSelected = selectedTemplate?.id === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      className={`${styles.templateCard} ${isSelected ? styles.templateCardSelected : ""}`}
                      onClick={() => toggleTemplate(tpl)}
                      type="button"
                    >
                      {isSelected && <span className={styles.checkmark}>✓</span>}
                      <span className={styles.cardName} dir="auto">{tpl.name}</span>
                      <span className={styles.cardMeta}>
                        {tpl.mappings.filter((m) => m.targetField).length} columns · {formatDate(tpl.lastUsed)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
