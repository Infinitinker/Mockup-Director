/**
 * Tests the color quantization in src/export/animation/quantize.ts: the 5-bit histogram, palette
 * building (size limit, exact colors when they fit, bounded error when they do not, determinism,
 * today's output), the cached nearest-color lookup and mapping frames with and without dithering.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPalette,
  ColorHistogram,
  type DitherMode,
  mapFrame,
  PaletteMapper,
} from '../../../src/export/animation/quantize';
import { randomInt, seededRandom } from '../../random';

type Rgb = readonly [number, number, number];

const binOf = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

function histogramOf(rgb: Uint8Array): ColorHistogram {
  const hist = new ColorHistogram();
  hist.addRgb(rgb, null);
  return hist;
}

const colorsOf = (palette: Uint8Array): Rgb[] =>
  Array.from(
    { length: palette.length / 3 },
    (_, i) => [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]] as const,
  );

/**
 * `count` distinct colors whose channels are (2m) * 8 + 0..7: every color has its own histogram
 * bin, and two colors differ by at least 9 in some channel.
 */
function spacedColors(seed: number, count: number): Rgb[] {
  const random = seededRandom(seed);
  const channel = () => randomInt(random, 0, 15) * 16 + randomInt(random, 0, 7);
  const byBin = new Map<number, Rgb>();
  while (byBin.size < count) {
    const color: Rgb = [channel(), channel(), channel()];
    const bin = binOf(...color);
    if (!byBin.has(bin)) byBin.set(bin, color);
  }
  return [...byBin.values()];
}

/** An image of `pixels` pixels drawn at random from `colors`. */
function imageOf(seed: number, colors: readonly Rgb[], pixels: number): Uint8Array {
  const random = seededRandom(seed);
  const rgb = new Uint8Array(pixels * 3);
  for (let p = 0; p < pixels; p++) rgb.set(colors[randomInt(random, 0, colors.length - 1)], p * 3);
  return rgb;
}

/** A smooth gradient with seeded noise, width * height pixels. */
function noisyGradient(seed: number, width: number, height: number): Uint8Array {
  const random = seededRandom(seed);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      const noise = () => randomInt(random, -12, 12);
      rgb[p] = Math.max(0, Math.min(255, (x * 255) / (width - 1) + noise()));
      rgb[p + 1] = Math.max(0, Math.min(255, (y * 255) / (height - 1) + noise()));
      rgb[p + 2] = Math.max(0, Math.min(255, ((x + y) * 255) / (width + height - 2) + noise()));
    }
  }
  return rgb;
}

/** Maps `rgb` and returns the indices. */
function map(rgb: Uint8Array, width: number, palette: Uint8Array, dither: DitherMode): Uint8Array {
  const out = new Uint8Array(rgb.length / 3);
  mapFrame({ rgb, width, height: out.length / width, mapper: new PaletteMapper(palette), dither, out });
  return out;
}

/** Root mean squared error per channel between an image and its mapped palette colors. */
function rmsError(rgb: Uint8Array, indices: Uint8Array, palette: Uint8Array): number {
  let sum = 0;
  for (let p = 0; p < indices.length; p++) {
    for (let c = 0; c < 3; c++) sum += (rgb[p * 3 + c] - palette[indices[p] * 3 + c]) ** 2;
  }
  return Math.sqrt(sum / (indices.length * 3));
}

describe('ColorHistogram', () => {
  it('counts pixels per 5-bit bin and keeps the exact sums', () => {
    const hist = histogramOf(Uint8Array.of(8, 16, 24, 15, 23, 31, 255, 0, 7));
    expect(hist.total).toBe(3);
    const bin = binOf(8, 16, 24);
    expect(hist.count[bin]).toBe(2);
    expect([hist.sumR[bin], hist.sumG[bin], hist.sumB[bin]]).toEqual([23, 39, 55]);
    expect(hist.count[binOf(255, 0, 7)]).toBe(1);
    expect(hist.count.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('skips invisible pixels and samples every n-th pixel', () => {
    const rgb = Uint8Array.from({ length: 30 }, (_, i) => Math.floor(i / 3) * 20);
    const visible = Uint8Array.of(1, 0, 1, 0, 1, 0, 1, 0, 1, 0);
    const masked = new ColorHistogram();
    masked.addRgb(rgb, visible);
    expect(masked.total).toBe(5);
    expect(masked.count[binOf(20, 20, 20)]).toBe(0);
    const sampled = new ColorHistogram();
    sampled.addRgb(rgb, null, 3.7);
    expect(sampled.total).toBe(4);
    expect(sampled.count[binOf(60, 60, 60)]).toBe(1);
    expect(sampled.count[binOf(80, 80, 80)]).toBe(0);
  });
});

describe('buildPalette', () => {
  it('returns black for an empty histogram', () => {
    expect(buildPalette(new ColorHistogram(), 16)).toEqual(Uint8Array.of(0, 0, 0));
  });

  it('returns colors that fit exactly, in bin order', () => {
    const colors = spacedColors(1, 200);
    const palette = buildPalette(histogramOf(imageOf(2, colors, 5000)), 256);
    const sorted = [...colors].sort((a, b) => binOf(...a) - binOf(...b));
    expect(colorsOf(palette)).toEqual(sorted);
  });

  it('merges colors of one bin into their weighted mean', () => {
    const rgb = Uint8Array.of(8, 8, 8, 8, 8, 8, 8, 8, 8, 15, 15, 15);
    expect(buildPalette(histogramOf(rgb), 4)).toEqual(Uint8Array.of(10, 10, 10));
  });

  it('keeps the palette within the limit, clamped to 1..256', () => {
    const rgb = imageOf(3, spacedColors(4, 600), 20_000);
    const hist = histogramOf(rgb);
    for (const max of [1, 2, 7, 16, 255, 256]) expect(buildPalette(hist, max)).toHaveLength(max * 3);
    expect(buildPalette(hist, 0)).toHaveLength(3);
    expect(buildPalette(hist, 1000)).toHaveLength(768);
    expect(buildPalette(hist, 9.9)).toHaveLength(27);
  });

  it('builds a single color as the weighted mean of everything', () => {
    const rgb = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 200, 100, 40);
    expect(buildPalette(histogramOf(rgb), 1)).toEqual(Uint8Array.of(50, 25, 10));
  });

  it('keeps the error of a noisy gradient bounded and shrinking with more colors', () => {
    const rgb = noisyGradient(5, 96, 64);
    const hist = histogramOf(rgb);
    const errors = [16, 64, 256].map((max) => {
      const palette = buildPalette(hist, max);
      return rmsError(rgb, map(rgb, 96, palette, 'none'), palette);
    });
    // Today about 17.5, 9.5 and 5.9.
    expect(errors[0]).toBeLessThan(20);
    expect(errors[1]).toBeLessThan(11);
    expect(errors[2]).toBeLessThan(7);
    expect(errors[1]).toBeLessThan(errors[0]);
    expect(errors[2]).toBeLessThan(errors[1]);
  });

  it('builds the same palette as today from median cut and k-means refinement', () => {
    const palette = buildPalette(histogramOf(noisyGradient(11, 24, 16)), 8);
    expect(Array.from(palette)).toEqual([
      50, 30, 42, 57, 102, 73, 176, 25, 114, 206, 83, 157, 66, 167, 104, 67, 231, 131, 188, 156, 176, 204, 227, 213,
    ]);
  });

  it('is deterministic', () => {
    const rgb = noisyGradient(6, 64, 64);
    expect(buildPalette(histogramOf(rgb), 37)).toEqual(buildPalette(histogramOf(rgb), 37));
  });
});

describe('PaletteMapper', () => {
  /** Weighted distance as the module uses it, from the center of the color's 6-bit cell. */
  function bruteNearest(palette: Uint8Array, r: number, g: number, b: number): number {
    const q = [(r & ~3) + 1.5, (g & ~3) + 1.5, (b & ~3) + 1.5];
    let best = 0;
    let bestDistance = Infinity;
    for (let j = 0; j < palette.length / 3; j++) {
      const d =
        3 * (q[0] - palette[j * 3]) ** 2 + 4 * (q[1] - palette[j * 3 + 1]) ** 2 + 2 * (q[2] - palette[j * 3 + 2]) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = j;
      }
    }
    return best;
  }

  it('finds the nearest color of the 6-bit cell, whatever color of the cell came first', () => {
    const random = seededRandom(7);
    const palette = Uint8Array.from({ length: 48 * 3 }, () => randomInt(random, 0, 255));
    const mapper = new PaletteMapper(palette);
    expect(mapper.size).toBe(48);
    expect(mapper.palette).toBe(palette);
    for (let i = 0; i < 3000; i++) {
      const [r, g, b] = [randomInt(random, 0, 255), randomInt(random, 0, 255), randomInt(random, 0, 255)];
      const index = mapper.nearest(r, g, b);
      expect(index).toBe(bruteNearest(palette, r, g, b));
      expect(mapper.nearest(r ^ 3, g ^ 1, b ^ 2)).toBe(index);
    }
  });

  it('finds every palette color of spaced colors exactly', () => {
    const colors = spacedColors(8, 256);
    const palette = Uint8Array.from(colors.flat());
    const mapper = new PaletteMapper(palette);
    colors.forEach((c, i) => {
      expect(mapper.nearest(...c)).toBe(i);
    });
  });
});

describe('mapFrame', () => {
  it('reproduces an image of up to 256 colors exactly without dithering and with Floyd–Steinberg', () => {
    for (const count of [2, 17, 255, 256]) {
      const colors = spacedColors(10 + count, count);
      const rgb = imageOf(20 + count, colors, 48 * 32);
      const palette = buildPalette(histogramOf(rgb), 256);
      for (const dither of ['none', 'floyd'] as const) {
        const indices = map(rgb, 48, palette, dither);
        expect(indices.every((i) => i < palette.length / 3)).toBe(true);
        expect(rmsError(rgb, indices, palette)).toBe(0);
      }
    }
  });

  it('writes the transparent index for invisible and kept pixels', () => {
    const rgb = new Uint8Array(4 * 3).fill(200);
    const palette = Uint8Array.of(0, 0, 0, 200, 200, 200);
    for (const dither of ['none', 'ordered', 'floyd'] as const) {
      const out = new Uint8Array(4);
      const mapper = new PaletteMapper(palette);
      mapFrame({
        rgb,
        width: 2,
        height: 2,
        mapper,
        dither,
        out,
        visible: Uint8Array.of(1, 0, 1, 1),
        keep: Uint8Array.of(0, 0, 1, 0),
        transparentIndex: 7,
      });
      expect(Array.from(out)).toEqual([1, 7, 7, 1]);
      mapFrame({ rgb, width: 2, height: 2, mapper, dither, out, visible: Uint8Array.of(0, 1, 1, 1) });
      expect(Array.from(out)).toEqual([0, 1, 1, 1]);
    }
  });

  it('dithers a flat gray between black and white', () => {
    const width = 32;
    const gray = new Uint8Array(width * width * 3).fill(128);
    const palette = Uint8Array.of(0, 0, 0, 255, 255, 255);
    expect(map(gray, width, palette, 'none').every((i) => i === 1)).toBe(true);
    for (const dither of ['ordered', 'floyd'] as const) {
      const indices = map(gray, width, palette, dither);
      const white = indices.reduce((n, i) => n + i, 0) / indices.length;
      expect(white).toBeGreaterThan(0.35);
      expect(white).toBeLessThan(0.65);
    }
  });

  it('maps a noisy gradient to the same indices as today in every dither mode', () => {
    const rgb = noisyGradient(12, 12, 6);
    const palette = Uint8Array.of(0, 0, 0, 255, 255, 255, 200, 40, 40, 40, 40, 200);
    const expectedIndices = {
      floyd: [
        0, 0, 0, 0, 2, 3, 2, 2, 2, 2, 2, 2, 0, 0, 2, 0, 3, 2, 3, 2, 3, 2, 2, 2, 0, 3, 0, 3, 2, 3, 2, 2, 1, 2, 1, 2, 0,
        3, 0, 1, 0, 1, 3, 1, 3, 1, 2, 1, 3, 0, 3, 0, 1, 3, 1, 1, 2, 1, 1, 1, 0, 3, 0, 1, 0, 1, 3, 1, 1, 1, 1, 1,
      ],
      ordered: [
        0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 3, 2, 2, 2, 2, 2, 2, 2, 0, 3, 0, 3, 3, 2, 2, 2, 2, 2, 2, 2, 3,
        3, 3, 3, 3, 3, 1, 3, 1, 1, 1, 1, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      ],
      none: [
        0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 3, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 3, 3, 2, 2, 2, 2, 2, 2, 2, 0,
        3, 3, 3, 3, 3, 2, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      ],
    };
    for (const dither of ['floyd', 'ordered', 'none'] as const) {
      expect(Array.from(map(rgb, 12, palette, dither))).toEqual(expectedIndices[dither]);
    }
  });

  it('is deterministic for every dither mode', () => {
    const rgb = noisyGradient(9, 40, 30);
    const palette = buildPalette(histogramOf(rgb), 24);
    for (const dither of ['none', 'ordered', 'floyd'] as const) {
      expect(map(rgb, 40, palette, dither)).toEqual(map(rgb, 40, palette, dither));
    }
  });
});
