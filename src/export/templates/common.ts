/**
 * What every part of a print template uses: the safe margin, the colors of the guides, the texts, the bleed clamped
 * to the artboard and millimeters as text.
 */
import type { PrintTemplate } from '../../core/types/model';
import { round1 } from '../../core/math';

/** Safe-area inset inside the trim line, mm. */
export const SAFE_MARGIN_MM = 3;

/** The colors of the guides, regions, labels and the hole. */
export const COLORS = {
  bleed: 'rgba(235, 70, 70, 0.16)',
  trim: '#d0182f',
  safe: '#2563eb',
  fold: '#0f9d6b',
  regionTints: ['rgba(70, 120, 230, 0.07)', 'rgba(40, 170, 120, 0.07)'],
  regionBorder: 'rgba(60, 70, 90, 0.35)',
  label: 'rgba(40, 48, 66, 0.55)',
  labelDim: 'rgba(40, 48, 66, 0.75)',
  nonPrint: 'rgba(110, 120, 140, 0.14)',
  hole: 'rgba(110, 120, 140, 0.30)',
  ink: '#1f2533',
};

/** The texts printed on a template, and the message when it cannot be drawn. */
export const TEXTS = {
  bleed: 'Bleed',
  trim: 'Trim',
  safe: 'Safe area',
  fold: 'Fold',
  foldLegend: 'Fold line',
  artboard: 'Artwork size',
  inclBleed: 'incl. bleed',
  hole: 'Hole',
  hub: 'Hub area (often unprinted)',
  reduced: 'reduced from',
  hint: 'Guide layer: hide it before export.',
  tooLarge: 'Not enough memory for a print template this large. Close other tabs and try again.',
};

/** The template's bleed, never negative and never more than half its shorter side minus 0.5 mm. */
export function clampBleed(tpl: PrintTemplate): number {
  // Never let the bleed swallow the whole artboard.
  const b = Math.min(tpl.bleedMm ?? 0, tpl.widthMm / 2 - 0.5, tpl.heightMm / 2 - 0.5);
  return Math.max(b, 0);
}

/** mm with at most 1 decimal. */
export function fmtMm(n: number): string {
  return String(round1(n));
}
