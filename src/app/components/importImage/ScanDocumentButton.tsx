"use client";

import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const label = t("scan.list", "Scan Start List");
  const tooltip = t("scan.tooltip", "Scan Start List — coming soon");
  const soon = t("scan.soon", "Soon");

  if (variant === "empty") {
    return (
      <button
        type="button"
        className={`${styles.emptyBtn} ${className}`}
        disabled
        title={tooltip}
      >
        <Camera size={16} /> {label}
        <span className={styles.comingSoonBadge}>{soon}</span>
      </button>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      className={`${styles.barBtn} ${className}`}
      disabled
      title={tooltip}
      startIcon={<Camera size={14} />}
      endIcon={<span className={styles.comingSoonBadge}>{soon}</span>}
    >
      {label}
    </Button>
  );
}
