/**
 * Image decoding for user artwork.
 *
 * Design notes:
 *  - The ORIGINAL file is kept as a data URL (project files store it verbatim, no re-encoding).
 *  - Pixels for the GPU are always baked into a 2D canvas first, and the texture is a
 *    CanvasTexture with flipY = true (three's default). This gives ONE well-defined orientation
 *    path for every decoder: ImageBitmap ignores UNPACK_FLIP_Y in WebGL, so uploading a bitmap
 *    directly would render upside-down; drawing it into a canvas avoids that trap.
 *  - EXIF orientation (JPEG): JPEGs are decoded through HTMLImageElement, which applies EXIF
 *    orientation in every supported engine (Safari ≥ 13.1, Chrome ≥ 81, Firefox ≥ 77), and
 *    drawImage() of such an image paints it upright. ImageBitmap's EXIF behavior differed
 *    between engines/versions, so it is only used for non-JPEG rasters (off-main-thread decode).
 *  - SVG is rasterized through HTMLImageElement at a generous size (vector = free quality).
 *  - GPU copies are downscaled so the longest side is ≤ 4096 px (high-quality step-down).
 */
import * as THREE from 'three';
import type { Artwork } from './types';

/** Longest side of the GPU texture. Originals stay untouched in the data URL. */
const MAX_TEXTURE_SIZE = 4096;
/** SVGs are rasterized so their longest side is this many px (unless that exceeds the texture cap). */
const SVG_RASTER_SIZE = 3072;

/** Error with a message that can be shown to the user. */
class ImageLoadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ImageLoadError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** File extensions / MIME types we try to decode (the engine decides what actually works). */
export const IMAGE_ACCEPT = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.heic,.heif,.bmp,.tif,.tiff';

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Decode an image File into an Artwork (sRGB texture, keeps the data URL). */
export async function loadImageFile(file: File): Promise<Artwork> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    throw new ImageLoadError(
      `The file “${file.name}” could not be read. Check that it still exists and can be opened, then add it again.`,
      err,
    );
  }
  const mime = sniffMime(bytes, file.type, file.name);
  const blob = new Blob([bytes], { type: mime });
  const dataUrl = await blobToDataUrl(blob);
  return decodeToAsset(blob, mime, dataUrl, file.name);
}

/** Recreate an Artwork from a data URL (project loading). */
export async function loadImageDataUrl(dataUrl: string, name: string): Promise<Artwork> {
  // Decoded manually instead of fetch(dataUrl): a strict CSP (connect-src) may block fetching data: URLs.
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new ImageLoadError(`The artwork “${name}” in the project is damaged. Add the artwork again.`);
  }
  const mime = sniffMime(parsed.bytes, parsed.mime, name);
  const blob = new Blob([parsed.bytes], { type: mime });
  return decodeToAsset(blob, mime, dataUrl, name);
}

export function disposeArtwork(asset: Artwork): void {
  const img = asset.texture.image as unknown;
  asset.texture.dispose();
  // WebKit has a global canvas-memory budget; shrinking the canvas frees its backing store now.
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
    img.width = 0;
    img.height = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

async function decodeToAsset(blob: Blob, mime: string, dataUrl: string, name: string): Promise<Artwork> {
  let canvas: HTMLCanvasElement;
  try {
    if (mime === 'image/svg+xml') canvas = await rasterizeSvg(blob);
    else canvas = await decodeRaster(blob, mime);
  } catch (err) {
    if (err instanceof ImageLoadError) throw err;
    throw new ImageLoadError(
      `The file “${name}” could not be read as an image. Choose a PNG, JPEG, WebP, GIF or SVG file.`,
      err,
    );
  }
  return {
    name,
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    texture: makeTexture(canvas),
  };
}

/** Raster formats: ImageBitmap (non-JPEG) with HTMLImageElement fallback, baked into a canvas. */
async function decodeRaster(blob: Blob, mime: string): Promise<HTMLCanvasElement> {
  if (mime !== 'image/jpeg' && typeof createImageBitmap === 'function') {
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await createImageBitmap(blob);
    } catch {
      bmp = null; // e.g. Safari < 15 or a format the bitmap decoder lacks – fall back below
    }
    if (bmp && bmp.width > 0 && bmp.height > 0) {
      try {
        return drawToCanvas(bmp, bmp.width, bmp.height);
      } finally {
        bmp.close();
      }
    }
    bmp?.close();
  }
  const img = await loadHtmlImage(blob);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('Image has no size');
  return drawToCanvas(img, w, h);
}

/** SVG: rasterize via <img>. Sizes come from the SVG itself (width/height or viewBox). */
async function rasterizeSvg(blob: Blob): Promise<HTMLCanvasElement> {
  const text = await blob.text();
  const intrinsic = svgIntrinsicSize(text);
  const w = intrinsic?.width ?? 1024;
  const h = intrinsic?.height ?? 1024;
  const scale = SVG_RASTER_SIZE / Math.max(w, h);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  // Give the root element an explicit pixel size (and a viewBox so the content scales with it):
  // size-less SVGs otherwise get 300×150 / 0×0 or refuse to draw in some engines.
  const sized = sizeSvgRoot(text, tw, th, w, h);
  const img = await loadHtmlImage(new Blob([sized], { type: 'image/svg+xml' }));
  const canvas = createCanvas(tw, th);
  const g = get2d(canvas);
  g.drawImage(img, 0, 0, tw, th);
  return canvas;
}

/** Draw a decoded source into a canvas, downscaling to MAX_TEXTURE_SIZE with a step-down filter. */
function drawToCanvas(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const s = Math.min(1, MAX_TEXTURE_SIZE / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s));
  const th = Math.max(1, Math.round(h * s));
  let cur: CanvasImageSource = src;
  let cw = w;
  let ch = h;
  const temps: HTMLCanvasElement[] = [];
  // Halve until within 2× of the target – a single big downscale aliases badly in some engines.
  while (cw > tw * 2 || ch > th * 2) {
    const nw = Math.max(tw, Math.ceil(cw / 2));
    const nh = Math.max(th, Math.ceil(ch / 2));
    const c = createCanvas(nw, nh);
    const g = get2d(c);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    temps.push(c);
    cur = c;
    cw = nw;
    ch = nh;
  }
  const out = createCanvas(tw, th);
  const g = get2d(out);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th);
  for (const t of temps) {
    t.width = 0;
    t.height = 0;
  }
  return out;
}

function makeTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true; // canvas source → flipY honored (v = 0 is the image bottom)
  tex.anisotropy = 16; // three clamps to the GPU maximum
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function loadHtmlImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    const done = () => URL.revokeObjectURL(url);
    img.onload = () => {
      // decode() guarantees the pixels are ready before drawImage (avoids blank first draws in WebKit).
      const ready = typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve();
      ready.then(() => {
        done();
        resolve(img);
      });
    };
    img.onerror = () => {
      done();
      reject(new Error('Image element failed to load'));
    };
    img.src = url;
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) {
    throw new ImageLoadError('Not enough memory to load an image this large. Choose a smaller image.');
  }
  return g;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

/** Parse a data: URL into bytes (base64 or percent-encoded). */
function parseDataUrl(url: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const m = /^data:([^,]*?),/i.exec(url);
  if (!m) return null;
  const meta = m[1];
  const body = url.slice(m[0].length);
  const isB64 = /;base64$/i.test(meta);
  const mime = (meta.replace(/;base64$/i, '').split(';')[0] || 'application/octet-stream').toLowerCase();
  try {
    if (isB64) {
      const bin = atob(body.replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { mime, bytes };
    }
    const enc = new TextEncoder().encode(decodeURIComponent(body));
    const bytes = new Uint8Array(enc.length);
    bytes.set(enc);
    return { mime, bytes };
  } catch {
    return null;
  }
}

/**
 * Determine the real MIME type from magic bytes (file.type is often empty or wrong,
 * e.g. files without extension or from some file pickers). Falls back to the declared type.
 */
function sniffMime(b: Uint8Array, declared: string, name = ''): string {
  const at = (o: number, ...v: number[]) => v.every((x, i) => b[o + i] === x);
  const ascii = (o: number, s: string) => at(o, ...Array.from(s, (c) => c.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF8')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  if (ascii(0, 'BM')) return 'image/bmp';
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff';
  // SVG: text starting (after optional BOM / whitespace / XML prolog / comments) with <svg
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 2048)).toLowerCase();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters mark a binary file, not SVG text.
  if (/<svg[\s>]/.test(head) && !/[\x00-\x08]/.test(head)) return 'image/svg+xml';
  if (declared) return declared.toLowerCase();
  if (/\.svgz?$/i.test(name)) return 'image/svg+xml';
  return 'application/octet-stream';
}

/**
 * Rewrite the root <svg> tag with width/height = (tw, th) px. If it has no viewBox, one is added
 * from its intrinsic size (vw, vh in user units = CSS px) so the drawing scales instead of clipping.
 */
function sizeSvgRoot(svg: string, tw: number, th: number, vw: number, vh: number): string {
  const m = /<svg\b[^>]*>/i.exec(svg);
  if (!m) return svg;
  let tag = m[0];
  const hasViewBox = /\sviewBox\s*=/i.test(tag);
  tag = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const selfClosing = /\/\s*>$/.test(tag);
  const head = tag.replace(/\/?\s*>$/, '');
  const extra = ` width="${tw}" height="${th}"${hasViewBox ? '' : ` viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none"`}`;
  tag = head + extra + (selfClosing ? '/>' : '>');
  return svg.slice(0, m.index) + tag + svg.slice(m.index + m[0].length);
}

/** Intrinsic size of an SVG document from width/height (absolute units) or the viewBox. */
function svgIntrinsicSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const toPx = (v?: string): number | null => {
    if (!v) return null;
    const m = /^\s*([\d.]+)\s*(px|pt|mm|cm|in)?\s*$/i.exec(v);
    if (!m) return null; // percentages etc. → fall back to viewBox
    const n = parseFloat(m[1]);
    const unit = (m[2] ?? 'px').toLowerCase();
    const k = unit === 'pt' ? 96 / 72 : unit === 'mm' ? 96 / 25.4 : unit === 'cm' ? 96 / 2.54 : unit === 'in' ? 96 : 1;
    return n > 0 ? n * k : null;
  };
  const w = toPx(attr('width'));
  const h = toPx(attr('height'));
  const vb = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const vbOk = vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  if (w && h) return { width: w, height: h };
  if (vbOk) {
    const ar = vb[2] / vb[3];
    if (w) return { width: w, height: w / ar };
    if (h) return { width: h * ar, height: h };
    return { width: vb[2], height: vb[3] };
  }
  return null;
}
