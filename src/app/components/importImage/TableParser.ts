/**
 * Reconstructs a table (string[][]) from word-level OCR bounding boxes.
 *
 * 1. Cluster words into rows by vertical overlap.
 * 2. Find column boundaries from a page-global x-coverage histogram
 *    (gaps that no multi-word row covers = column separators).
 * 3. Assign words to cells; Hebrew-dominant cells get their words reversed
 *    so logical RTL word order is preserved (bboxes are visual/image order).
 *
 * Columns are emitted left→right for header and data rows alike — the
 * mapping wizard matches headers by NAME, so only row↔header positional
 * consistency matters, not reading direction.
 */

import type { OCRPageResult, OCRWord } from './types';

const HEBREW_CHAR = /[֐-׿]/;

function median(values: number[]): number {
   if (values.length === 0) return 0;
   const sorted = [...values].sort((a, b) => a - b);
   return sorted[Math.floor(sorted.length / 2)];
}

interface Row {
   words: OCRWord[];
   centerSum: number; // sum of member y-centers — mean = centerSum / words.length
}

/**
 * Cluster words into visual rows by y-center distance to the row's MEAN
 * center. (An expanding min/max envelope must not be used here: one
 * tall garbage word — a table border or column-spanning artifact — would
 * widen the envelope and transitively chain every following row into one.)
 */
function clusterRows(words: OCRWord[], medianHeight: number): Row[] {
   // Outlier-height words are segmentation artifacts, not text
   const usable = words.filter((w) => {
      const h = w.bbox.y1 - w.bbox.y0;
      return h <= 2.5 * medianHeight && h >= 0.25 * medianHeight;
   });
   const sorted = [...usable].sort(
      (a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2
   );
   const rows: Row[] = [];
   for (const word of sorted) {
      const wordCenter = (word.bbox.y0 + word.bbox.y1) / 2;
      const row = rows[rows.length - 1];
      if (row && Math.abs(wordCenter - row.centerSum / row.words.length) <= 0.6 * medianHeight) {
         row.words.push(word);
         row.centerSum += wordCenter;
         continue;
      }
      rows.push({ words: [word], centerSum: wordCenter });
   }
   return rows;
}

/**
 * Column boundaries from an x-coverage histogram over multi-word rows
 * (single-word rows are usually titles/noise and would erase real gaps).
 * Returns inner boundaries only (a 4-column table yields 3 boundaries).
 */
function detectColumnBoundaries(
   rows: Row[],
   pageWidth: number,
   medianCharWidth: number
): number[] {
   const coverage = new Uint32Array(pageWidth);
   let tabularRowCount = 0;
   for (const row of rows) {
      if (row.words.length < 2) continue;
      tabularRowCount++;
      for (const word of row.words) {
         const from = Math.max(0, Math.floor(word.bbox.x0));
         const to = Math.min(pageWidth - 1, Math.ceil(word.bbox.x1));
         for (let x = from; x <= to; x++) coverage[x]++;
      }
   }

   // A gap may be crossed by a few non-tabular rows (title lines span
   // columns) — tolerate up to ~20% noise coverage instead of requiring 0.
   const maxNoise = Math.floor(tabularRowCount * 0.2);
   const isGap = (x: number) => coverage[x] <= maxNoise;

   // Trim (near-)uncovered page margins so they don't count as gaps
   let contentStart = 0;
   let contentEnd = pageWidth - 1;
   while (contentStart < pageWidth && isGap(contentStart)) contentStart++;
   while (contentEnd > contentStart && isGap(contentEnd)) contentEnd--;

   const minGap = Math.max(1.2 * medianCharWidth, pageWidth * 0.012);
   const boundaries: number[] = [];
   let gapStart = -1;
   for (let x = contentStart; x <= contentEnd + 1; x++) {
      const empty = x <= contentEnd && isGap(x);
      if (empty && gapStart < 0) gapStart = x;
      if (!empty && gapStart >= 0) {
         if (x - gapStart >= minGap) boundaries.push((gapStart + x) / 2);
         gapStart = -1;
      }
   }
   return boundaries;
}

/** Fallback: per-row splitting on large horizontal gaps between words. */
function splitRowByGaps(row: Row, medianCharWidth: number): string[] {
   const words = [...row.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
   const cells: OCRWord[][] = [];
   let cell: OCRWord[] = [];
   for (const word of words) {
      const prev = cell[cell.length - 1];
      if (prev && word.bbox.x0 - prev.bbox.x1 > 2.5 * medianCharWidth) {
         cells.push(cell);
         cell = [];
      }
      cell.push(word);
   }
   if (cell.length) cells.push(cell);
   return cells.map(joinCellWords);
}

/** Joins a cell's words in logical order (reversed for Hebrew-dominant text). */
function joinCellWords(words: OCRWord[]): string {
   const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
   const text = sorted.map((w) => w.text).join(' ');
   let hebrew = 0;
   let latin = 0;
   for (const ch of text) {
      if (HEBREW_CHAR.test(ch)) hebrew++;
      else if (/[a-zA-Z]/.test(ch)) latin++;
   }
   if (hebrew > latin) sorted.reverse();
   return sorted.map((w) => w.text).join(' ');
}

/**
 * @param verticalRules x positions of detected table border lines (see
 * detectVerticalRules) — when present they beat word-gap analysis, which
 * cannot separate narrow adjacent columns (rank/points/bib).
 */
export function wordsToTable(page: OCRPageResult, verticalRules: number[] = []): string[][] {
   if (page.words.length === 0) return [];

   const medianHeight = median(page.words.map((w) => w.bbox.y1 - w.bbox.y0));
   const medianCharWidth = median(
      page.words.map((w) => (w.bbox.x1 - w.bbox.x0) / Math.max(1, w.text.length))
   );
   const rows = clusterRows(page.words, medianHeight);

   // Keep only interior rules (words on both sides) — outer table borders
   // and page-edge artifacts would create empty phantom columns.
   const wordCenters = page.words.map((w) => (w.bbox.x0 + w.bbox.x1) / 2);
   const interiorRules = verticalRules.filter(
      (x) => wordCenters.some((c) => c < x) && wordCenters.some((c) => c > x)
   );

   const boundaries =
      interiorRules.length >= 1 && interiorRules.length <= 14
         ? interiorRules
         : detectColumnBoundaries(rows, page.width, medianCharWidth);
   const columnCount = boundaries.length + 1;

   if (columnCount < 2 || columnCount > 12) {
      // Global detection failed (dense/noisy layout) — pad per-row splits
      const split = rows.map((row) => splitRowByGaps(row, medianCharWidth));
      const width = Math.max(...split.map((r) => r.length));
      return split.map((r) => [...r, ...Array(width - r.length).fill('')]);
   }

   return rows.map((row) => {
      const cells: OCRWord[][] = Array.from({ length: columnCount }, () => []);
      for (const word of row.words) {
         const centerX = (word.bbox.x0 + word.bbox.x1) / 2;
         let col = 0;
         while (col < boundaries.length && centerX > boundaries[col]) col++;
         cells[col].push(word);
      }
      return cells.map((cell) => (cell.length ? joinCellWords(cell) : ''));
   });
}
