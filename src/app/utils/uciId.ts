/**
 * UCI ID: the 11-digit rider identifier issued by the UCI (optional). Stored in
 * rider.uciNumber. Imports and entry may contain spaces or dashes
 * ("100 123 456 78"); they are stripped. A value that is not 11 digits after
 * that is kept as typed (never lost) but reported as invalid.
 */
export function normalizeUciId(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[\s\-.]/g, "");
  return /^\d{11}$/.test(digits) ? digits : raw;
}

export const isValidUciId = (value: string | null | undefined): boolean => !value || /^\d{11}$/.test(value);
