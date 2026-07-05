/**
 * OCR engine abstraction.
 *
 * The rest of the app only uses this interface and factory — never an OCR
 * library directly. To swap the engine, implement OCRProvider and change
 * createOCRProvider() (see docs/local-ocr.md).
 */

import type { OCRPageResult, OcrLanguages } from './types';
import { DEFAULT_OCR_LANGUAGES } from './types';
import { TesseractProvider } from './TesseractProvider';

export interface OCRProvider {
   /** Load the engine + language models. onProgress: 0-1. */
   init(onProgress?: (progress: number) => void): Promise<void>;
   /** Recognize one preprocessed page. onProgress: 0-1. */
   recognize(
      image: HTMLCanvasElement,
      onProgress?: (progress: number) => void
   ): Promise<OCRPageResult>;
   /** Release workers/memory. Safe to call more than once. */
   dispose(): Promise<void>;
}

export function createOCRProvider(
   languages: OcrLanguages = DEFAULT_OCR_LANGUAGES
): OCRProvider {
   return new TesseractProvider(languages);
}
