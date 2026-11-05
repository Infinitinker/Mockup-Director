/**
 * Thin adapter between the UI and src/export/*. Keeps the UI's call sites small and puts the
 * file-naming / WebP-capability decisions in one place.
 */
import { exportImage, suggestFileName, supportsWebpEncoding } from '../export/exporter';
import { renderTemplateDetailed, templateFileName } from '../export/templates';
import type { BackgroundSettings, ExportFormat, ExportSettings, ImageSlotDef, Lang, ParamValues, StageAPI } from '../core/types';

/** Render the final image. `background` = scene.background, so 'As preview' matches the viewport. */
export function exportBlob(stage: StageAPI, settings: ExportSettings, background: BackgroundSettings): Promise<Blob> {
  return exportImage(stage, settings, background);
}

/**
 * Render the print template of a slot (null when the slot has none). The file name carries the
 * model id, the template size in mm and the EFFECTIVE dpi (very large templates are rendered at a
 * reduced resolution, see renderTemplateDetailed).
 */
export async function templateBlob(
  modelId: string,
  slot: ImageSlotDef,
  lang: Lang,
  dpi: number,
  params: ParamValues,
): Promise<{ blob: Blob; name: string } | null> {
  const res = await renderTemplateDetailed(slot, lang, dpi, params);
  if (!res) return null;
  const name = templateFileName(slot, lang, res.dpi, params).replace(/^mockup-director-/, `mockup-director-${modelId}-`);
  return { blob: res.blob, name };
}

/** Suggested export file name, e.g. mockup-director-dvd-case-2026-11-04-1530.png. */
export function fileNameFor(modelId: string, format: ExportFormat): string {
  return suggestFileName(modelId, format);
}

let webpCache: boolean | null = null;
/** Can this engine encode WebP from a canvas? (Safari/WKWebView generally cannot.) Cached. */
export function webpEncodingSupported(): boolean {
  if (webpCache === null) {
    try {
      webpCache = supportsWebpEncoding();
    } catch {
      webpCache = false;
    }
  }
  return webpCache;
}

export { extensionFor, mimeFor } from '../export/exporter';
