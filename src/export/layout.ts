/**
 * Pure geometry helpers for the exporter (no imports, no DOM) – unit-testable with Node.
 */

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True on little-endian hosts (every Mac / PC today) – decides where alpha sits in a Uint32 RGBA word. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * Bounding box of all pixels whose alpha is > `minAlpha` (0..255) in RGBA8 data.
 * Semi-transparent pixels (soft shadow, faded reflection, anti-aliased edges) count as content.
 * Returns null for a fully transparent image.
 *
 * Fast path: scans whole 32-bit words; rows are first trimmed from top / bottom, then each
 * remaining row is only scanned outside the box found so far.
 */
export function findAlphaBounds(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  minAlpha = 1,
): PixelRect | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  const aligned = data.byteOffset % 4 === 0;
  const words = aligned ? new Uint32Array(data.buffer, data.byteOffset, width * height) : null;
  const shift = LITTLE_ENDIAN ? 24 : 0;
  const alphaAt: (i: number) => number = words
    ? (i) => (words[i] >>> shift) & 0xff
    : (i) => data[i * 4 + 3];

  const rowHasContent = (y: number): boolean => {
    const base = y * width;
    for (let x = 0; x < width; x++) if (alphaAt(base + x) > minAlpha) return true;
    return false;
  };

  let top = 0;
  while (top < height && !rowHasContent(top)) top++;
  if (top === height) return null;
  let bottom = height - 1;
  while (bottom > top && !rowHasContent(bottom)) bottom--;

  let left = width;
  let right = -1;
  for (let y = top; y <= bottom; y++) {
    const base = y * width;
    // Scan from the left only up to the current left edge…
    for (let x = 0; x < left; x++) {
      if (alphaAt(base + x) > minAlpha) {
        left = x;
        break;
      }
    }
    // …and from the right only down to the current right edge.
    for (let x = width - 1; x > right; x--) {
      if (alphaAt(base + x) > minAlpha) {
        right = x;
        break;
      }
    }
  }
  if (right < left) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * Size of the off-screen render for a given target content box: `factor`× supersampling,
 * limited by the longest side and the total pixel count (memory – WebKit caps canvas memory).
 * Keeps the target aspect ratio.
 */
export function supersampleSize(
  targetW: number,
  targetH: number,
  factor = 2,
  maxSide = 8192,
  maxPixels = 48_000_000,
): { width: number; height: number; scale: number } {
  const tw = Math.max(1, targetW);
  const th = Math.max(1, targetH);
  let s = factor;
  s = Math.min(s, maxSide / tw, maxSide / th);
  s = Math.min(s, Math.sqrt(maxPixels / (tw * th)));
  const width = Math.max(1, Math.min(maxSide, Math.round(tw * s)));
  const height = Math.max(1, Math.min(maxSide, Math.round(th * s)));
  return { width, height, scale: s };
}

/** Scale (w, h) uniformly to fit inside (maxW, maxH). Result in whole pixels, at least 1×1. */
export function fitInside(w: number, h: number, maxW: number, maxH: number): { width: number; height: number; scale: number } {
  const s = Math.min(maxW / w, maxH / h);
  return {
    width: Math.max(1, Math.min(maxW, Math.round(w * s))),
    height: Math.max(1, Math.min(maxH, Math.round(h * s))),
    scale: s,
  };
}

/** Clamp to an integer range; NaN / non-numbers become `fallback`. */
export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(min, Math.min(max, n));
}
