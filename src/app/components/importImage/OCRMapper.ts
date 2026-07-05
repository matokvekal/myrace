/**
 * Merges per-photo OCR tables into one clean CSVParseResult for the
 * existing CSV Mapping Wizard.
 *
 * Cleanup pass: cell character scrubbing + digit confusion fixes, noise-row
 * filtering, header detection on page 1 (titles above it dropped), repeated
 * header removal on later pages, and duplicate-row dedupe from overlapping
 * photos.
 */

import type { CSVParseResult, RiderFieldKey } from '@/types/csv.types';
import { FIELD_KEYWORDS } from '@/types/csv.types';

// Keep Hebrew, Latin, digits, and characters that appear in real start-list
// cells (times, initials, hyphenated names); everything else is OCR debris.
const CELL_ALLOWED = /[^֐-׿a-zA-Z0-9 .,'"()/:%#-]/g;

const DIGIT_CONFUSIONS: [RegExp, string][] = [
   [/[OoΟ]/g, '0'],
   [/[lI|׀]/g, '1'],
];

function levenshtein(a: string, b: string): number {
   if (a === b) return 0;
   const prev = new Array<number>(b.length + 1);
   for (let j = 0; j <= b.length; j++) prev[j] = j;
   for (let i = 1; i <= a.length; i++) {
      let diagonal = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
         const temp = prev[j];
         prev[j] = Math.min(
            prev[j] + 1,
            prev[j - 1] + 1,
            diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
         );
         diagonal = temp;
      }
   }
   return prev[b.length];
}

function similarity(a: string, b: string): number {
   const max = Math.max(a.length, b.length);
   return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

function normalize(value: string): string {
   return value.toLowerCase().replace(/['"׳״.]/g, '').replace(/\s+/g, ' ').trim();
}

const HEBREW_FINAL_FORMS = 'םןץףך';
const HEBREW_RUN = /[֐-׿]+|[^֐-׿]+/g;

/**
 * Tesseract sometimes emits Hebrew in VISUAL (reversed) order. A Hebrew
 * word can end with a final-form letter but never start with one — a
 * reliable reversal detector. Digit runs keep their own order; run order
 * within the token flips (visual "12םיחהפא" → logical "אפהחים 12").
 */
function fixReversedHebrew(token: string): string {
   const runs = token.match(HEBREW_RUN) ?? [token];
   const isReversed = runs.some(
      (r) => r.length >= 2 && /[֐-׿]/.test(r) && HEBREW_FINAL_FORMS.includes(r[0])
   );
   if (!isReversed) return token;
   return runs
      .reverse()
      .map((r) => (/[֐-׿]/.test(r) ? [...r].reverse().join('') : r))
      .join(' ');
}

export function cleanCell(raw: string): string {
   let value = raw.replace(CELL_ALLOWED, '').replace(/\s+/g, ' ').trim();
   value = value.split(' ').map(fixReversedHebrew).join(' ').replace(/\s+/g, ' ').trim();
   // Stray geresh/gershayim at cell edges are OCR debris, not abbreviations
   value = value.replace(/^[׳״'"]+/, '').replace(/[׳״'"]+$/, '').trim();

   // Digit-dominant cell (bib, heat, laps): fix classic OCR confusions
   const digits = (value.match(/\d/g) ?? []).length;
   const significant = value.replace(/[\s.,:-]/g, '').length;
   if (significant > 0 && digits / significant >= 0.6) {
      let fixed = value;
      for (const [pattern, replacement] of DIGIT_CONFUSIONS) {
         fixed = fixed.replace(pattern, replacement);
      }
      // B→8 only when everything else is already a digit
      if (/^[\dB]+$/.test(fixed.replace(/\s/g, ''))) fixed = fixed.replace(/B/g, '8');
      // If it's now digits + separators only, drop leftover stray marks
      const stripped = fixed.replace(/[^\d\s.,:-]/g, '');
      if (stripped.replace(/[\s.,:-]/g, '').length > 0) value = stripped.trim();
      else value = fixed;
   }
   return value;
}

function isNoiseRow(row: string[]): boolean {
   const joined = row.join('');
   if (joined.trim().length === 0) return true;
   const alphanumeric = (joined.match(/[֐-׿a-zA-Z0-9]/g) ?? []).length;
   if (alphanumeric < 3) return true;
   const nonEmpty = row.filter((c) => c.trim().length > 0);
   // Lone small number = page number; lone punctuation = decoration
   if (nonEmpty.length === 1) {
      const cell = nonEmpty[0].trim();
      if (/^-?\s*\d{1,3}\s*-?$/.test(cell)) return true;
      if (!/[֐-׿a-zA-Z0-9]/.test(cell)) return true;
   }
   return false;
}

// Keywords that are also common data VALUES (gender values, day names) —
// excluded when deciding whether a mid-table row is a repeated header.
const VALUE_LIKE_KEYWORDS = new Set(
   [
      'זכר', 'נקבה', 'ז/נ', 'male', 'female', 'm/f', 'g',
      'שישי', 'שבת', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי',
      'friday', 'saturday', 'sunday', 'monday', 'day1', 'day2', 'd1', 'd2',
   ].map(normalize)
);

/**
 * Fuzzy hit against the CSV field dictionary (same keywords as
 * autoMapColumns). Length thresholds matter: 2-char keywords via includes()
 * and lev≤2 on 4-char words made TITLE lines outscore real headers
 * ("מיתר"≈"מספר", "יער" contains ע"ר).
 */
function matchFieldKeyword(cell: string, exact: boolean): RiderFieldKey | null {
   const value = normalize(cell);
   if (value.length < 2) return null;
   for (const field of FIELD_KEYWORDS) {
      for (const keyword of [...field.hebrew, ...field.english]) {
         const kw = normalize(keyword);
         if (kw.length < 2) continue;
         if (exact && VALUE_LIKE_KEYWORDS.has(kw)) continue;
         if (value === kw || (kw.length >= 4 && levenshtein(value, kw) <= 1)) {
            return field.field;
         }
         if (!exact) {
            if (kw.length >= 3 && value.includes(kw)) return field.field;
            if (kw.length >= 5 && levenshtein(value, kw) <= 2) return field.field;
         }
      }
   }
   return null;
}

/** How many DISTINCT rider fields this row's cells name — headers name many. */
function headerFieldCount(row: string[], exact: boolean): number {
   const fields = new Set<RiderFieldKey>();
   for (const cell of row) {
      const field = matchFieldKeyword(cell, exact);
      if (field) fields.add(field);
   }
   return fields.size;
}

/** Best-scoring row near the top wins (first-hit picked title lines). */
function findHeaderRowIndex(rows: string[][]): number {
   const limit = Math.min(rows.length, 6); // headers live near the top
   let best = 0;
   let bestScore = 0;
   for (let i = 0; i < limit; i++) {
      const score = headerFieldCount(rows[i], false);
      if (score > bestScore) {
         best = i;
         bestScore = score;
      }
   }
   return bestScore >= 2 ? best : 0;
}

/**
 * A data row whose cells near-exactly name ≥3 distinct fields is a header
 * line repeated mid-list (common on multi-page scans) — even when column
 * alignment differs from page 1 and positional matching misses it.
 */
function looksLikeHeaderRow(row: string[]): boolean {
   return headerFieldCount(row, true) >= 3;
}

function isRepeatedHeader(row: string[], headers: string[]): boolean {
   const nonEmpty = row
      .map((cell, i) => ({ cell: normalize(cell), header: normalize(headers[i] ?? '') }))
      .filter((p) => p.cell.length > 0);
   if (nonEmpty.length === 0) return false;
   const matches = nonEmpty.filter(
      (p) => p.header.length > 0 && similarity(p.cell, p.header) >= 0.75
   ).length;
   return matches / nonEmpty.length >= 0.6;
}

function rowKey(row: string[]): string {
   return normalize(row.join('|')).replace(/[^֐-׿a-z0-9]/g, '');
}

/** Same leading bib + near-identical content = overlapping-photo duplicate. */
function isNearDuplicate(a: string[], b: string[]): boolean {
   const bibA = a.find((c) => c.trim().length > 0)?.trim();
   const bibB = b.find((c) => c.trim().length > 0)?.trim();
   if (!bibA || bibA !== bibB || !/^\d+$/.test(bibA)) return false;
   return similarity(rowKey(a), rowKey(b)) >= 0.85;
}

export function mergePagesToParseResult(pages: string[][][]): CSVParseResult {
   const columnCount = Math.max(1, ...pages.flat().map((row) => row.length));
   const pad = (row: string[]) => [
      ...row,
      ...Array<string>(columnCount - row.length).fill(''),
   ];

   const cleanedPages = pages.map((page) =>
      page.map((row) => pad(row.map(cleanCell))).filter((row) => !isNoiseRow(row))
   );

   const firstPage = cleanedPages[0] ?? [];
   const headerIndex = findHeaderRowIndex(firstPage);
   const headers = (firstPage[headerIndex] ?? []).map(
      (cell, i) => cell.trim() || `Column ${i + 1}`
   );

   const rows: string[][] = [];
   const seenKeys = new Set<string>();
   const bibRows = new Map<string, string[][]>(); // leading bib → kept rows

   cleanedPages.forEach((page, pageIdx) => {
      // Every page of a printed list repeats title lines above its header —
      // anchor on the (repeated) header row and drop everything above it.
      let startIndex = headerIndex + 1;
      if (pageIdx > 0) {
         startIndex = 0;
         const limit = Math.min(page.length, 6);
         for (let i = 0; i < limit; i++) {
            if (isRepeatedHeader(page[i], headers) || looksLikeHeaderRow(page[i])) {
               startIndex = i + 1;
               break;
            }
         }
      }
      for (const row of page.slice(startIndex)) {
         if (isRepeatedHeader(row, headers) || looksLikeHeaderRow(row)) continue;

         const key = rowKey(row);
         if (seenKeys.has(key)) continue;

         const bib = row.find((c) => c.trim().length > 0)?.trim() ?? '';
         const candidates = bibRows.get(bib);
         if (candidates?.some((kept) => isNearDuplicate(kept, row))) continue;

         seenKeys.add(key);
         if (!bibRows.has(bib)) bibRows.set(bib, []);
         bibRows.get(bib)!.push(row);
         rows.push(row);
      }
   });

   return {
      headers,
      rows,
      detection: { encoding: 'OCR', delimiter: 'OCR', headerRow: 0 },
   };
}
