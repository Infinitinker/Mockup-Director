/**
 * Tests the exporter's pixel geometry in src/export/layout.ts: the bounding box of the visible
 * pixels, the size of the supersampled render, fitting a size inside a box and integer clamping.
 */
import { describe, expect, it } from 'vitest';
import { type PixelRect, clampInt, findAlphaBounds, fitInside, supersampleSize } from '../../src/export/layout';
import { randomInt, seededRandom } from '../random';

/** The bounding box of the pixels whose alpha is above `minAlpha`, found pixel by pixel. */
function slowAlphaBounds(data: Uint8Array, width: number, height: number, minAlpha: number): PixelRect | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= minAlpha) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** RGBA pixels with random colors, transparent except for a few random dots of random alpha. */
function randomImage(random: () => number, width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = randomInt(random, 0, 255);
  const dots = randomInt(random, 0, 6);
  for (let d = 0; d < dots; d++) {
    const i = randomInt(random, 0, width * height - 1);
    data[i * 4 + 3] = randomInt(random, 0, 255);
  }
  return data;
}

describe('findAlphaBounds', () => {
  it('finds the same box as a pixel-by-pixel scan', () => {
    const random = seededRandom(1);
    for (let run = 0; run < 500; run++) {
      const width = randomInt(random, 1, 40);
      const height = randomInt(random, 1, 40);
      const data = randomImage(random, width, height);
      const minAlpha = run % 4 === 0 ? randomInt(random, 0, 254) : 1;
      expect(findAlphaBounds(data, width, height, minAlpha)).toEqual(slowAlphaBounds(data, width, height, minAlpha));
    }
  });

  it('gives the same box for unaligned and clamped pixel arrays', () => {
    const random = seededRandom(2);
    for (let run = 0; run < 200; run++) {
      const width = randomInt(random, 1, 30);
      const height = randomInt(random, 1, 30);
      const data = randomImage(random, width, height);
      const expected = slowAlphaBounds(data, width, height, 1);
      const unaligned = new Uint8Array(data.length + 1);
      unaligned.set(data, 1);
      expect(findAlphaBounds(unaligned.subarray(1), width, height)).toEqual(expected);
      expect(findAlphaBounds(new Uint8ClampedArray(data), width, height)).toEqual(expected);
    }
  });

  it('counts only alpha above the threshold as content', () => {
    const data = new Uint8Array(3 * 2 * 4);
    data[(1 * 3 + 2) * 4 + 3] = 1;
    data[(0 * 3 + 1) * 4 + 3] = 2;
    expect(findAlphaBounds(data, 3, 2)).toEqual({ x: 1, y: 0, w: 1, h: 1 });
    expect(findAlphaBounds(data, 3, 2, 0)).toEqual({ x: 1, y: 0, w: 2, h: 2 });
    expect(findAlphaBounds(data, 3, 2, 2)).toBeNull();
  });

  it('returns null for transparent, empty or too short images', () => {
    expect(findAlphaBounds(new Uint8Array(4 * 4 * 4), 4, 4)).toBeNull();
    expect(findAlphaBounds(new Uint8Array(0), 0, 0)).toBeNull();
    expect(findAlphaBounds(new Uint8Array(16).fill(255), 0, 4)).toBeNull();
    expect(findAlphaBounds(new Uint8Array(15).fill(255), 2, 2)).toBeNull();
  });
});

describe('supersampleSize', () => {
  it('stays within the side and pixel limits, keeps the aspect ratio and gives whole pixels', () => {
    const random = seededRandom(3);
    for (let run = 0; run < 1000; run++) {
      const targetW = randomInt(random, 1, 6000);
      const targetH = randomInt(random, 1, 6000);
      const factor = randomInt(random, 1, 4);
      const maxSide = randomInt(random, 256, 8192);
      const maxPixels = randomInt(random, 1_000_000, 48_000_000);
      const { width, height, scale } = supersampleSize(targetW, targetH, factor, maxSide, maxPixels);

      expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(1);
      expect(height).toBeGreaterThanOrEqual(1);
      expect(width).toBeLessThanOrEqual(maxSide);
      expect(height).toBeLessThanOrEqual(maxSide);
      expect(scale).toBeLessThanOrEqual(factor);
      expect(targetW * scale * targetH * scale).toBeLessThanOrEqual(maxPixels * (1 + 1e-12));
      expect(Math.abs(width - targetW * scale)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(height - targetH * scale)).toBeLessThanOrEqual(0.5);
    }
  });

  it('uses the full factor when the limits allow it', () => {
    expect(supersampleSize(1000, 500)).toEqual({ width: 2000, height: 1000, scale: 2 });
    expect(supersampleSize(1000, 500, 3)).toEqual({ width: 3000, height: 1500, scale: 3 });
  });

  it('lowers the factor for the longest side and for the pixel count', () => {
    expect(supersampleSize(6000, 3000)).toEqual({ width: 8192, height: 4096, scale: 8192 / 6000 });
    const big = supersampleSize(6000, 6000);
    expect(big.scale).toBeCloseTo(Math.sqrt(48_000_000 / 36_000_000), 12);
    expect(big.width).toBe(6928);
    expect(big.height).toBe(6928);
  });

  it('treats sizes below one pixel as one pixel', () => {
    expect(supersampleSize(0, -5)).toEqual({ width: 2, height: 2, scale: 2 });
  });
});

describe('fitInside', () => {
  it('fits inside the box, touches it on one side and keeps the aspect ratio', () => {
    const random = seededRandom(4);
    for (let run = 0; run < 1000; run++) {
      const w = randomInt(random, 1, 5000);
      const h = randomInt(random, 1, 5000);
      const maxW = randomInt(random, 1, 4000);
      const maxH = randomInt(random, 1, 4000);
      const { width, height, scale } = fitInside(w, h, maxW, maxH);

      expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(1);
      expect(height).toBeGreaterThanOrEqual(1);
      expect(width).toBeLessThanOrEqual(maxW);
      expect(height).toBeLessThanOrEqual(maxH);
      expect(scale).toBe(Math.min(maxW / w, maxH / h));
      expect(width === maxW || height === maxH).toBe(true);
      expect(Math.abs(width - Math.max(1, w * scale))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(height - Math.max(1, h * scale))).toBeLessThanOrEqual(0.5);
    }
  });

  it('scales up as well as down', () => {
    expect(fitInside(100, 50, 400, 400)).toEqual({ width: 400, height: 200, scale: 4 });
    expect(fitInside(4000, 1000, 400, 400)).toEqual({ width: 400, height: 100, scale: 0.1 });
  });

  it('keeps at least one pixel on the short side', () => {
    expect(fitInside(10_000, 1, 100, 100)).toEqual({ width: 100, height: 1, scale: 0.01 });
  });
});

describe('clampInt', () => {
  it('rounds and clamps numbers', () => {
    expect(clampInt(4.4, 0, 10, 5)).toBe(4);
    expect(clampInt(4.5, 0, 10, 5)).toBe(5);
    expect(clampInt(-3, 0, 10, 5)).toBe(0);
    expect(clampInt(12.7, 0, 10, 5)).toBe(10);
  });

  it('uses the fallback for anything that is not a finite number, clamped too', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '7', null, undefined, {}, true]) {
      expect(clampInt(v, 0, 10, 5)).toBe(5);
      expect(clampInt(v, 0, 10, 50)).toBe(10);
    }
  });

  it('always gives an integer in range', () => {
    const random = seededRandom(5);
    for (let run = 0; run < 1000; run++) {
      const min = randomInt(random, -100, 100);
      const max = min + randomInt(random, 0, 200);
      const v = (random() - 0.5) * 1000;
      const result = clampInt(v, min, max, min);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(max);
    }
  });
});
