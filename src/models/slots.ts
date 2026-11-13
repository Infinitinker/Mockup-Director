/**
 * The app's side of a model's artwork slots: finding a slot by id, resolving its print template
 * from the parameters, the artwork aspect ratios a slot expects, and the texture a model gets for a
 * slot, cropped to it when the artwork does not fit.
 */
import type * as THREE from 'three';
import type { ImageSlotDef, ModelDefinition, ParamValues, PrintTemplate } from '../core/types/model';
import type { Artwork } from '../core/types/project';
import { croppedTexture } from '../core/images';
import { getPlaceholderTexture } from '../core/placeholder';
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
  const t = templateOrNull(slot, params);
  if (t) {
    list.push(t.widthMm / t.heightMm);
    // Template without bleed (artwork delivered trimmed) is also fine.
    const b = t.bleedMm ?? 0;
    if (b > 0 && t.widthMm > 2 * b && t.heightMm > 2 * b) list.push((t.widthMm - 2 * b) / (t.heightMm - 2 * b));
  }
  return list;
}

/** The slot's print template, or null when it has none or it throws (logged: it only shapes artwork, never stops a build). */
function templateOrNull(slot: ImageSlotDef, params: ParamValues): PrintTemplate | null {
  try {
    return resolveTemplate(slot, params);
  } catch (e) {
    log.warn(`The print template of the slot ${slot.id} could not be made`, e);
    return null;
  }
}

export const ASPECT_TOLERANCE = 0.03;

/** True when the image's aspect differs from every acceptable aspect by more than 3 %. */
export function aspectMismatch(width: number, height: number, expected: number[]): boolean {
  if (!(width > 0 && height > 0) || expected.length === 0) return false;
  const a = width / height;
  return expected.every((e) => Math.abs(a / e - 1) > ASPECT_TOLERANCE);
}

/**
 * The aspect ratio artwork of `width` × `height` is cropped to, or null when the model gets it as it is: when it
 * fits the slot (aspectMismatch), when the slot takes any aspect ratio, or when the model fits artwork itself. It
 * is the full print template at `params`, with its bleed, or else the slot's aspect.
 */
export function cropAspect(slot: ImageSlotDef, params: ParamValues, width: number, height: number): number | null {
  if (slot.anyAspect || slot.fitsArtwork) return null;
  if (!aspectMismatch(width, height, expectedAspects(slot, params))) return null;
  const t = templateOrNull(slot, params);
  const aspect = t ? t.widthMm / t.heightMm : slot.aspect;
  return aspect > 0 && Number.isFinite(aspect) ? aspect : null;
}

/**
 * The texture a model gets for a slot: its artwork, cropped from the center when it does not fit the slot
 * (cropAspect), or the slot's placeholder.
 */
export function slotTexture(
  model: ModelDefinition,
  params: ParamValues,
  artwork: Record<string, Artwork>,
  slotId: string,
): THREE.Texture {
  const slot = slotFor(model, slotId);
  const art = artwork[slotId];
  if (!art) return getPlaceholderTexture(slot);
  const aspect = cropAspect(slot, params, art.width, art.height);
  return aspect === null ? art.texture : croppedTexture(art, aspect);
}
