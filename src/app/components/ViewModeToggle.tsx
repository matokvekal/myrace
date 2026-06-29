/**
 * View Mode Toggle Component
 *
 * Allows users to switch between Watch (read-only) and Edit modes.
 * Only shown if user has edit permissions.
 */

"use client";

import React from "react";
import { useAuth } from "@/hooks/useAuth";
import type { ViewMode } from "@/types/rbac.types";
import styles from "./viewModeToggle.module.css";

export interface ViewModeToggleProps {
  /** Additional CSS class */
  className?: string;
  
  /** Optional callback when mode changes */
  onModeChange?: (mode: ViewMode) => void;
}

/**
 * ViewModeToggle - Switch between Watch and Edit modes
 *
 * @example
 * ```tsx
 * <ViewModeToggle onModeChange={(mode) => console.log("Mode:", mode)} />
 * ```
 */
export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
  className,
  onModeChange
}) => {
  const { viewMode, setViewMode, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return null;
  }

  const handleToggle = (newMode: ViewMode) => {
    setViewMode(newMode);
    onModeChange?.(newMode);
  };

  return (
    <div className={`${styles.container} ${className || ""}`}>
      <div className={styles.toggle}>
        <button
          className={`${styles.button} ${viewMode === "watch" ? styles.active : ""}`}
          onClick={() => handleToggle("watch")}
          title="Switch to watch mode - read only"
          aria-label="Watch mode"
        >
          <span className={styles.icon}>🔒</span>
          <span className={styles.label}>Watch</span>
        </button>

        <button
          className={`${styles.button} ${viewMode === "edit" ? styles.active : ""}`}
          onClick={() => handleToggle("edit")}
          title="Switch to edit mode - interactive"
          aria-label="Edit mode"
        >
          <span className={styles.icon}>✏️</span>
          <span className={styles.label}>Edit</span>
        </button>
      </div>

      {viewMode === "watch" && (
        <div className={styles.indicator}>
          <span className={styles.badge}>👁️ Watch Mode</span>
          <span className={styles.hint}>Read-only</span>
        </div>
      )}
    </div>
  );
};

export default ViewModeToggle;
