/**
 * CSV Import Type Definitions
 * 
 * Types for intelligent CSV import system with fuzzy matching
 */

import type { RiderProps } from './types';

// ============================================================================
// CSV Parsing Types
// ============================================================================

export interface CSVParseResult {
   headers: string[];
   rows: string[][];
   detection: {
      encoding: string;
      delimiter: string;
      headerRow: number;
   };
}

export interface CSVDetectionResult {
   encoding: 'UTF-8' | 'UTF-16' | 'Windows-1255' | 'Unknown';
   delimiter: ',' | '\t' | ';' | '|';
   hasHeaders: boolean;
   headerRowIndex: number;
   confidence: number;
}

// ============================================================================
// Column Mapping Types
// ============================================================================

export type RiderFieldKey =
   | 'bibNumber'
   | 'firstName'
   | 'middleName'
   | 'lastName'
   | 'firstNameEnglish'
   | 'lastNameEnglish'
   | 'fullName'
   | 'category'
   | 'subCategory'
   | 'team'
   | 'gender'
   | 'heat'
   | 'startTime'
   | 'totalLaps'
   | 'position'
   | 'standing'
   | 'raceDay'
   | 'points'
   | 'uciPoints'
   | 'federation'
   | 'uciNumber'
   | 'idNumber'
   | 'birthDate'
   | 'federationNumber'
   | 'federationChip'
   | 'roadNumber'
   | 'chip'
   | 'notes'
   // Synthetic target (BUGS.md #7): "Keep as info". Not a real rider field and
   // never auto-detected — the user assigns it by hand to any UNrecognised
   // column to keep its raw value on the rider (extraFields, shown on the card).
   // Unlike every other target it is MULTI-USE: many columns can be info at once.
   | 'infoField';

export interface ColumnMapping {
   sourceColumn: string;      // Original CSV column name
   targetField: RiderFieldKey | null; // App field or null if unmapped
   confidence: number;        // 0-100
   isAutoMapped: boolean;     // True if auto-detected
   needsConfirmation: boolean; // True if confidence < 85%
}

export interface ColumnMappingSuggestion {
   field: RiderFieldKey;
   confidence: number;
   reason: string; // "Exact match", "Fuzzy match", "Keyword found"
}

// ============================================================================
// Validation Types
// ============================================================================

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
   severity: ValidationSeverity;
   row: number;
   field: RiderFieldKey | 'general';
   message: string;
   value?: string;
}

export interface ValidationResult {
   isValid: boolean;
   issues: ValidationIssue[];
   summary: {
      total: number;
      errors: number;
      warnings: number;
      info: number;
   };
}

// ============================================================================
// Import Types
// ============================================================================

export interface ParsedRider {
   rowIndex: number;
   data: Partial<RiderProps>;
   issues: ValidationIssue[];
   isValid: boolean;
}

export interface ImportPreview {
   riders: ParsedRider[];
   validation: ValidationResult;
   stats: {
      total: number;
      valid: number;
      warnings: number;
      errors: number;
   };
}

export interface ImportResult {
   success: boolean;
   imported: number;
   skipped: number;
   errors: ValidationIssue[];
   riders: RiderProps[];
}

export interface ImportProgress {
   total: number;
   processed: number;
   successful: number;
   failed: number;
   status: 'importing' | 'completed' | 'error';
}

// ============================================================================
// Mapping Templates (saved structures for reuse)
// ============================================================================

export interface MappingTemplate {
  id: string;
  name: string;
  headers: string[];   // Original source headers at save time
  mappings: { sourceColumn: string; targetField: RiderFieldKey | null }[];
  createdAt: number;
  lastUsed: number;
  usedCount: number;
}

// ============================================================================
// Learning/Memory Types
// ============================================================================

export interface ColumnMappingMemory {
   id: string;
   sourceColumn: string;
   targetField: RiderFieldKey;
   confidence: number;
   timesUsed: number;
   lastUsed: Date;
   language: 'he' | 'en' | 'mixed';
}

export interface MappingHistory {
   mappings: ColumnMappingMemory[];
   lastUpdated: Date;
}

// ============================================================================
// Wizard State Types
// ============================================================================

export type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete';

export interface ImportWizardState {
   step: ImportStep;
   file: File | null;
   parseResult: CSVParseResult | null;
   columnMappings: ColumnMapping[];
   preview: ImportPreview | null;
   importResult: ImportResult | null;
   isLoading: boolean;
   error: string | null;
}

// ============================================================================
// Field Keywords (for fuzzy matching)
// ============================================================================

export interface FieldKeywords {
   field: RiderFieldKey;
   hebrew: string[];
   english: string[];
   priority: number; // Higher = more important (for disambiguation)
}

export const FIELD_KEYWORDS: FieldKeywords[] = [
   {
      field: 'bibNumber',
      hebrew: [
         'מספר', 'מס\'', 'מס.', 'מס', 'ביב', 'רוכב',
         'מס רוכב', 'מספר רוכב', 'מספר מתחרה', 'מס מתחרה',
         'מס\' רוכב', 'ב\''
      ],
      english: [
         'bib', 'bib#', 'bib no', 'bib number', 'bib num',
         'number', 'num', 'no', 'no.',
         'rider', 'rider number', 'rider no',
         'start number', 'start no', 'start num',
         'athlete no', 'athlete number', '#', 'sno'
      ],
      priority: 10
   },
   {
      field: 'firstName',
      hebrew: [
         'שם פרטי', 'פרטי', 'שם ראשון', 'שם',
         'שם\' פרטי', 'פ\''
      ],
      english: [
         'first', 'first name', 'firstname', 'fname', 'f name',
         'given', 'given name', 'forename',
         'p name', 'pname', 'prename'
      ],
      priority: 8
   },
   {
      field: 'middleName',
      hebrew: [
         'שם אמצעי', 'אמצעי', 'שם אמצעי של הרוכב',
         'שם\' אמצעי'
      ],
      english: [
         'middle', 'middle name', 'middlename', 'mname', 'm name',
         'second name'
      ],
      priority: 5
   },
   {
      field: 'lastName',
      hebrew: [
         'שם משפחה', 'משפחה', 'מש\'', 'שם אחרון',
         'שם\' משפחה', 'פמיליה'
      ],
      english: [
         'last', 'last name', 'lastname', 'lname', 'l name',
         'surname', 'family', 'family name',
         's name'
      ],
      priority: 8
   },
   {
      field: 'fullName',
      hebrew: ['שם מלא', 'שם מלא של הרוכב', 'שם ומשפחה'],
      english: [
         'full name', 'fullname', 'name', 'full',
         'rider name', 'athlete name', 'competitor name', 'competitor'
      ],
      priority: 7
   },
   {
      field: 'category',
      hebrew: [
         'קטגוריה', 'קט\'', 'קט.', 'קטגורייה',
         'שכבה', 'ענף', 'סוג', 'מחלקה'
      ],
      english: [
         'category', 'cat', 'cat.',
         'class', 'division', 'section', 'event class'
      ],
      priority: 9
   },
   {
      field: 'subCategory',
      hebrew: [
         'תת קטגוריה', 'תת-קטגוריה', 'תת קט\'', 'תת',
         'קבוצת גיל', 'שכבת גיל', 'גיל', 'טווח גיל',
         'קבוצה', 'תת מחלקה', 'תת ענף'
      ],
      english: [
         'sub category', 'subcategory', 'sub-category', 'sub cat',
         'sub', 'subcat',
         'age group', 'age range', 'age division', 'age class',
         'age bracket', 'age band',
         'sub class', 'subclass', 'sub-class',
         'group class', 'division class'
      ],
      priority: 8
   },
   {
      field: 'team',
      hebrew: [
         'קבוצה', 'קב\'', 'קב.',
         'מועדון', 'שם מועדון',
         'אגודה', 'שם אגודה',
         'צוות', 'שם קבוצה',
         'מועדון ספורט', 'קלוב', 'ע"ר'
      ],
      english: [
         'team', 'team name',
         'club', 'club name', 'club/team',
         'squad', 'organization', 'org', 'association',
         'society', 'sponsor'
      ],
      priority: 6
   },
   {
      field: 'gender',
      hebrew: ['מגדר', 'מין', 'זכר', 'נקבה', 'ז/נ'],
      english: ['gender', 'sex', 'male', 'female', 'm/f', 'g'],
      priority: 5
   },
   {
      field: 'heat',
      hebrew: [
         'גל', 'גל התחלה', 'גל פתיחה', 'גל מס\'',
         'מקצה', 'סבב', 'קבוצת התחלה', 'קבוצת פתיחה',
         'עלייה', 'שלב'
      ],
      english: [
         'wave', 'wave no', 'wave number', 'wave#', 'wave num',
         'heat', 'heat no', 'heat number', 'heat#',
         'flight', 'flight no',
         'start group', 'start wave', 'start heat', 'startgroup',
         'group no', 'group number'
      ],
      priority: 7
   },
   {
      field: 'startTime',
      hebrew: [
         'שעה', 'שעת התחלה', 'זמן התחלה',
         'זמן פתיחה', 'שעת פתיחה', 'זמן', 'שעת סטארט'
      ],
      english: [
         'time', 'start time', 'start hour', 'stime',
         'clock', 'hour', 'gun time', 'wave time'
      ],
      priority: 6
   },
   {
      field: 'totalLaps',
      hebrew: [
         'סבבים', 'הקפות', 'מספר סבבים', 'לאפים',
         'מספר הקפות', 'כמות סבבים', 'כמות הקפות'
      ],
      english: [
         'laps', 'total laps', 'lap count', 'nlaps', 'num laps',
         'rounds', 'total rounds', 'loops'
      ],
      priority: 5
   },
   {
      field: 'position',
      hebrew: [
         'מיקום', 'עמדה', 'מקום',
         'מיקום התחלה', 'עמדת התחלה', 'מיקום פתיחה'
      ],
      english: [
         'position', 'pos', 'place',
         'start pos', 'starting position', 'grid', 'grid pos'
      ],
      priority: 4
   },
   {
      field: 'points',
      hebrew: ['ניקוד', 'נקודות', 'ניקוד כולל', 'נקודות כולל'],
      english: ['points', 'score', 'pts', 'total points', 'ranking points'],
      priority: 5
   },
   {
      // UCI points — kept distinct from plain points. Keywords all require "UCI"
      // so a generic "points" column never lands here.
      field: 'uciPoints',
      hebrew: ['נקודות UCI', 'ניקוד UCI', 'נקודות יו סי איי'],
      english: ['uci points', 'uci pts', 'uci score', 'uci ranking points', 'points uci'],
      priority: 6
   },
   {
      field: 'federation',
      hebrew: ['איגוד', 'פדרציה', 'ארגון', 'אגודה'],
      english: ['federation', 'fed', 'org', 'organization', 'association', 'union'],
      priority: 5
   },
   {
      field: 'standing',
      hebrew: [
         'דירוג', 'דירוג כללי', 'ראנקינג', 'דירוג UCI', 'דירוג ישראלי',
         'מסד', 'מס״ד', 'מס"ד', 'מספר סידורי', 'סידורי', 'סדר'
      ],
      english: [
         'standing', 'ranking', 'rank', 'current rank', 'current ranking',
         'serial', 'serial no', 'index', 'order', 'seed', 'seeding'
      ],
      priority: 6
   },
   {
      field: 'raceDay',
      hebrew: [
         'יום', 'יום מרוץ', 'יום תחרות', 'יום אירוע',
         'שישי', 'שבת', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי',
         'תאריך', 'תאריך אירוע'
      ],
      english: [
         'day', 'race day', 'event day', 'day no', 'day number',
         'date', 'event date', 'day1', 'day2', 'd1', 'd2',
         'friday', 'saturday', 'sunday', 'monday'
      ],
      priority: 8
   }
];

/**
 * Fields that are recognised in a start list but deliberately NOT imported.
 *
 * Sub-categories were dropped in favour of one flat category per age band
 * ("Man Masters 30-39"), see BUGS.md #2. The keywords are kept in
 * FIELD_KEYWORDS on purpose: a "תת קטגוריה" column must still be absorbed by
 * this field, otherwise it fuzzy-matches "קטגוריה" and overwrites the real
 * category column. It is simply never written onto the rider.
 */
export const IGNORED_FIELDS = new Set<RiderFieldKey>(['subCategory']);

/**
 * Aliases that name a rider field only weakly — they are just as likely to head
 * a seeding/serial column ("מס'" = serial no.) as the real bib column.
 * Matches on these are capped so a specific header ("מספר רוכב", "bib") always
 * wins the field instead of losing it to whichever column came first.
 * See BUGS.md #3 — bib was being filled with the standing order.
 */
export const AMBIGUOUS_ALIASES = new Set<string>([
   'no', 'no.', 'num', 'number', '#', 'sno', 'sn',
   'מס', 'מס.', "מס'", 'מספר', 'רוכב'
]);

/**
 * Max confidence an ambiguous-alias match may claim. Deliberately above the
 * auto-map thresholds (60 keyword / 70 dictionary) so such a column is still
 * mapped when it's the only candidate, but below 85 so it is always surfaced
 * for user confirmation — and always loses to a specific header.
 */
export const AMBIGUOUS_ALIAS_CAP = 75;

/**
 * Headers that mean "row order / serial number". These are the pre-race
 * seeding order (standing), never the bib number.
 */
export const SEED_ORDER_ALIASES = new Set<string>([
   'מסד', 'מס״ד', 'מס"ד', 'מספר סידורי', 'סידורי', 'סדר', 'סד',
   'serial', 'serial no', 's/n', 'index', 'row', 'order', 'seed', 'seeding'
]);
