import type { Language } from '../types/voice.types';

/**
 * Number-word parsing for voice bib detection.
 *
 * The tricky part for a race commissaire: a single spoken bib can be several
 * words ("forty seven" / "עשרים ושלוש" = 47 / 23), but a quick list of bibs is
 * also several words ("one two three" / "אחד שתיים שלוש" = 1, 2, 3). So we can't
 * just sum every word. We classify each word and run a small compositional
 * parser that decides where one number ends and the next begins.
 */

type TokType = 'unit' | 'ten10' | 'tens' | 'hundred' | 'thousand';
interface NumWord { value: number; type: TokType; }

const u = (value: number): NumWord => ({ value, type: 'unit' });
const t = (value: number): NumWord => ({ value, type: 'tens' });
const ten10: NumWord = { value: 10, type: 'ten10' };
const hundred = (value: number): NumWord => ({ value, type: 'hundred' });
const thousand = (value: number): NumWord => ({ value, type: 'thousand' });

const ENGLISH_WORDS: Record<string, NumWord> = {
  zero: u(0), oh: u(0),
  one: u(1),
  two: u(2), to: u(2), too: u(2),
  three: u(3), tree: u(3),
  four: u(4), for: u(4),
  five: u(5),
  six: u(6),
  seven: u(7),
  eight: u(8), ate: u(8),
  nine: u(9),
  ten: u(10),
  eleven: u(11), twelve: u(12), thirteen: u(13), fourteen: u(14), fifteen: u(15),
  sixteen: u(16), seventeen: u(17), eighteen: u(18), nineteen: u(19),
  twenty: t(20), thirty: t(30), forty: t(40), fifty: t(50),
  sixty: t(60), seventy: t(70), eighty: t(80), ninety: t(90),
  hundred: hundred(100),
  thousand: thousand(1000),
};

// Hebrew has masculine + feminine forms plus common STT spelling variants.
// Feminine (used for abstract counting) and masculine both map to the digit.
const HEBREW_WORDS: Record<string, NumWord> = {
  אפס: u(0),
  אחת: u(1), אחד: u(1),
  שתיים: u(2), שתים: u(2), שניים: u(2), שנים: u(2), שתי: u(2), שני: u(2),
  שלוש: u(3), שלושה: u(3), שלש: u(3),
  ארבע: u(4), ארבעה: u(4),
  חמש: u(5), חמישה: u(5), חמשה: u(5),
  שש: u(6), שישה: u(6), ששה: u(6),
  שבע: u(7), שבעה: u(7),
  שמונה: u(8), שמונת: u(8),
  תשע: u(9), תשעה: u(9),
  // 10 — composes with a preceding unit to form the teens (אחת עשרה = 11)
  עשר: ten10, עשרה: ten10, עשרת: ten10,
  // tens
  עשרים: t(20),
  שלושים: t(30), שלשים: t(30),
  ארבעים: t(40),
  חמישים: t(50), חמשים: t(50),
  שישים: t(60), ששים: t(60),
  שבעים: t(70),
  שמונים: t(80),
  תשעים: t(90),
  // hundreds
  מאה: hundred(100), מאת: hundred(100), מאות: hundred(100),
  מאתיים: hundred(200), מאתים: hundred(200),
  // thousands
  אלף: thousand(1000), אלפים: thousand(1000), אלפי: thousand(1000),
  אלפיים: thousand(2000),
};

/** Strip a leading "and"/"the" connector (ו / ה) so "ושבע" matches "שבע". */
function lookupHebrew(word: string): NumWord | undefined {
  if (HEBREW_WORDS[word]) return HEBREW_WORDS[word];
  if ((word.startsWith('ו') || word.startsWith('ה')) && HEBREW_WORDS[word.slice(1)]) {
    return HEBREW_WORDS[word.slice(1)];
  }
  return undefined;
}

function classify(word: string, language: Language): NumWord | undefined {
  const clean = word.replace(/["'.,\-–]/g, '').trim();
  if (!clean) return undefined;
  return language === 'en' ? ENGLISH_WORDS[clean] : lookupHebrew(clean);
}

/**
 * Compositional word→numbers: builds one number at a time and starts a new one
 * at a boundary (e.g. a unit directly after another unit).
 *   "forty seven"        -> [47]        "one two three"      -> [1, 2, 3]
 *   "עשרים ושלוש"        -> [23]        "אחד שתיים שלוש"     -> [1, 2, 3]
 *   "מאה עשרים ושלוש"    -> [123]       "אחת עשרה"           -> [11]
 */
function wordsToNumbers(words: string[], language: Language): number[] {
  const out: number[] = [];
  let current = 0;
  let prevType: TokType | 'teen' | null = null;

  const flush = () => {
    if (current > 0 && current <= 9999) out.push(current);
    current = 0;
    prevType = null;
  };

  for (const raw of words) {
    const tok = classify(raw, language);
    if (!tok) continue; // ignore non-number words (including bare "ו"/"and")

    switch (tok.type) {
      case 'unit':
        // A unit right after another unit/teen means a new number began.
        if (prevType === 'unit' || prevType === 'teen') flush();
        current += tok.value;
        prevType = 'unit';
        break;

      case 'ten10': // the Hebrew "10" that forms teens
        if (prevType === 'unit') {
          current += 10;       // אחת + עשרה = 11
          prevType = 'teen';
        } else {
          flush();
          current = 10;        // bare עשר = 10
          prevType = 'teen';
        }
        break;

      case 'tens':
        if (prevType === 'unit' || prevType === 'teen' || prevType === 'tens') flush();
        current += tok.value;
        prevType = 'tens';
        break;

      case 'hundred':
        if (tok.value === 100) current = (current || 1) * 100; // שלוש מאות = 300
        else { flush(); current = tok.value; }                 // מאתיים = 200
        prevType = 'hundred';
        break;

      case 'thousand':
        if (tok.value === 1000) current = (current || 1) * 1000;
        else { flush(); current = tok.value; }                 // אלפיים = 2000
        if (current > 0 && current <= 9999) out.push(current);
        current = 0;
        prevType = null;
        break;
    }
  }

  flush();
  return out;
}

function tokenize(transcript: string): string[] {
  return transcript
    .replace(/[.,;!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function parseEnglishNumber(transcript: string): number | null {
  const nums = wordsToNumbers(tokenize(transcript), 'en');
  return nums.length > 0 ? nums[0] : null;
}

export function parseHebrewNumber(transcript: string): number | null {
  const nums = wordsToNumbers(tokenize(transcript), 'he');
  return nums.length > 0 ? nums[0] : null;
}

export function parseNumber(transcript: string, language: Language): number | null {
  if (!transcript) return null;
  const nums = wordsToNumbers(tokenize(transcript), language);
  return nums.length > 0 ? nums[0] : null;
}

export function extractNumbers(transcript: string, language: Language): number[] {
  if (!transcript) return [];

  // Mobile STT often returns digit strings ("47") instead of words. Try digit
  // extraction first — it's faster and more reliable when it applies.
  const digitMatches = transcript.match(/\b\d+\b/g);
  if (digitMatches) {
    const numbers: number[] = [];
    for (const m of digitMatches) {
      const n = parseInt(m, 10);
      if (n > 0 && n <= 9999) numbers.push(n);
    }
    if (numbers.length > 0) return numbers;
  }

  // Fallback: compositional word parsing (Hebrew/English spoken number words).
  return wordsToNumbers(tokenize(transcript), language);
}
