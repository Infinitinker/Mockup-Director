/**
 * The names the app suggests for the files it exports: still images, animations, the batch ZIP and
 * print templates, all starting with `mockup-director-`.
 */
import type { AnimationFormat, ExportFormat } from '../core/types/export';
import type { ImageSlotDef, ParamValues } from '../core/types/model';
import { round1 } from '../core/math';
import { resolveTemplate } from '../models/slots';
import { extensionFor } from './formats';

/** ASCII file-name slug. Polish letters are mapped by hand first (ł has no Unicode decomposition), other accents are stripped. */
export function slugify(s: string): string {
  const map: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  return s
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => map[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "2026-11-04-1530" in local time. */
function stamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

/**
 * Still image, e.g. "mockup-director-dvd-case-2026-11-04-1530.png" (local time).
 * @param date defaults to now
 */
export function suggestFileName(modelId: string, format: ExportFormat, date: Date = new Date()): string {
  return `mockup-director-${slugify(modelId) || 'mockup'}-${stamp(date)}.${extensionFor(format)}`;
}

/** Animation, e.g. "mockup-director-dvd-case-2026-11-04-1530.gif" (local time). */
export function animationFileName(modelId: string, format: AnimationFormat, date: Date = new Date()): string {
  return `mockup-director-${slugify(modelId) || 'mockup'}-${stamp(date)}.${format}`;
}

/** Batch archive, e.g. "mockup-director-batch-2026-11-05-1530.zip" (local time). */
export function zipFileName(date: Date = new Date()): string {
  return `mockup-director-batch-${stamp(date)}.zip`;
}

/**
 * Print template of a slot, e.g. "mockup-director-dvd-case-template-cover-273x183mm-300dpi.png": the
 * model id, the slot, the template size in mm (when the slot has a template) and the dpi it was rendered at.
 */
export function templateFileName(modelId: string, slot: ImageSlotDef, dpi: number, params: ParamValues): string {
  const tpl = resolveTemplate(slot, params);
  const size = tpl ? `-${round1(tpl.widthMm)}x${round1(tpl.heightMm)}mm` : '';
  return `mockup-director-${modelId}-template-${slugify(slot.label) || slot.id}${size}-${Math.round(dpi)}dpi.png`;
}
