/**
 * Renders a slot's print template as a PNG at the requested resolution, lowering it when the engine refuses a canvas
 * that large, and records the resolution in the file, so an image editor opens it at the right print size.
 */
import type { ImageSlotDef, ParamValues, PrintTemplate } from '../../core/types/model';
import { UserError } from '../../core/errors';
import { resolveTemplate } from '../../models/slots';
import { setPngDpi } from '../exporter';
import { TEXTS } from './common';
import { Draw } from './draw';
import { drawRectTemplate } from './rect';
import { drawCircleTemplate } from './circle';
import { drawLegend } from './legend';

/** Pixel limits for the template canvas (WebKit canvas memory budget). */
const MAX_SIDE_PX = 12000;
const MAX_PIXELS = 60_000_000;

interface TemplateRenderResult {
  blob: Blob;
  /** Effective resolution (may be lower than requested for very large templates). */
  dpi: number;
  requestedDpi: number;
  widthPx: number;
  heightPx: number;
  template: PrintTemplate;
}

/**
 * Renders a print template PNG (guides, regions, bleed) for a slot and reports the effective dpi and
 * pixel size; null if the slot has no template. A template function that throws reaches the caller.
 * @param params current model params – needed when slot.template is a function of them.
 */
export async function renderTemplateDetailed(
  slot: ImageSlotDef,
  dpi: number,
  params: ParamValues,
): Promise<TemplateRenderResult | null> {
  const tpl = resolveTemplate(slot, params);
  if (!tpl) return null;
  const requested = Math.max(10, Math.min(2400, Number.isFinite(dpi) ? dpi : 300));
  let eff = Math.floor(effectiveDpi(tpl, requested));

  // Retry with a lower resolution if the engine refuses a canvas this big.
  for (let attempt = 0; attempt < 4; attempt++) {
    const k = eff / 25.4;
    const w = Math.max(1, Math.round(tpl.widthMm * k));
    const h = Math.max(1, Math.round(tpl.heightMm * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (g && canvas.width === w) {
      drawTemplate(g, tpl, slot, k, eff, requested, w, h);
      const raw = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      canvas.width = 0;
      canvas.height = 0;
      if (raw) {
        const blob = await setPngDpi(raw, eff);
        return { blob, dpi: eff, requestedDpi: requested, widthPx: w, heightPx: h, template: tpl };
      }
    }
    eff = Math.max(30, Math.floor(eff * 0.7));
  }
  throw new UserError(TEXTS.tooLarge);
}

/** Highest dpi ≤ requested that keeps the canvas within MAX_SIDE_PX and MAX_PIXELS. */
function effectiveDpi(tpl: PrintTemplate, requested: number): number {
  const bySide = (MAX_SIDE_PX * 25.4) / Math.max(tpl.widthMm, tpl.heightMm);
  const byArea = Math.sqrt(MAX_PIXELS / (tpl.widthMm * tpl.heightMm)) * 25.4;
  return Math.max(1, Math.min(requested, bySide, byArea));
}

/** Draws the template on a white canvas: the round or rectangular template, then the legend. */
function drawTemplate(
  g: CanvasRenderingContext2D,
  tpl: PrintTemplate,
  slot: ImageSlotDef,
  k: number,
  dpi: number,
  requestedDpi: number,
  wPx: number,
  hPx: number,
): void {
  const d = new Draw(g, k);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, wPx, hPx);
  if (tpl.circle) drawCircleTemplate(d, tpl, tpl.circle, slot);
  else drawRectTemplate(d, tpl, slot);
  drawLegend(d, tpl, slot, dpi, requestedDpi, wPx, hPx);
}
