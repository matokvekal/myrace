import fieldMappingDictionary from './fieldMappingDictionary.json';
import type { RiderFieldKey } from '@/types/csv.types';
import {
  AMBIGUOUS_ALIASES,
  AMBIGUOUS_ALIAS_CAP,
  SEED_ORDER_ALIASES
} from '@/types/csv.types';

export type StandardField = keyof typeof fieldMappingDictionary;

interface DetectionResult {
  field: StandardField;
  confidence: number; // 0-100
}

interface DetectionResultCamelCase {
  field: RiderFieldKey;
  confidence: number;
}

// Map snake_case dictionary keys to camelCase RiderFieldKey
const fieldNameMap: Record<StandardField, RiderFieldKey> = {
  'bib': 'bibNumber',
  'first_name': 'firstName',
  'middle_name': 'middleName',
  'last_name': 'lastName',
  'first_name_english': 'firstNameEnglish',
  'last_name_english': 'lastNameEnglish',
  'full_name': 'fullName',
  'club': 'team',  // Map 'club' from dictionary to 'team' in RiderFieldKey
  'category': 'category',
  'heat': 'heat',
  'start_time': 'startTime',
  'total_laps': 'totalLaps',
  'position': 'position',
  'standing': 'standing',
  'gender': 'gender',
  'uci_number': 'uciNumber',
  'id_number': 'idNumber',
  'birth_date': 'birthDate',
  'federation_number': 'federationNumber',
  'federation_chip': 'federationChip',
  'road_number': 'roadNumber',
  'chip': 'chip',
  'notes': 'notes'
};

/**
 * Normalize a header string for matching
 * Handles Hebrew and English, removes special chars and extra spaces
 */
function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/['"״׳]/g, '') // Remove quote variants
    .replace(/\s+/g, ' ');
}

/**
 * Calculate similarity score between two strings
 * Returns 0-100 where 100 is exact match
 */
function calculateSimilarity(str1: string, str2: string): number {
  const norm1 = normalizeHeader(str1);
  const norm2 = normalizeHeader(str2);

  if (norm1 === norm2) return 100;

  // Check if one contains the other
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    return 85;
  }

  // Levenshtein distance for fuzzy matching
  const longer = norm1.length > norm2.length ? norm1 : norm2;
  const shorter = norm1.length > norm2.length ? norm2 : norm1;

  if (longer.length === 0) return 100;

  const editDistance = getEditDistance(shorter, longer);
  const similarity = ((longer.length - editDistance) / longer.length) * 100;

  return Math.max(0, Math.min(100, similarity));
}

/**
 * Calculate Levenshtein distance between two strings
 */
function getEditDistance(s1: string, s2: string): number {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

/**
 * Detect the standard field for a CSV header
 * Returns best matching field with confidence score (camelCase RiderFieldKey)
 */
export function detectFieldForHeader(header: string): DetectionResultCamelCase | null {
  const normalized = normalizeHeader(header);

  // A serial/seed-order column is the pre-race standing, never the bib number.
  const isSeedOrderHeader = SEED_ORDER_ALIASES.has(normalized);

  let bestMatch: DetectionResult | null = null;

  for (const [field, variations] of Object.entries(fieldMappingDictionary)) {
    if (isSeedOrderHeader && field === 'bib') continue;

    for (const variation of variations as string[]) {
      const similarity = calculateSimilarity(header, variation);

      if (similarity > 70) {
        // Only consider matches with good confidence (lowered threshold for better detection)
        if (!bestMatch || similarity > bestMatch.confidence) {
          bestMatch = {
            field: field as StandardField,
            confidence: similarity,
          };
        }
      }
    }
  }

  if (!bestMatch) return null;

  // A vague header ("מס'", "no") names its field too weakly to claim it
  // outright — cap it so a specific header ("מספר רוכב") wins bibNumber and the
  // seeding column stops being imported as the bib number (BUGS.md #3).
  const confidence = AMBIGUOUS_ALIASES.has(normalized)
    ? Math.min(bestMatch.confidence, AMBIGUOUS_ALIAS_CAP)
    : bestMatch.confidence;

  return {
    field: fieldNameMap[bestMatch.field],
    confidence
  };
}

/**
 * Detect all fields in a CSV header row
 * Returns mapping of column index to detected field (camelCase RiderFieldKey)
 */
export function detectAllFields(
  headers: string[]
): { [columnIndex: number]: DetectionResultCamelCase } {
  const results: { [columnIndex: number]: DetectionResultCamelCase } = {};

  headers.forEach((header, index) => {
    const detection = detectFieldForHeader(header);
    if (detection) {
      results[index] = detection;
    }
  });

  return results;
}

/**
 * Get all variations for a standard field
 * Useful for showing user what names we recognize
 */
export function getFieldVariations(field: StandardField): string[] {
  return (fieldMappingDictionary[field] as string[]) || [];
}

/**
 * Check if a header is a known field variation
 */
export function isKnownField(header: string): boolean {
  return detectFieldForHeader(header) !== null;
}

/**
 * Get all standard fields
 */
export function getAllFields(): StandardField[] {
  return Object.keys(fieldMappingDictionary) as StandardField[];
}
