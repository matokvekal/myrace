"use client";

import { Camera } from "lucide-react";
import Button from "@/components/ui/Button";
import styles from "./scanDocumentButton.module.css";

interface ScanDocumentButtonProps {
  onClick: () => void;
  /** "bar" matches the top-bar secondary buttons; "empty" the empty-state CTA */
  variant?: "bar" | "empty";
  className?: string;
}

export default function ScanDocumentButton({
  onClick,
  variant = "bar",
  className = "",
}: ScanDocumentButtonProps) {
  if (variant === "empty") {
    return (
      <button type="button" className={`${styles.emptyBtn} ${className}`} onClick={onClick}>
        <Camera size={16} /> Scan Start List
      </button>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      className={`${styles.barBtn} ${className}`}
      onClick={onClick}
      startIcon={<Camera size={14} />}
    >
      Scan Start List
    </Button>
  );
}
