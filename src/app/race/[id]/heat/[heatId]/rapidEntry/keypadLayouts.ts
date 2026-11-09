/**
 * Keypad layouts for Live's Rapid Entry (Settings → Keyboard). UI only: which key sits
 * where and how big — recording, auto-submit, validation and Undo are untouched.
 *
 * Ten layouts = five variants × two digit orders. "A1" (Original, 1 2 3) is today's keypad:
 * RapidEntry renders it with exactly the markup it always had (no data-layout attribute), so
 * none of the variant CSS applies. Every other layout sets `data-layout` + `dir="ltr"` on the pad.
 */
import { create } from "zustand";

export type KeypadVariant = "original" | "compact" | "enterLeft" | "enterLeftCompact" | "enterTop";
export type KeypadDigitOrder = "normal" | "reversed";

export interface KeypadLayout {
  id: string;
  variant: KeypadVariant;
  order: KeypadDigitOrder;
  name: string;
  /** The 1–9 keys, left to right, top to bottom (0 is always the wide bottom key). */
  digits: string[];
}

const NORMAL = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const REVERSED = ["3", "2", "1", "6", "5", "4", "9", "8", "7"];
const VARIANTS: { variant: KeypadVariant; name: string }[] = [
  { variant: "original", name: "Original" },
  { variant: "compact", name: "Compact" },
  { variant: "enterLeft", name: "Enter Left" },
  { variant: "enterLeftCompact", name: "Enter Left Compact" },
  { variant: "enterTop", name: "Enter Top" },
];

export const KEYPAD_LAYOUTS: KeypadLayout[] = (["normal", "reversed"] as const).flatMap((order) =>
  VARIANTS.map(({ variant, name }, i) => ({
    id: `${order === "normal" ? "A" : "B"}${i + 1}`,
    variant,
    order,
    name: order === "normal" ? `${name} · 1 2 3` : `${name} · 3 2 1`,
    digits: order === "normal" ? NORMAL : REVERSED,
  })),
);

/** Today's keypad. Also what any missing / unknown saved value means. */
export const ORIGINAL_KEYPAD_LAYOUT_ID = "A1";

export const keypadLayoutById = (id: string | null | undefined): KeypadLayout =>
  KEYPAD_LAYOUTS.find((l) => l.id === id) ?? KEYPAD_LAYOUTS[0];

/** True only for a layout that differs from today's keypad (A1 renders the original markup). */
export const isCustomKeypadLayout = (l: KeypadLayout) => l.id !== ORIGINAL_KEYPAD_LAYOUT_ID;

// ── the choice, per device/browser ──────────────────────────────────────────

const STORAGE_KEY = "commissaire.keypadLayout";

function readSaved(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return KEYPAD_LAYOUTS.some((l) => l.id === v) ? v! : ORIGINAL_KEYPAD_LAYOUT_ID;
  } catch {
    return ORIGINAL_KEYPAD_LAYOUT_ID;
  }
}

interface KeypadLayoutState {
  /** The saved layout (A1 when nothing valid is saved). */
  layoutId: string;
  setLayoutId: (id: string) => void;
  /** The Settings preview is open: the real Live keypad ignores the physical keyboard meanwhile. */
  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;
}

export const useKeypadLayoutStore = create<KeypadLayoutState>((set) => ({
  layoutId: readSaved(),
  setLayoutId: (id) => {
    const valid = KEYPAD_LAYOUTS.some((l) => l.id === id) ? id : ORIGINAL_KEYPAD_LAYOUT_ID;
    try {
      localStorage.setItem(STORAGE_KEY, valid);
    } catch {
      /* private mode — applies now, just isn't remembered */
    }
    set({ layoutId: valid });
  },
  previewOpen: false,
  setPreviewOpen: (previewOpen) => set({ previewOpen }),
}));
