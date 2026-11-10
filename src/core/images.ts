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
 *  - Limits: a file over MAX_ARTWORK_BYTES is refused before it is read, and an image over
 *    MAX_ARTWORK_PIXELS before it is decoded when its header says its size (imageSize.ts), otherwise
 *    once decoded, before it is drawn. Every load waits for the one before it (`oneAtATime`), whoever
 *    asked for it, so only one full-size image is in memory at once.
 */
import * as THREE from 'three';
import { UserError } from './errors';
import { type PixelSize, imageSize } from './imageSize';
import { megabytes } from './math';
import { parseDataUrl, sniffMime } from './mime';
import { sizeSvgRoot, svgIntrinsicSize } from './svg';
import type { Artwork } from './types/project';

/**
 * The largest artwork file the app takes, in bytes (100 MB). The file is kept whole, in memory and in the project
 * file, as a data URL a third larger than the file.
 */
export const MAX_ARTWORK_BYTES = 100_000_000;

/**
 * The most pixels an artwork may have (100 megapixels): enough for an A1 poster at 300 dpi (7016 × 9933 pixels).
 * Decoded, an image takes 4 bytes a pixel, so at most 400 MB of memory.
 */
export const MAX_ARTWORK_PIXELS = 100_000_000;

/** Throws a UserError when the artwork file `name`, `bytes` long, is larger than MAX_ARTWORK_BYTES. */
export function checkArtworkBytes(name: string, bytes: number): void {
  if (bytes <= MAX_ARTWORK_BYTES) return;
  throw new UserError(
    `The file “${name}” is ${megabytes(bytes)}, more than Mockup Director can use (${megabytes(MAX_ARTWORK_BYTES)}). Save it as a smaller file, for example with fewer pixels, then add it again.`,
  );
}

/** Throws a UserError when the image `name` has more pixels than MAX_ARTWORK_PIXELS. */
export function checkArtworkPixels(name: string, { width, height }: PixelSize): void {
  if (width * height <= MAX_ARTWORK_PIXELS) return;
  const pixels = (n: number) => n.toLocaleString('en-US');
  throw new UserError(
    `The image “${name}” is ${pixels(width)} × ${pixels(height)} pixels, more than Mockup Director can use (${MAX_ARTWORK_PIXELS / 1_000_000} megapixels). Scale it down, then add it again.`,
  );
}

/** Longest side of the GPU texture. Originals stay untouched in the data URL. */
const MAX_TEXTURE_SIZE = 4096;
/** SVGs are rasterized so their longest side is this many px (unless that exceeds the texture cap). */
const SVG_RASTER_SIZE = 3072;

/** File extensions / MIME types we try to decode (the engine decides what actually works). */
export const IMAGE_ACCEPT = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.heic,.heif,.bmp,.tif,.tiff';

/**
 * Decode an image File into an Artwork (sRGB texture, keeps the data URL). Throws a UserError when the file cannot
 * be read or decoded, or is over the limits.
 */
export async function loadImageFile(file: File): Promise<Artwork> {
  checkArtworkBytes(file.name, file.size);
  return oneAtATime(() => readImageFile(file));
}

async function readImageFile(file: File): Promise<Artwork> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    throw new UserError(
      `The file “${file.name}” could not be read. Check that it still exists and can be opened, then add it again.`,
      { cause: err },
    );
  }
  const mime = sniffMime(bytes, file.type, file.name);
  checkHeaderSize(bytes, file.name);
  const blob = new Blob([bytes], { type: mime });
  const dataUrl = await blobToDataUrl(blob, file.name);
  return decodeToAsset(blob, mime, dataUrl, file.name);
}

/**
 * Recreate an Artwork from a data URL (project loading). Throws a UserError when the data URL is damaged, cannot
 * be decoded, or holds an image over the pixel limit.
 */
export function loadImageDataUrl(dataUrl: string, name: string): Promise<Artwork> {
  return oneAtATime(() => readImageDataUrl(dataUrl, name));
}

async function readImageDataUrl(dataUrl: string, name: string): Promise<Artwork> {
  // Decoded manually instead of fetch(dataUrl): a strict CSP (connect-src) may block fetching data: URLs.
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new UserError(`The artwork “${name}” in the project is damaged. Add the artwork again.`);
  }
  const mime = sniffMime(parsed.bytes, parsed.mime, name);
  checkHeaderSize(parsed.bytes, name);
  const blob = new Blob([parsed.bytes], { type: mime });
  return decodeToAsset(blob, mime, dataUrl, name);
}

/** The last load started; the next one waits for it, whether it succeeded or failed. */
let lastLoad: Promise<unknown> = Promise.resolve();

/** Runs `load` after every load started before it has ended, so that only one image is read and decoded at once. */
function oneAtATime<T>(load: () => Promise<T>): Promise<T> {
  const run = lastLoad.then(load);
  lastLoad = run.catch(() => undefined);
  return run;
}

/** Refuses an image whose header says it is over the pixel limit, before anything decodes it. */
function checkHeaderSize(bytes: Uint8Array, name: string): void {
  const size = imageSize(bytes);
  if (size) checkArtworkPixels(name, size);
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

async function decodeToAsset(blob: Blob, mime: string, dataUrl: string, name: string): Promise<Artwork> {
  let canvas: HTMLCanvasElement;
  try {
    if (mime === 'image/svg+xml') canvas = await rasterizeSvg(blob);
    else canvas = await decodeRaster(blob, mime, name);
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(
      `The file “${name}” could not be read as an image. Choose a PNG, JPEG, WebP, GIF or SVG file.`,
      { cause: err },
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

/**
 * Raster formats: ImageBitmap (non-JPEG) with HTMLImageElement fallback, baked into a canvas. The decoded size is
 * checked against the pixel limit before it is drawn, for the formats whose header imageSize does not read.
 */
async function decodeRaster(blob: Blob, mime: string, name: string): Promise<HTMLCanvasElement> {
  if (mime !== 'image/jpeg' && typeof createImageBitmap === 'function') {
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await createImageBitmap(blob);
    } catch {
      bmp = null; // e.g. Safari < 15 or a format the bitmap decoder lacks – fall back below
    }
    if (bmp && bmp.width > 0 && bmp.height > 0) {
      try {
        checkArtworkPixels(name, bmp);
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
  checkArtworkPixels(name, { width: w, height: h });
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

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) {
    throw new UserError('Not enough memory to load an image this large. Choose a smaller image.');
  }
  return g;
}

/** The data URL of the artwork file `name`. Throws a UserError when it cannot be made (most often, memory ran out). */
async function blobToDataUrl(blob: Blob, name: string): Promise<string> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
      r.readAsDataURL(blob);
    });
  } catch (err) {
    throw new UserError(
      `The file “${name}” could not be read into the project. Close other projects or choose a smaller file, then add it again.`,
      { cause: err },
    );
  }
}
