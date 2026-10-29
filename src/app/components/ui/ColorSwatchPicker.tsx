import { useState } from "react";
import styles from "./colorSwatchPicker.module.css";

/** 20 visually distinct presets (hue wheel + neutrals). Any other stored colour is kept as Custom. */
export const PRESET_COLORS: { name: string; code: string }[] = [
  { name: "Red", code: "#E53935" },
  { name: "Orange", code: "#FB8C00" },
  { name: "Amber", code: "#FFB300" },
  { name: "Yellow", code: "#FDD835" },
  { name: "Lime", code: "#C0CA33" },
  { name: "Green", code: "#43A047" },
  { name: "Teal", code: "#00897B" },
  { name: "Cyan", code: "#00ACC1" },
  { name: "Light Blue", code: "#039BE5" },
  { name: "Blue", code: "#1E88E5" },
  { name: "Indigo", code: "#3949AB" },
  { name: "Navy", code: "#1A237E" },
  { name: "Purple", code: "#8E24AA" },
  { name: "Magenta", code: "#D81B60" },
  { name: "Pink", code: "#F06292" },
  { name: "Brown", code: "#6D4C41" },
  { name: "Olive", code: "#827717" },
  { name: "Grey", code: "#757575" },
  { name: "Black", code: "#212121" },
  { name: "White", code: "#FFFFFF" },
];

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const toHex6 = (c?: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : "#63A6FC");

interface Props {
  /** The stored colour; kept as it is, even when it is not a preset. */
  value: string | null | undefined;
  /** Saves a colour (a swatch saves at once; Custom saves on its Save button). */
  onPick: (color: string) => void;
  onCancel: () => void;
  /** Test ids of the custom picker's input and Save button (kept from the old dialog). */
  inputTestId: string;
  saveTestId: string;
}

/** Compact swatch grid with a "Custom Color…" fallback to the native picker. */
export default function ColorSwatchPicker({ value, onPick, onCancel, inputTestId, saveTestId }: Props) {
  const isPreset = PRESET_COLORS.some((p) => same(p.code, value));
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(toHex6(value));

  return (
    <div className={styles.picker}>
      <div className={styles.grid} role="group" aria-label="Preset colours">
        {PRESET_COLORS.map((p) => {
          const selected = same(p.code, value);
          return (
            <button
              key={p.code}
              type="button"
              className={`${styles.swatch} ${selected ? styles.selected : ""}`}
              style={{ background: p.code }}
              aria-label={p.name}
              aria-pressed={selected}
              title={`${p.name} ${p.code}`}
              data-testid={`swatch-${p.code.slice(1)}`}
              onClick={() => onPick(p.code)}
            >
              {selected && <span className={styles.check}>✓</span>}
            </button>
          );
        })}
      </div>

      {value && !isPreset && (
        <div className={styles.customCurrent} data-testid="custom-current">
          <span className={`${styles.swatch} ${styles.selected}`} style={{ background: value }} aria-hidden />
          <span>Custom {value}</span>
        </div>
      )}

      {custom ? (
        <div className={styles.customRow}>
          <input
            type="color"
            className={styles.customInput}
            data-testid={inputTestId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Custom colour"
          />
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button type="button" className={styles.saveBtn} data-testid={saveTestId} onClick={() => onPick(draft)}>Save</button>
        </div>
      ) : (
        <div className={styles.footer}>
          <button type="button" className={styles.customBtn} data-testid="custom-color" onClick={() => setCustom(true)}>
            Custom Color…
          </button>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}
