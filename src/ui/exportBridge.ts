/**
 * Thin adapter between the UI and src/export/*. Keeps the UI's call sites small and puts the
 * file-naming / WebP-capability decisions in one place.
 */
import { exportImage, slugify, suggestFileName, supportsWebpEncoding } from '../export/exporter';
import { renderTemplateDetailed, templateFileName } from '../export/templates';
import type {
  AnimationFormat,
  AnimationSettings,
  BackgroundSettings,
  ExportFormat,
  ExportSettings,
  ImageSlotDef,
  ParamValues,
  StageAPI,
} from '../core/types';
import {
  animationFileFilter,
  exportAnimation,
  mp4EncodingAvailable,
  type AnimationProgress,
  type AnimationResult,
} from '../export/animation';

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
  dpi: number,
  params: ParamValues,
): Promise<{ blob: Blob; name: string } | null> {
  const res = await renderTemplateDetailed(slot, dpi, params);
  if (!res) return null;
  const name = templateFileName(slot, res.dpi, params).replace(/^mockup-director-/, `mockup-director-${modelId}-`);
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

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */

/** Which animation formats this engine can produce (GIF always; WebP / MP4 depend on the engine). */
export function animationFormatSupport(): Record<AnimationFormat, boolean> {
  let mp4 = false;
  try {
    mp4 = mp4EncodingAvailable();
  } catch {
    mp4 = false;
  }
  return { gif: true, webp: webpEncodingSupported(), mp4 };
}

/** Render + encode the turntable animation. Rejects with AnimationCancelled when `signal` aborts. */
export function exportAnimationBlob(
  stage: StageAPI,
  settings: AnimationSettings,
  background: BackgroundSettings,
  onProgress: (p: AnimationProgress) => void,
  signal: AbortSignal,
): Promise<AnimationResult> {
  return exportAnimation(stage, settings, { background, webpSupported: webpEncodingSupported(), onProgress, signal });
}

/** Suggested animation file name, e.g. mockup-director-dvd-case-2026-11-04-1530.gif. */
export function animationFileName(modelId: string, format: AnimationFormat, date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  return `mockup-director-${slugify(modelId) || 'mockup'}-${stamp}.${format}`;
}

export { animationFileFilter };
export { isAnimationCancelled, type AnimationProgress } from '../export/animation';
export { extensionFor, mimeFor } from '../export/exporter';
