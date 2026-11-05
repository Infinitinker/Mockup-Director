/**
 * Helpers around ModelDefinition used by the UI: parameter validation/completion,
 * template resolution and aspect-ratio checks.
 */
import type { ImageSlotDef, ModelDefinition, ParamDef, ParamValue, ParamValues, PrintTemplate } from '../core/types';
import { defaultParams } from '../core/defaults';

const HEX = /^#[0-9a-f]{6}$/i;

/** Validate one param value against its definition. Returns undefined when invalid. */
export function sanitizeParam(def: ParamDef, v: unknown): ParamValue | undefined {
  switch (def.type) {
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return Math.min(def.max, Math.max(def.min, v));
    }
    case 'boolean':
      return typeof v === 'boolean' ? v : undefined;
    case 'select':
      return typeof v === 'string' && def.options.some((o) => o.value === v) ? v : undefined;
    case 'color':
      return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined;
  }
}

/** Defaults overlaid with every valid stored value – always complete. */
export function completeParams(model: ModelDefinition, stored: ParamValues | undefined): ParamValues {
  const out = defaultParams(model);
  if (!stored) return out;
  for (const def of model.params) {
    const v = sanitizeParam(def, stored[def.id]);
    if (v !== undefined) out[def.id] = v;
  }
  return out;
}

/** The slot definition, or a neutral fallback for an unknown id (models may ask for any id). */
export function slotFor(model: ModelDefinition, slotId: string): ImageSlotDef {
  return model.slots.find((s) => s.id === slotId) ?? { id: slotId, label: { pl: slotId, en: slotId }, aspect: 1 };
}

export function resolveTemplate(slot: ImageSlotDef, params: ParamValues): PrintTemplate | null {
  const t = slot.template;
  if (!t) return null;
  try {
    const r = typeof t === 'function' ? t(params) : t;
    if (!r || !(r.widthMm > 0) || !(r.heightMm > 0)) return null;
    return r;
  } catch {
    return null;
  }
}

/** Acceptable artwork aspect ratios for a slot: the slot's aspect and (if any) the full template incl. bleed. */
export function expectedAspects(slot: ImageSlotDef, params: ParamValues): number[] {
  const list: number[] = [];
  if (slot.aspect > 0 && Number.isFinite(slot.aspect)) list.push(slot.aspect);
  const t = resolveTemplate(slot, params);
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

/** Snap to the step grid without floating point noise (0.1 + 0.2 ...). */
export function snapToStep(v: number, step: number, min: number, max: number): number {
  if (!(step > 0)) return Math.min(max, Math.max(min, v));
  const dec = (n: number) => {
    const str = String(n);
    if (str.includes('e-')) return 6;
    return (str.split('.')[1] ?? '').length;
  };
  const decimals = Math.min(6, Math.max(dec(step), dec(min)));
  const snapped = Number((Math.round((v - min) / step) * step + min).toFixed(decimals));
  return Math.min(max, Math.max(min, snapped));
}
