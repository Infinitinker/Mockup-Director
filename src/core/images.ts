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
import { UserError } from './errors';
import { parseDataUrl, sniffMime } from './mime';
import { sizeSvgRoot, svgIntrinsicSize } from './svg';
import type { Artwork } from './types/project';

/** Longest side of the GPU texture. Originals stay untouched in the data URL. */
const MAX_TEXTURE_SIZE = 4096;
/** SVGs are rasterized so their longest side is this many px (unless that exceeds the texture cap). */
const SVG_RASTER_SIZE = 3072;

/** File extensions / MIME types we try to decode (the engine decides what actually works). */
export const IMAGE_ACCEPT = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.heic,.heif,.bmp,.tif,.tiff';

/** Decode an image File into an Artwork (sRGB texture, keeps the data URL). */
export async function loadImageFile(file: File): Promise<Artwork> {
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
  const blob = new Blob([bytes], { type: mime });
  const dataUrl = await blobToDataUrl(blob);
  return decodeToAsset(blob, mime, dataUrl, file.name);
}

/** Recreate an Artwork from a data URL (project loading). */
export async function loadImageDataUrl(dataUrl: string, name: string): Promise<Artwork> {
  // Decoded manually instead of fetch(dataUrl): a strict CSP (connect-src) may block fetching data: URLs.
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new UserError(`The artwork “${name}” in the project is damaged. Add the artwork again.`);
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

async function decodeToAsset(blob: Blob, mime: string, dataUrl: string, name: string): Promise<Artwork> {
  let canvas: HTMLCanvasElement;
  try {
    if (mime === 'image/svg+xml') canvas = await rasterizeSvg(blob);
    else canvas = await decodeRaster(blob, mime);
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}
