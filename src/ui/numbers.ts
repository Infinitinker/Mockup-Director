/**
 * Numbers in the interface: formatting them for display with a decimal point, and parsing what the
 * user typed into a number field.
 */

/** Formats a number for display with `decimals` digits after the decimal point; never shows "-0". */
export function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '';
  const s = v.toFixed(decimals);
  return s === '-0' || /^-0\.0+$/.test(s) ? s.slice(1) : s;
}

/** Parses a typed number: accepts both "1,5" and "1.5", ignores spaces and a trailing unit. */
export function parseNumber(s: string): number | null {
  const cleaned = s
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^0-9.eE+-]+$/, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
