import type { Language } from '../types/voice.types';

const ENGLISH_ONES: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  to: 2,
  three: 3,
  tree: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const ENGLISH_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const ENGLISH_SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1000,
  million: 1000000,
};

const HEBREW_ONES: Record<string, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
};

const HEBREW_TENS: Record<string, number> = {};

const HEBREW_SCALES: Record<string, number> = {};

export function parseEnglishNumber(transcript: string): number | null {
  const words = transcript
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 0);

  if (words.length === 0) return null;

  let result = 0;
  let current = 0;

  for (const word of words) {
    if (word in ENGLISH_ONES) {
      current += ENGLISH_ONES[word];
    } else if (word in ENGLISH_TENS) {
      current += ENGLISH_TENS[word];
    } else if (word in ENGLISH_SCALES) {
      const scale = ENGLISH_SCALES[word];
      if (scale === 100) {
        current *= 100;
      } else {
        current *= scale;
        result += current;
        current = 0;
      }
    }
  }

  result += current;
  return result > 0 && result <= 9999 ? result : null;
}

export function parseHebrewNumber(transcript: string): number | null {
  const text = transcript.trim();

  if (text in HEBREW_ONES) {
    const val = HEBREW_ONES[text];
    return val <= 9999 ? val : null;
  }

  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return null;

  let result = 0;
  let current = 0;

  for (const word of words) {
    if (word in HEBREW_ONES) {
      current += HEBREW_ONES[word];
    } else if (word in HEBREW_TENS) {
      current += HEBREW_TENS[word];
    } else if (word in HEBREW_SCALES) {
      const scale = HEBREW_SCALES[word];
      if (scale === 100) {
        current *= 100;
      } else {
        current *= scale;
        result += current;
        current = 0;
      }
    } else if (word === 'ו' || word === 'ה' || word === 'וה') {
      continue;
    }
  }

  result += current;
  return result > 0 && result <= 9999 ? result : null;
}

export function parseNumber(transcript: string, language: Language): number | null {
  if (!transcript) return null;

  if (language === 'en') {
    return parseEnglishNumber(transcript);
  } else {
    return parseHebrewNumber(transcript);
  }
}

export function extractNumbers(transcript: string, language: Language): number[] {
  // Mobile STT often returns digit strings ("47") instead of words ("forty seven").
  // Try digit extraction first — it's faster and more reliable.
  const digitMatches = transcript.match(/\b\d+\b/g);
  if (digitMatches) {
    const numbers: number[] = [];
    for (const m of digitMatches) {
      const n = parseInt(m, 10);
      if (n > 0 && n <= 9999) numbers.push(n);
    }
    if (numbers.length > 0) return numbers;
  }

  // Fallback: word-based parsing (desktop English / Hebrew word numbers)
  const numbers: number[] = [];
  const sentences = transcript.split(/[.,;!?]+/);
  for (const sentence of sentences) {
    const num = parseNumber(sentence.trim(), language);
    if (num !== null) numbers.push(num);
  }
  return numbers;
}
