/**
 * CSV Column Mapper Service
 * 
 * Intelligent column mapping using fuzzy matching and learning.
 * Maps CSV column names to app fields without API costs.
 */

import type {
   ColumnMapping,
   ColumnMappingSuggestion,
   RiderFieldKey,
   ColumnMappingMemory,
   MappingHistory
} from '@/types/csv.types';
import {
   FIELD_KEYWORDS,
   AMBIGUOUS_ALIASES,
   AMBIGUOUS_ALIAS_CAP,
   SEED_ORDER_ALIASES
} from '@/types/csv.types';
import { fuzzyMatchScore, normalize, contains } from '@/utils/levenshtein';
import { detectFieldForHeader } from '@/utils/csvFieldDetector';
import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'csvMappingMemory';
const DB_VERSION = 1;
const STORE_NAME = 'mappings';

// ============================================================================
// IndexedDB for Learning
// ============================================================================

async function initMappingDB(): Promise<IDBPDatabase> {
   return await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
         if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
         }
      }
   });
}

/**
 * Save a mapping to memory for future use
 */
async function saveMappingMemory(
   sourceColumn: string,
   targetField: RiderFieldKey
): Promise<void> {
   try {
      const db = await initMappingDB();
      const id = `${normalize(sourceColumn)}_${targetField}`;

      // Check if exists
      const existing = await db.get(STORE_NAME, id);

      if (existing) {
         // Update existing
         existing.timesUsed++;
         existing.lastUsed = new Date();
         existing.confidence = Math.min(100, existing.confidence + 5); // Boost confidence
         await db.put(STORE_NAME, existing);
      } else {
         // Create new
         const memory: ColumnMappingMemory = {
            id,
            sourceColumn: normalize(sourceColumn),
            targetField,
            confidence: 70, // Start at 70%
            timesUsed: 1,
            lastUsed: new Date(),
            language: detectLanguage(sourceColumn)
         };
         await db.add(STORE_NAME, memory);
      }

      db.close();
   } catch (error) {
      console.error('Failed to save mapping memory:', error);
   }
}

/**
 * Get mapping from memory if exists
 */
async function getMappingFromMemory(
   sourceColumn: string
): Promise<ColumnMappingMemory | null> {
   try {
      const db = await initMappingDB();
      const normalized = normalize(sourceColumn);

      // Try exact match first
      const id = await db.getAllKeys(STORE_NAME);

      for (const key of id) {
         const memory = await db.get(STORE_NAME, key as string);
         if (memory && normalize(memory.sourceColumn) === normalized) {
            db.close();
            return memory;
         }
      }

      db.close();
      return null;
   } catch (error) {
      console.error('Failed to get mapping from memory:', error);
      return null;
   }
}

/**
 * Get all mapping memories
 */
export async function getAllMappingMemories(): Promise<MappingHistory> {
   try {
      const db = await initMappingDB();
      const mappings = await db.getAll(STORE_NAME);
      db.close();

      return {
         mappings,
         lastUpdated: new Date()
      };
   } catch (error) {
      console.error('Failed to get all mappings:', error);
      return { mappings: [], lastUpdated: new Date() };
   }
}

/**
 * Clear all mapping memories
 */
export async function clearMappingMemory(): Promise<void> {
   try {
      const db = await initMappingDB();
      await db.clear(STORE_NAME);
      db.close();
   } catch (error) {
      console.error('Failed to clear mapping memory:', error);
   }
}

// ============================================================================
// Language Detection
// ============================================================================

function detectLanguage(text: string): 'he' | 'en' | 'mixed' {
   const hebrewChars = text.match(/[\u0590-\u05FF]/g) || [];
   const englishChars = text.match(/[a-zA-Z]/g) || [];

   if (hebrewChars.length > 0 && englishChars.length > 0) return 'mixed';
   if (hebrewChars.length > 0) return 'he';
   return 'en';
}

// ============================================================================
// Fuzzy Matching Logic
// ============================================================================

/**
 * Score a single column name against a single keyword.
 * Also tries matching individual words of the column (e.g. "שם מועדון" → "מועדון").
 */
function scoreAgainstKeyword(columnName: string, keyword: string): number {
   // Full column vs keyword
   const fullScore = fuzzyMatchScore(columnName, keyword);
   if (fullScore >= 100) return 100;

   // Try each individual word of the column name
   const words = columnName.trim().split(/\s+/);
   if (words.length > 1) {
      let wordBest = 0;
      for (const word of words) {
         const s = fuzzyMatchScore(word, keyword);
         if (s > wordBest) wordBest = s;
      }
      // Word match is slightly penalised (it's a partial match)
      return Math.max(fullScore, Math.round(wordBest * 0.92));
   }

   return fullScore;
}

/**
 * Find best field match for a CSV column.
 * Uses keyword matching, fuzzy string matching, and per-word matching.
 */
function findBestFieldMatch(
   columnName: string,
   usedFields: Set<RiderFieldKey>
): ColumnMappingSuggestion[] {
   const suggestions: ColumnMappingSuggestion[] = [];
   const normalized = normalize(columnName);
   const language = detectLanguage(columnName);

   const isSeedOrderHeader = SEED_ORDER_ALIASES.has(normalized);
   const isAmbiguousHeader = AMBIGUOUS_ALIASES.has(normalized);

   for (const fieldKeywords of FIELD_KEYWORDS) {
      if (usedFields.has(fieldKeywords.field)) continue;

      // A serial/seed-order column is the pre-race standing, never the bib.
      if (isSeedOrderHeader && fieldKeywords.field === 'bibNumber') continue;

      // For mixed-language columns try all keywords; otherwise restrict to detected language
      const keywords = language === 'mixed'
         ? [...fieldKeywords.hebrew, ...fieldKeywords.english]
         : language === 'en'
            ? [...fieldKeywords.english, ...fieldKeywords.hebrew]   // try Hebrew too for safety
            : [...fieldKeywords.hebrew, ...fieldKeywords.english];

      let bestScore = 0;
      let matchReason = '';

      for (const keyword of keywords) {
         const score = scoreAgainstKeyword(columnName, keyword);

         if (score > bestScore) {
            bestScore = score;

            if (normalize(columnName) === normalize(keyword)) {
               matchReason = 'Exact match';
            } else if (contains(normalized, normalize(keyword))) {
               matchReason = 'Contains keyword';
            } else if (score >= 80) {
               matchReason = 'Fuzzy match';
            } else {
               matchReason = 'Partial match';
            }
         }
      }

      const priorityBoost = fieldKeywords.priority * 2;
      let finalScore = Math.min(100, bestScore + (bestScore > 50 ? priorityBoost : 0));

      // "מס'"/"no" name the field too weakly to claim it outright — capped after
      // the priority boost so a specific header ("מספר רוכב") wins bibNumber.
      if (isAmbiguousHeader) {
         finalScore = Math.min(finalScore, AMBIGUOUS_ALIAS_CAP);
      }

      if (finalScore > 40) {
         suggestions.push({
            field: fieldKeywords.field,
            confidence: finalScore,
            reason: matchReason
         });
      }
   }

   suggestions.sort((a, b) => b.confidence - a.confidence);
   return suggestions;
}

/**
 * Auto-map CSV columns to app fields
 * Returns array of column mappings with confidence scores
 */
export async function autoMapColumns(
   headers: string[]
): Promise<ColumnMapping[]> {
   // Collect every candidate (column → field) BEFORE claiming anything.
   // Assigning left-to-right let a leading seeding column headed "מס'" claim
   // bibNumber and lock the real bib column out of it (BUGS.md #3), so each
   // field now goes to the column that matches it best anywhere in the row.
   type Candidate = {
      columnIndex: number;
      field: RiderFieldKey;
      confidence: number;
      /** Learned mappings outrank fresh guesses at equal confidence. */
      fromMemory: boolean;
   };

   const candidates: Candidate[] = [];
   const noneUsed = new Set<RiderFieldKey>();

   for (let i = 0; i < headers.length; i++) {
      const header = headers[i];

      const memory = await getMappingFromMemory(header);
      if (memory) {
         candidates.push({
            columnIndex: i,
            field: memory.targetField,
            confidence: memory.confidence,
            fromMemory: true
         });
      }

      const dictDetection = detectFieldForHeader(header);
      if (dictDetection && dictDetection.confidence >= 60) {
         candidates.push({
            columnIndex: i,
            field: dictDetection.field,
            confidence: dictDetection.confidence,
            fromMemory: false
         });
      }

      // Keyword matching supplies the fallbacks for fields the dictionary missed
      for (const suggestion of findBestFieldMatch(header, noneUsed)) {
         if (suggestion.confidence >= 60) {
            candidates.push({
               columnIndex: i,
               field: suggestion.field,
               confidence: suggestion.confidence,
               fromMemory: false
            });
         }
      }

      // A vague header ("מס'", "No.") scores the same low cap against every
      // field it brushes, so letting it fall through to runner-up fields drops
      // a serial column onto something unrelated like heat. Keep only its best
      // guess — if a stronger column claims that field, leave this one for the
      // user to map by hand.
      if (AMBIGUOUS_ALIASES.has(normalize(header))) {
         const mine = candidates.filter(c => c.columnIndex === i);
         if (mine.length > 1) {
            const best = mine.reduce((a, b) => (b.confidence > a.confidence ? b : a));
            for (let k = candidates.length - 1; k >= 0; k--) {
               if (candidates[k].columnIndex === i && candidates[k] !== best) {
                  candidates.splice(k, 1);
               }
            }
         }
      }
   }

   // Strongest match first; each column and each field may be claimed once.
   candidates.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.fromMemory !== b.fromMemory) return a.fromMemory ? -1 : 1;
      return a.columnIndex - b.columnIndex;
   });

   const usedFields = new Set<RiderFieldKey>();
   const claimed = new Map<number, Candidate>();

   for (const candidate of candidates) {
      if (usedFields.has(candidate.field)) continue;
      if (claimed.has(candidate.columnIndex)) continue;
      claimed.set(candidate.columnIndex, candidate);
      usedFields.add(candidate.field);
   }

   return headers.map((header, i) => {
      const winner = claimed.get(i);
      if (!winner) {
         return {
            sourceColumn: header,
            targetField: null,
            confidence: 0,
            isAutoMapped: false,
            needsConfirmation: true
         };
      }
      return {
         sourceColumn: header,
         targetField: winner.field,
         confidence: winner.confidence,
         isAutoMapped: true,
         needsConfirmation: winner.confidence < 85
      };
   });
}

/**
 * Effective "required" / "unique" rules for a mapped column. Unset flags fall
 * back to the defaults: required unless the column is empty in every row (then
 * demanding it would flag the whole file), and not unique.
 */
export function resolveColumnRules(
   mapping: ColumnMapping,
   colIdx: number,
   rows: string[][]
): { required: boolean; unique: boolean } {
   const hasData = rows.some((r) => String(r[colIdx] ?? '').trim() !== '');
   return {
      required: mapping.required ?? hasData,
      unique: mapping.unique ?? false
   };
}

/**
 * Get suggestions for a specific column
 * Returns top 3 suggestions
 */
export function getColumnSuggestions(
   columnName: string,
   usedFields: Set<RiderFieldKey>
): ColumnMappingSuggestion[] {
   const suggestions = findBestFieldMatch(columnName, usedFields);
   return suggestions.slice(0, 3); // Top 3
}

/**
 * Confirm and save a mapping
 * Updates learning database
 */
export async function confirmMapping(
   sourceColumn: string,
   targetField: RiderFieldKey
): Promise<void> {
   await saveMappingMemory(sourceColumn, targetField);
}

/**
 * Handle special case: Full name column
 * If only fullName is mapped, suggest splitting to firstName + lastName
 */
export function detectNameSplitting(
   mappings: ColumnMapping[]
): { shouldSplit: boolean; fullNameColumn: string | null } {
   const hasFullName = mappings.some(m => m.targetField === 'fullName');
   const hasFirstName = mappings.some(m => m.targetField === 'firstName');
   const hasLastName = mappings.some(m => m.targetField === 'lastName');

   if (hasFullName && !hasFirstName && !hasLastName) {
      const fullNameMapping = mappings.find(m => m.targetField === 'fullName');
      return {
         shouldSplit: true,
         fullNameColumn: fullNameMapping?.sourceColumn || null
      };
   }

   return { shouldSplit: false, fullNameColumn: null };
}

/**
 * Split full name into first and last name
 * Handles Hebrew and English names
 * 
 * @example
 * splitFullName("גלעד דולב") // { firstName: "גלעד", lastName: "דולב" }
 * splitFullName("John Doe Smith") // { firstName: "John", lastName: "Doe Smith" }
 */
export function splitFullName(
   fullName: string
): { firstName: string; lastName: string } {
   const parts = fullName.trim().split(/\s+/);

   if (parts.length === 0) {
      return { firstName: '', lastName: '' };
   }

   if (parts.length === 1) {
      return { firstName: parts[0], lastName: '' };
   }

   // First part = first name, rest = last name
   const firstName = parts[0];
   const lastName = parts.slice(1).join(' ');

   return { firstName, lastName };
}

/**
 * Get mapping statistics
 */
export function getMappingStats(mappings: ColumnMapping[]): {
   total: number;
   mapped: number;
   unmapped: number;
   needsConfirmation: number;
   highConfidence: number;
} {
   const mapped = mappings.filter(m => m.targetField !== null);
   const needsConfirmation = mappings.filter(m => m.needsConfirmation);
   const highConfidence = mappings.filter(m => m.confidence >= 85);

   return {
      total: mappings.length,
      mapped: mapped.length,
      unmapped: mappings.length - mapped.length,
      needsConfirmation: needsConfirmation.length,
      highConfidence: highConfidence.length
   };
}
