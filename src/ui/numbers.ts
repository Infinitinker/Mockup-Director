/**
 * Numbers in the interface: formatting them for display with a decimal point, how many decimals a step
 * shows, and parsing what the user typed into a number field.
 */
import { clamp } from '../core/math';

/** Formats a number for display with `decimals` digits after the decimal point; never shows "-0". */
export function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '';
  const s = v.toFixed(decimals);
  return s === '-0' || /^-0\.0+$/.test(s) ? s.slice(1) : s;
}

/** The decimals a number field with this step shows (0 to 4); 0 for a step that is not positive. */
export function decimalsFor(step: number): number {
  if (!(step > 0)) return 0;
  // Decimals of the step as written (0.25 -> 2, 0.1 -> 1, 5 -> 0); guard float noise like 0.30000000000000004.
  const str = String(Number(step.toPrecision(6)));
  if (str.includes('e-')) return 4;
  return clamp((str.split('.')[1] ?? '').length, 0, 4);
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
