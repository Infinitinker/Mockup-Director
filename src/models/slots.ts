/**
 * The app's side of a model's artwork slots: finding a slot by id, resolving its print template
 * from the parameters, and the artwork aspect ratios a slot expects.
 */
import type { ImageSlotDef, ModelDefinition, ParamValues, PrintTemplate } from '../core/types/model';
import { log } from '../platform/log';

/** The slot definition, or a neutral fallback for an unknown id (models may ask for any id). */
export function slotFor(model: ModelDefinition, slotId: string): ImageSlotDef {
  // The id stands in for the label.
  return model.slots.find((s) => s.id === slotId) ?? { id: slotId, label: slotId, aspect: 1 };
}

/**
 * The slot's print template, fixed or made from `params`; null when the slot has none or the
 * template has no area. A template function that throws is a model bug: the error reaches the caller.
 */
export function resolveTemplate(slot: ImageSlotDef, params: ParamValues): PrintTemplate | null {
  const t = slot.template;
  if (!t) return null;
  const r = typeof t === 'function' ? t(params) : t;
  if (!r || !(r.widthMm > 0) || !(r.heightMm > 0)) return null;
  return r;
}

/**
 * Acceptable artwork aspect ratios for a slot: the slot's aspect and (if any) the full template incl. bleed.
 * They only feed a hint, so a template that throws is logged and the slot counts as having none.
 */
export function expectedAspects(slot: ImageSlotDef, params: ParamValues): number[] {
  if (slot.anyAspect) return [];
  const list: number[] = [];
  if (slot.aspect > 0 && Number.isFinite(slot.aspect)) list.push(slot.aspect);
  let t: PrintTemplate | null = null;
  try {
    t = resolveTemplate(slot, params);
  } catch (e) {
    log.warn(`The print template of the slot ${slot.id} could not be made`, e);
  }
  if (t) {
    list.push(t.widthMm / t.heightMm);
    // Template without bleed (artwork delivered trimmed) is also fine.
    const b = t.bleedMm ?? 0;
    if (b > 0 && t.widthMm > 2 * b && t.heightMm > 2 * b) list.push((t.widthMm - 2 * b) / (t.heightMm - 2 * b));
  }
  return list;
}

export const ASPECT_TOLERANCE = 0.03;

/** True when the image's aspect differs from every acceptable aspect by more than 3 %. */
export function aspectMismatch(width: number, height: number, expected: number[]): boolean {
  if (!(width > 0 && height > 0) || expected.length === 0) return false;
  const a = width / height;
  return expected.every((e) => Math.abs(a / e - 1) > ASPECT_TOLERANCE);
}
