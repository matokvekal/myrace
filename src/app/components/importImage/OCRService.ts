/**
 * OCR batch orchestrator — the only recognition entry point for the UI.
 *
 * Pages are processed sequentially (one shared worker, bounded memory on
 * mobile) and merged into a single CSVParseResult for the mapping wizard.
 */

import type { CSVParseResult } from '@/types/csv.types';
import { createOCRProvider } from './OCRProvider';
import { wordsToTable } from './TableParser';
import { mergePagesToParseResult } from './OCRMapper';
import { detectVerticalRules } from './preprocess';
import type { OCRProgress, OcrLanguages } from './types';
import { DEFAULT_OCR_LANGUAGES } from './types';

export async function runOcrBatch(
   pages: HTMLCanvasElement[],
   onProgress: (progress: OCRProgress) => void,
   languages: OcrLanguages = DEFAULT_OCR_LANGUAGES
): Promise<CSVParseResult> {
   if (pages.length === 0) throw new Error('No pages to recognize');

   const provider = createOCRProvider(languages);
   try {
      await provider.init((p) =>
         onProgress({ phase: 'loading', pageIndex: 0, pageCount: pages.length, progress: p })
      );

      const tables: string[][][] = [];
      for (let i = 0; i < pages.length; i++) {
         const result = await provider.recognize(pages[i], (p) =>
            onProgress({
               phase: 'recognizing',
               pageIndex: i,
               pageCount: pages.length,
               progress: p,
            })
         );
         tables.push(wordsToTable(result, detectVerticalRules(pages[i])));
      }
      return mergePagesToParseResult(tables);
   } finally {
      await provider.dispose();
   }
}
