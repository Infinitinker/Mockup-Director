/**
 * The screen slot of the screenshot panel and the browser window, which takes artwork of any aspect
 * ratio, and the aspect the panel is built for. The panel height follows the artwork's aspect ratio
 * (falls back to 16:10 without artwork), so no print template is offered – the artwork itself
 * defines the size.
 */
import type { ImageSlotDef, ModelContext } from '../../../core/types/model';
import { clamp } from '../../../core/math';

/** Default content aspect (width / height) without an image. */
export const DEFAULT_ASPECT = 16 / 10;

/** Aspect ratio of the user's image in a slot (the placeholder / missing image -> fallback). */
export function imageAspect(ctx: ModelContext, slotId: string, fallback: number): number {
  if (!ctx.hasArtwork(slotId)) return fallback;
  const img = ctx.getTexture(slotId).image as
    | { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
    | null
    | undefined;
  const w = img?.naturalWidth || img?.width || 0;
  const h = img?.naturalHeight || img?.height || 0;
  return w > 0 && h > 0 ? clamp(w / h, 0.1, 10) : fallback;
}

/**
 * 'screen' accepts ANY aspect ratio – the panel height follows the image. `aspect` (16:10) is only
 * the placeholder shape used without an image.
 */
export function screenSlot(hint: string): ImageSlotDef {
  return {
    id: 'screen',
    label: 'Screen',
    hint,
    aspect: DEFAULT_ASPECT,
    anyAspect: true,
  };
}
