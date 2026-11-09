/**
 * Final image export.
 *
 * Pipeline:
 *  1. Render the stage TRANSPARENTLY at a supersampled size (≈2× the target content box,
 *     capped at 8192 px per side and ~48 MP for WebKit's canvas memory budget).
 *  2. Find the composition's bounding box from the alpha channel (shadow and reflection pixels
 *     count as content, anything with alpha > 5/255).
 *  3. Crop, then scale to fit (width − 2·margin) × (height − 2·margin) with a multi-step
 *     high-quality downscale (no aliasing on thin edges / text).
 *  4. Paint the background ourselves (transparent / solid / gradient / white for JPEG) and
 *     composite the content over it – so the background always fills the whole output.
 *  5. Encode and embed the print resolution (PNG pHYs / JPEG JFIF density, 300 dpi).
 */
import type { BackgroundSettings, ExportFormat, ExportSettings, StageAPI } from '../core/types';
import { DEFAULT_EXPORT, MAX_EXPORT_SIZE } from '../core/defaults';
import { clampInt, findAlphaBounds, fitInside, supersampleSize, type PixelRect } from './layout';
import { isJpeg, isPng, setJpegDensity, setPngPhys } from './png';
import { paintBackground as paintSceneBackground } from '../scene/background';

/** Print resolution written into exported files (Photoshop shows a sensible print size). */
const EXPORT_DPI = 300;
/** Supersampling factor relative to the target content size. */
const SUPERSAMPLE = 2;
/** Longest side of the off-screen render (the stage may clamp further to the GPU limit). */
const MAX_RENDER_SIDE = 8192;
const MAX_RENDER_PIXELS = 48_000_000;
/**
 * Pixels with alpha above this (0..255) are treated as part of the composition when cropping.
 * 5/255 ≈ 2 % opacity – invisible on any background, but it keeps the faint far tails of the soft
 * shadow and reflection from inflating the crop box (which made 'trim' margins look uneven).
 * Pixels below the threshold are NOT removed from the image; only the crop box changes.
 */
const ALPHA_THRESHOLD = 5;

type ExportErrorCode = 'webp-unsupported' | 'encode-failed' | 'render-failed';

/** Export failure with a message that can be shown to the user. */
class ExportError extends Error {
  readonly code: ExportErrorCode;
  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

/**
 * Render the current stage according to the export settings and encode it.
 *
 * @param background The scene's preview background (SceneSettings.background), painted when
 *   settings.background === 'scene'.
 * @throws ExportError ('webp-unsupported' when WebP can't be encoded – see supportsWebpEncoding()).
 */
export async function exportImage(
  stage: StageAPI,
  settings: ExportSettings,
  background: BackgroundSettings,
): Promise<Blob> {
  const s = normalizeSettings(settings);
  const format = s.format;
  if (format === 'webp' && !supportsWebpEncoding()) throw webpError();
  const opaque = format === 'jpeg';

  // --- 1. supersampled transparent render --------------------------------------------------
  const availW = Math.max(1, s.width - 2 * s.margin);
  const availH = Math.max(1, s.height - 2 * s.margin);
  const req = supersampleSize(availW, availH, SUPERSAMPLE, MAX_RENDER_SIDE, MAX_RENDER_PIXELS);
  const src = stage.renderToCanvas({ width: req.width, height: req.height, transparent: true });
  const rw = src.width;
  const rh = src.height;
  if (!rw || !rh) {
    throw new ExportError(
      'render-failed',
      'The image could not be rendered: there may not be enough graphics memory. Reduce the export size.',
    );
  }

  // --- 2. content bounds from alpha --------------------------------------------------------
  const crop = measureContent(src) ?? { x: 0, y: 0, w: rw, h: rh };

  // --- 3. crop + scale --------------------------------------------------------------------
  const fit = fitInside(crop.w, crop.h, availW, availH);
  const content = resampleRegion(src, crop, fit.width, fit.height);

  const outW = s.sizing === 'canvas' ? s.width : fit.width + 2 * s.margin;
  const outH = s.sizing === 'canvas' ? s.height : fit.height + 2 * s.margin;
  const ox = s.sizing === 'canvas' ? Math.round((outW - fit.width) / 2) : s.margin;
  const oy = s.sizing === 'canvas' ? Math.round((outH - fit.height) / 2) : s.margin;

  // --- 4. background + composite -----------------------------------------------------------
  const out = createCanvas(outW, outH);
  const g = get2d(out);
  if (s.background === 'scene') {
    paintBackground(g, background, outW, outH, opaque);
  } else if (opaque) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, outW, outH);
  }
  g.drawImage(content, ox, oy);
  releaseCanvas(content);

  // --- 5. encode ----------------------------------------------------------------------------
  const mime = mimeFor(format);
  let blob = await canvasToBlob(out, mime, format === 'png' ? undefined : s.quality);
  releaseCanvas(out);
  if (blob.type && blob.type !== mime) {
    // Engines fall back to PNG silently for unsupported types (Safari + WebP).
    if (format === 'webp') throw webpError();
    throw new ExportError(
      'encode-failed',
      `The image could not be encoded as ${format.toUpperCase()}. Choose another format.`,
    );
  }
  if (format === 'png') blob = await setPngDpi(blob, EXPORT_DPI);
  else if (format === 'jpeg') blob = await setJpegDpi(blob, EXPORT_DPI);
  return blob;
}

export function extensionFor(format: ExportFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

function mimeFor(format: ExportFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

let webpSupport: boolean | null = null;
/** What the user sees when this engine cannot encode a WebP image. */
export const WEBP_IMAGE_UNSUPPORTED = 'This system cannot encode WebP images. Choose PNG or JPEG.';

/**
 * Can this engine ENCODE WebP from a canvas? (Chrome/Edge/Firefox: yes; Safari / WKWebView: no –
 * toBlob silently returns PNG.) The UI should hide or disable the WebP option when false.
 */
export function supportsWebpEncoding(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = createCanvas(2, 2);
    webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/** Return a PNG blob with a pHYs chunk set to `dpi`. Non-PNG input is returned unchanged. */
export async function setPngDpi(blob: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isPng(bytes)) return blob;
  try {
    return new Blob([setPngPhys(bytes, dpi)], { type: 'image/png' });
  } catch {
    return blob; // malformed – keep the original rather than failing the export
  }
}

/** Return a JPEG blob whose JFIF density is `dpi`. Non-JPEG input is returned unchanged. */
async function setJpegDpi(blob: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isJpeg(bytes)) return blob;
  return new Blob([setJpegDensity(bytes, dpi)], { type: 'image/jpeg' });
}

/**
 * File name like "mockup-director-dvd-case-2026-11-04-1530.png" (local time).
 * @param date defaults to now
 */
export function suggestFileName(modelId: string, format: ExportFormat, date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  return `mockup-director-${slugify(modelId) || 'mockup'}-${stamp}.${extensionFor(format)}`;
}

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

/**
 * Paint the scene background over the whole canvas.
 *  - 'color'    → solid `color`
 *  - 'gradient' → the SAME radial gradient as the on-screen preview (`color` in the center,
 *                 slightly above the middle → `color2` at the corners); delegated to
 *                 scene/background.ts so preview and export can never drift apart
 *  - 'transparent' → nothing (or white when `opaque`, e.g. for JPEG)
 */
export function paintBackground(
  g: CanvasRenderingContext2D,
  bg: BackgroundSettings,
  width: number,
  height: number,
  opaque = false,
): void {
  if (bg.mode === 'transparent') {
    if (!opaque) return;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    return;
  }
  paintSceneBackground(g, width, height, bg);
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

function normalizeSettings(s: ExportSettings): ExportSettings {
  const width = clampInt(s.width, 1, MAX_EXPORT_SIZE, DEFAULT_EXPORT.width);
  const height = clampInt(s.height, 1, MAX_EXPORT_SIZE, DEFAULT_EXPORT.height);
  // Margin: never more than leaves a 1 px content box.
  const maxMargin = Math.max(0, Math.floor((Math.min(width, height) - 1) / 2));
  const margin = clampInt(s.margin, 0, maxMargin, Math.min(DEFAULT_EXPORT.margin, maxMargin));
  const q = typeof s.quality === 'number' && Number.isFinite(s.quality) ? s.quality : DEFAULT_EXPORT.quality;
  const format: ExportFormat = s.format === 'jpeg' || s.format === 'webp' ? s.format : 'png';
  return {
    width,
    height,
    margin,
    format,
    quality: Math.max(0.05, Math.min(1, q)),
    sizing: s.sizing === 'canvas' ? 'canvas' : 'trim',
    background: s.background === 'scene' ? 'scene' : 'transparent',
  };
}

function webpError(): ExportError {
  return new ExportError('webp-unsupported', WEBP_IMAGE_UNSUPPORTED);
}

function measureContent(src: HTMLCanvasElement): PixelRect | null {
  const g = src.getContext('2d');
  if (!g) return null;
  const data = g.getImageData(0, 0, src.width, src.height).data;
  return findAlphaBounds(data, src.width, src.height, ALPHA_THRESHOLD);
}

/**
 * Copy `rect` of `src` into a new dw×dh canvas. Downscales by repeated halving (each step with
 * high-quality smoothing) until within 2× of the target – avoids the aliasing of a single large
 * bilinear reduction. Upscaling is a single high-quality draw.
 */
function resampleRegion(src: CanvasImageSource, rect: PixelRect, dw: number, dh: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  let sx = rect.x;
  let sy = rect.y;
  let cw = rect.w;
  let ch = rect.h;
  let prev: HTMLCanvasElement | null = null;
  while (cw >= dw * 2 || ch >= dh * 2) {
    const nw = Math.max(dw, Math.ceil(cw / 2));
    const nh = Math.max(dh, Math.ceil(ch / 2));
    if (nw === cw && nh === ch) break;
    const c = createCanvas(nw, nh);
    const g = get2d(c);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, sx, sy, cw, ch, 0, 0, nw, nh);
    if (prev) releaseCanvas(prev);
    prev = c;
    cur = c;
    sx = 0;
    sy = 0;
    cw = nw;
    ch = nh;
  }
  const out = createCanvas(dw, dh);
  const g = get2d(out);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, sx, sy, cw, ch, 0, 0, dw, dh);
  if (prev) releaseCanvas(prev);
  return out;
}

function canvasToBlob(c: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (b) => {
        if (b) resolve(b);
        else {
          reject(
            new ExportError(
              'encode-failed',
              'The image could not be encoded: there may not be enough memory. Reduce the export size.',
            ),
          );
        }
      },
      mime,
      quality,
    );
  });
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) {
    throw new ExportError('render-failed', 'Not enough memory for an image this large. Reduce the export size.');
  }
  return g;
}

/** Free a temporary canvas' backing store immediately (WebKit has a global canvas memory cap). */
function releaseCanvas(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}
