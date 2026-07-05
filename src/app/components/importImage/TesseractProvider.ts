/**
 * Tesseract.js implementation of OCRProvider.
 *
 * All assets are self-hosted under public/ocr/ (vendored by
 * `npm run ocr-assets`) so recognition works fully offline — the service
 * worker precaches them at install (public/sw.js).
 */

import { createWorker, OEM } from 'tesseract.js';
import type { Worker as TesseractWorker } from 'tesseract.js';
import type { OCRProvider } from './OCRProvider';
import type { OCRPageResult, OCRWord, OcrLanguages } from './types';
import { DEFAULT_OCR_LANGUAGES } from './types';

const MIN_WORD_CONFIDENCE = 30;

export class TesseractProvider implements OCRProvider {
   private worker: TesseractWorker | null = null;
   private onLoggerProgress: ((progress: number) => void) | null = null;

   constructor(private languages: OcrLanguages = DEFAULT_OCR_LANGUAGES) {}

   async init(onProgress?: (progress: number) => void): Promise<void> {
      if (this.worker) return;
      const base = import.meta.env.BASE_URL;
      // Loading passes through several statuses (core, language, init);
      // report recognizing-phase progress only via the recognize() callback.
      this.worker = await createWorker(this.languages, OEM.LSTM_ONLY, {
         workerPath: `${base}ocr/worker.min.js`,
         corePath: `${base}ocr/core`,
         langPath: `${base}ocr/lang`,
         gzip: false, // raw .traineddata files are served
         logger: (m) => {
            if (m.status === 'recognizing text') {
               this.onLoggerProgress?.(m.progress);
            } else if (m.status === 'loading tesseract core') {
               onProgress?.(m.progress * 0.5);
            } else {
               onProgress?.(0.5 + (m.progress || 0) * 0.5);
            }
         },
      });
      // Canvases carry no DPI; without a hint Tesseract guesses (often badly
      // for dense Hebrew print). ~300dpi matches an A4 page at our OCR size.
      await this.worker.setParameters({ user_defined_dpi: '300' });
      onProgress?.(1);
   }

   async recognize(
      image: HTMLCanvasElement,
      onProgress?: (progress: number) => void
   ): Promise<OCRPageResult> {
      if (!this.worker) throw new Error('OCR provider not initialized');
      this.onLoggerProgress = onProgress ?? null;
      try {
         const { data } = await this.worker.recognize(
            image,
            {},
            { blocks: true, text: false }
         );
         const words: OCRWord[] = [];
         for (const block of data.blocks ?? []) {
            for (const paragraph of block.paragraphs) {
               for (const line of paragraph.lines) {
                  for (const word of line.words) {
                     const text = word.text.trim();
                     if (!text || word.confidence < MIN_WORD_CONFIDENCE) continue;
                     words.push({
                        text,
                        confidence: word.confidence,
                        bbox: { ...word.bbox },
                     });
                  }
               }
            }
         }
         return { words, width: image.width, height: image.height };
      } finally {
         this.onLoggerProgress = null;
      }
   }

   async dispose(): Promise<void> {
      const worker = this.worker;
      this.worker = null;
      if (worker) await worker.terminate();
   }
}
