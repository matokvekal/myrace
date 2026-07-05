/**
 * OCR Import Type Definitions
 *
 * Types for the offline photo → table → CSVParseResult pipeline.
 * Engine-agnostic: nothing here depends on tesseract.js.
 */

/**
 * OCR language selection. Single-language modes are noticeably more accurate
 * than the combined one — with 'heb+eng' Tesseract often tries Latin
 * interpretations of Hebrew glyphs, so users should pick the narrowest mode
 * that fits their list.
 */
export type OcrLanguages = 'heb' | 'eng' | 'heb+eng';

export const DEFAULT_OCR_LANGUAGES: OcrLanguages = 'heb+eng';

/** localStorage key remembering the user's last language choice. */
export const OCR_LANGUAGES_STORAGE_KEY = 'ocrLanguages';

export interface Point {
   x: number;
   y: number;
}

/** Document corners in original-image pixel coordinates. */
export interface Quad {
   tl: Point;
   tr: Point;
   br: Point;
   bl: Point;
}

export interface OCRWord {
   text: string;
   confidence: number; // 0-100
   bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OCRPageResult {
   words: OCRWord[];
   width: number;
   height: number;
}

export interface OCRProgress {
   phase: 'loading' | 'recognizing';
   pageIndex: number; // 0-based
   pageCount: number;
   progress: number; // 0-1 within the current phase/page
}

/**
 * One photo in the scan batch, in start-list page order.
 * The file is re-decoded (deterministically, via loadPickedImage) when OCR
 * runs, so only a lightweight display URL is kept in memory.
 */
export interface CapturedPage {
   id: string;
   file: File;
   displayUrl: string; // object URL (JPEG of the decoded canvas) for UI
   width: number; // decoded-canvas size — the coordinate space of `quad`
   height: number;
   quad: Quad | null; // null = no manual crop
}
