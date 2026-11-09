/**
 * Tests the animated GIF encoder in src/export/animation/gif.ts by reading its files back: the
 * header, logical screen and color tables, the NETSCAPE2.0 loop extension, graphic control
 * extensions (delays, disposal, transparency), image descriptors, and the frames composed from
 * the decoded LZW data compared with the input pixels.
 */
import { describe, expect, it } from 'vitest';
import { GifAnimationEncoder, type GifEncoderOptions } from '../../../src/export/animation/gif';
import { randomInt, seededRandom } from '../../random';
import { type GifFile, readGif } from './gifReader';

type Rgba = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];

/** Colors that land in different histogram bins and are far enough apart to come back exactly. */
const LIGHT: Rgb = [240, 240, 240];
const RED: Rgb = [200, 40, 40];
const GREEN: Rgb = [40, 200, 40];
const BLUE: Rgb = [40, 40, 200];
const DARK: Rgb = [16, 16, 16];

const opaque = (c: Rgb): Rgba => [c[0], c[1], c[2], 255];
const CLEAR: Rgba = [0, 0, 0, 0];

/** An RGBA frame filled by `pixel`. */
function frame(width: number, height: number, pixel: (x: number, y: number) => Rgba): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out.set(pixel(x, y), (y * width + x) * 4);
  }
  return out;
}

const inside = (x: number, y: number, left: number, top: number, size: number) =>
  x >= left && x < left + size && y >= top && y < top + size;

/** What a viewer should show for an input frame: alpha below the threshold is see-through, the rest is opaque over the matte. */
function expected(rgba: Uint8ClampedArray, matte: Rgb, threshold = 128): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let p = 0; p < rgba.length; p += 4) {
    const a = rgba[p + 3];
    if (a < threshold) continue;
    const k = a / 255;
    for (let c = 0; c < 3; c++) out[p + c] = a === 255 ? rgba[p + c] : Math.round(rgba[p + c] * k + matte[c] * (1 - k));
    out[p + 3] = 255;
  }
  return out;
}

/** Composes the frames as a viewer shows them (disposal 1 keeps, 2 clears to transparent). */
function compose(gif: GifFile): Uint8ClampedArray[] {
  const canvas = new Uint8ClampedArray(gif.width * gif.height * 4);
  const shown: Uint8ClampedArray[] = [];
  for (const image of gif.images) {
    const table = image.localColorTable ?? gif.globalColorTable;
    if (!table) throw new Error('image without a color table');
    const control = image.control;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const index = image.indices[y * image.width + x];
        if (control?.hasTransparency && index === control.transparentIndex) continue;
        if (index * 3 >= table.length) throw new Error(`index ${index} is past the color table`);
        const p = ((image.top + y) * gif.width + image.left + x) * 4;
        canvas.set([table[index * 3], table[index * 3 + 1], table[index * 3 + 2], 255], p);
      }
    }
    shown.push(canvas.slice());
    if (control?.disposal === 2) {
      for (let y = 0; y < image.height; y++) {
        const p = ((image.top + y) * gif.width + image.left) * 4;
        canvas.fill(0, p, p + image.width * 4);
      }
    }
  }
  return shown;
}

/** Mean absolute difference per channel of two RGBA buffers over the pixels opaque in `a`. */
function meanError(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  let count = 0;
  for (let p = 0; p < a.length; p += 4) {
    if (!a[p + 3]) continue;
    for (let c = 0; c < 3; c++) sum += Math.abs(a[p + c] - b[p + c]);
    count += 3;
  }
  return sum / count;
}

async function encode(
  options: GifEncoderOptions,
  frames: readonly Uint8ClampedArray[],
  delays: readonly number[],
  samples: readonly Uint8ClampedArray[] = [],
): Promise<{ bytes: Uint8Array; blob: Blob }> {
  const encoder = new GifAnimationEncoder(options);
  for (const s of samples) encoder.addPaletteSample(s);
  frames.forEach((f, i) => {
    encoder.addFrame(f, delays[i]);
  });
  const blob = encoder.finish();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), blob };
}

const netscapeLoop = (gif: GifFile) => {
  expect(gif.applications).toHaveLength(1);
  const [app] = gif.applications;
  expect(app.identifier).toBe('NETSCAPE2.0');
  expect(app.blocks).toHaveLength(1);
  expect(app.blocks[0]).toHaveLength(3);
  expect(app.blocks[0][0]).toBe(1);
  return app.blocks[0][1] | (app.blocks[0][2] << 8);
};

describe('GifAnimationEncoder with an opaque global palette', () => {
  const W = 16;
  const H = 12;
  const square = (left: number, top: number, color: Rgb, tweak?: [number, number, Rgb]) =>
    frame(W, H, (x, y) => {
      if (tweak && x === tweak[0] && y === tweak[1]) return opaque(tweak[2]);
      return opaque(inside(x, y, left, top, 4) ? color : LIGHT);
    });
  const f0 = square(2, 3, RED);
  const f1 = square(6, 5, RED);
  const f2 = square(6, 5, RED, [0, 0, [242, 240, 240]]);
  const f3 = square(6, 5, RED, [15, 11, BLUE]);
  const frames = [f0, f1, f2, f3];
  const options: GifEncoderOptions = {
    width: W,
    height: H,
    transparent: false,
    dither: 'none',
    palette: 'global',
    loopCount: 3,
  };

  it('writes the header, logical screen, global color table and loop extension', async () => {
    const { bytes, blob } = await encode(options, frames, [7, 8.4, 9.6, 5], frames);
    expect(blob.type).toBe('image/gif');
    expect(bytes[bytes.length - 1]).toBe(0x3b);
    const gif = readGif(bytes);
    expect(gif.signature).toBe('GIF89a');
    expect([gif.width, gif.height]).toEqual([W, H]);
    expect(gif.packed).toBe(0x80 | 0x70 | 1);
    expect([gif.backgroundIndex, gif.aspectRatio]).toEqual([0, 0]);
    expect(gif.globalColorTable).toHaveLength(12);
    const colors = [0, 1, 2].map((i) => Array.from(gif.globalColorTable?.subarray(i * 3, i * 3 + 3) ?? []));
    expect(colors).toEqual(expect.arrayContaining([[...LIGHT], [...RED], [...BLUE]]));
    expect(Array.from(gif.globalColorTable?.subarray(9) ?? [])).toEqual([0, 0, 0]);
    expect(netscapeLoop(gif)).toBe(3);
    expect(gif.order).toEqual(['application', 'image', 'image', 'image', 'image']);
  });

  it('writes only the changed rectangle, unchanged pixels as the reserved transparent index', async () => {
    const gif = readGif((await encode(options, frames, [7, 8.4, 9.6, 5], frames)).bytes);
    expect(gif.images.map((i) => [i.left, i.top, i.width, i.height])).toEqual([
      [0, 0, W, H],
      [2, 3, 8, 6],
      [0, 0, 1, 1],
      [15, 11, 1, 1],
    ]);
    expect(gif.images.map((i) => i.control?.delayCs)).toEqual([7, 8, 10, 5]);
    expect(gif.images.map((i) => i.control?.disposal)).toEqual([1, 1, 1, 1]);
    expect(gif.images.map((i) => i.control?.hasTransparency)).toEqual([false, true, true, true]);
    expect(gif.images.map((i) => i.control?.transparentIndex)).toEqual([0, 3, 3, 3]);
    expect(gif.images.every((i) => i.control?.userInput === false && i.control.reserved === 0)).toBe(true);
    expect(gif.images.every((i) => i.localColorTable === null && i.packed === 0 && i.minCodeSize === 2)).toBe(true);
    expect(gif.images[2].indices).toEqual(Uint8Array.of(3));
    const moved = gif.images[1];
    const at = (x: number, y: number) => moved.indices[(y - moved.top) * moved.width + x - moved.left];
    expect([at(2, 8), at(9, 3)]).toEqual([3, 3]);
    expect([at(2, 3), at(9, 8)]).not.toContain(3);
  });

  it('shows the input frames exactly, changes within the tolerance of 2 kept as they were', async () => {
    const shown = compose(readGif((await encode(options, frames, [7, 8, 9, 5], frames)).bytes));
    expect(shown[0]).toEqual(expected(f0, LIGHT));
    expect(shown[1]).toEqual(expected(f1, LIGHT));
    expect(shown[2]).toEqual(expected(f1, LIGHT));
    expect(shown[3]).toEqual(expected(f3, LIGHT));
  });

  it('draws a change of 3 again and compares kept pixels with the color last drawn', async () => {
    const drift = (color: Rgb, slow: Rgb) =>
      frame(8, 4, (x, y) => opaque(y > 0 ? LIGHT : x === 0 ? color : x === 5 ? slow : LIGHT));
    const steps = [
      drift(RED, LIGHT),
      drift(BLUE, [242, 240, 240]),
      drift(BLUE, [244, 240, 240]),
      drift(BLUE, [247, 240, 240]),
    ];
    const gif = readGif((await encode({ ...options, width: 8, height: 4 }, steps, [4, 4, 4, 4], steps)).bytes);
    expect(gif.images.map((i) => [i.left, i.top, i.width, i.height])).toEqual([
      [0, 0, 8, 4],
      [0, 0, 1, 1],
      [5, 0, 1, 1],
      [5, 0, 1, 1],
    ]);
  });

  it('builds the palette from the first frame when no samples are given', async () => {
    const encoder = new GifAnimationEncoder(options);
    expect(encoder.needsPaletteSamples).toBe(true);
    encoder.addFrame(f0, 4);
    expect(encoder.needsPaletteSamples).toBe(false);
    const gif = readGif(new Uint8Array(await encoder.finish().arrayBuffer()));
    expect(gif.globalColorTable).toHaveLength(12);
    expect(Array.from(gif.globalColorTable?.subarray(6) ?? [])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(compose(gif)[0]).toEqual(expected(f0, LIGHT));
  });

  it('ignores palette samples once the palette is built', async () => {
    const encoder = new GifAnimationEncoder(options);
    encoder.addPaletteSample(f0);
    encoder.addFrame(f0, 4);
    encoder.addPaletteSample(f3);
    encoder.addFrame(f3, 4);
    const gif = readGif(new Uint8Array(await encoder.finish().arrayBuffer()));
    expect(Array.from(gif.globalColorTable?.subarray(6) ?? [])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(compose(gif)[1]).not.toEqual(expected(f3, LIGHT));
  });
});

describe('GifAnimationEncoder with transparency', () => {
  const W = 12;
  const H = 10;
  const sprite = (left: number) =>
    frame(W, H, (x, y) => {
      if (inside(x, y, left, 1, 4)) return opaque(RED);
      if (y === 7) return [GREEN[0], GREEN[1], GREEN[2], 200];
      if (y === 8) return x < 6 ? [BLUE[0], BLUE[1], BLUE[2], 127] : [BLUE[0], BLUE[1], BLUE[2], 128];
      return CLEAR;
    });
  const frames = [sprite(1), sprite(6)];

  it('writes full frames with disposal 2 and the reserved index as transparent (global palette)', async () => {
    const gif = readGif(
      (await encode({ width: W, height: H, transparent: true, dither: 'none', palette: 'global' }, frames, [3, 4]))
        .bytes,
    );
    const count = 3;
    expect(gif.packed).toBe(0x80 | 0x70 | 1);
    expect(netscapeLoop(gif)).toBe(0);
    expect(gif.images.map((i) => [i.left, i.top, i.width, i.height])).toEqual([
      [0, 0, W, H],
      [0, 0, W, H],
    ]);
    for (const image of gif.images) {
      expect(image.control).toMatchObject({ disposal: 2, hasTransparency: true, transparentIndex: count });
    }
    const shown = compose(gif);
    expect(shown[0]).toEqual(expected(frames[0], [255, 255, 255]));
    expect(shown[1]).toEqual(expected(frames[1], [255, 255, 255]));
  });

  it('composites over the matte and honors the alpha threshold', async () => {
    const options: GifEncoderOptions = {
      width: W,
      height: H,
      transparent: true,
      dither: 'none',
      palette: 'global',
      matte: [0, 0, 0],
      alphaThreshold: 200,
    };
    const shown = compose(readGif((await encode(options, frames, [3, 4])).bytes));
    expect(shown[0]).toEqual(expected(frames[0], [0, 0, 0], 200));
  });

  it('writes a local color table per frame with its own transparent index', async () => {
    const gif = readGif(
      (await encode({ width: W, height: H, transparent: true, dither: 'floyd', palette: 'frame' }, frames, [3, 4]))
        .bytes,
    );
    expect(gif.packed).toBe(0x70);
    expect(gif.globalColorTable).toBeNull();
    for (const image of gif.images) {
      expect(image.packed).toBe(0x81);
      expect(image.localColorTable).toHaveLength(12);
      expect(image.control).toMatchObject({ disposal: 2, hasTransparency: true, transparentIndex: 3 });
    }
    const shown = compose(gif);
    expect(shown[1]).toEqual(expected(frames[1], [255, 255, 255]));
  });

  it('keeps an index free for transparency in a local color table when the frame has 256 colors', async () => {
    const SIDE = 16;
    const colorful = frame(SIDE, SIDE + 1, (x, y) =>
      y < SIDE ? [x * 16 + 8, y * 16 + 8, 128, 255] : [x * 16 + 8, 8, 128, 0],
    );
    const gif = readGif(
      (
        await encode(
          { width: SIDE, height: SIDE + 1, transparent: true, dither: 'none', palette: 'frame' },
          [colorful],
          [1],
        )
      ).bytes,
    );
    const [image] = gif.images;
    expect(image.localColorTable).toHaveLength(768);
    expect(image.control).toMatchObject({ hasTransparency: true, transparentIndex: 255 });
    const visible = image.indices.subarray(0, SIDE * SIDE);
    expect(visible).not.toContain(255);
    expect(image.indices.subarray(SIDE * SIDE)).toEqual(new Uint8Array(SIDE).fill(255));
    const shown = compose(gif)[0];
    const want = expected(colorful, [255, 255, 255]);
    expect(shown.filter((_, i) => i % 4 === 3)).toEqual(want.filter((_, i) => i % 4 === 3));
    expect(meanError(want, shown)).toBeLessThan(1);
  });
});

describe('GifAnimationEncoder with local palettes', () => {
  it('writes each frame with its own colors and no transparency', async () => {
    const W = 9;
    const H = 7;
    const a = frame(W, H, (x) => opaque(x < 3 ? RED : x < 6 ? GREEN : BLUE));
    const b = frame(W, H, (x, y) => opaque((x + y) % 2 ? DARK : LIGHT));
    const gif = readGif(
      (await encode({ width: W, height: H, transparent: false, dither: 'none', palette: 'frame' }, [a, b], [2, 2]))
        .bytes,
    );
    expect(gif.globalColorTable).toBeNull();
    expect(gif.images.map((i) => i.packed)).toEqual([0x81, 0x80]);
    expect(gif.images.map((i) => i.localColorTable?.length)).toEqual([12, 6]);
    expect(gif.images.map((i) => i.minCodeSize)).toEqual([2, 2]);
    for (const image of gif.images) {
      expect(image.control).toMatchObject({ disposal: 1, hasTransparency: false, transparentIndex: 0 });
      expect([image.left, image.top, image.width, image.height]).toEqual([0, 0, W, H]);
    }
    const shown = compose(gif);
    expect(shown[0]).toEqual(expected(a, LIGHT));
    expect(shown[1]).toEqual(expected(b, LIGHT));
  });
});

describe('GifAnimationEncoder with many colors', () => {
  const W = 64;
  const H = 48;
  const gradient = (shift: number) => frame(W, H, (x, y) => [x * 4, y * 5, ((x + y + shift) * 2) & 255, 255]);

  /** Today's mean errors are about 7 (Floyd–Steinberg), 9 (ordered) and 6 (none). */
  const GRADIENT_ERROR = { floyd: 9, ordered: 12, none: 8 };

  it('keeps a dithered gradient close to the input', async () => {
    const frames = [gradient(0), gradient(16), gradient(32)];
    for (const dither of ['floyd', 'ordered', 'none'] as const) {
      const options: GifEncoderOptions = { width: W, height: H, transparent: false, dither, palette: 'global' };
      const gif = readGif((await encode(options, frames, [4, 4, 4], frames)).bytes);
      expect(gif.globalColorTable).toHaveLength(768);
      expect(gif.images[1].control?.transparentIndex).toBe(255);
      const shown = compose(gif);
      shown.forEach((s, i) => {
        expect(meanError(s, frames[i])).toBeLessThan(GRADIENT_ERROR[dither]);
      });
    }
  });

  it('encodes noise that fills the LZW table and stays deterministic', async () => {
    const random = seededRandom(42);
    const noise = frame(96, 96, () => [
      randomInt(random, 0, 255),
      randomInt(random, 0, 255),
      randomInt(random, 0, 255),
      255,
    ]);
    const options: GifEncoderOptions = { width: 96, height: 96, transparent: false, dither: 'none', palette: 'frame' };
    const first = await encode(options, [noise], [1]);
    const gif = readGif(first.bytes);
    expect(gif.images[0].localColorTable).toHaveLength(768);
    expect(gif.images[0].minCodeSize).toBe(8);
    expect(gif.images[0].clearCodes).toBeGreaterThan(1);
    expect(meanError(compose(gif)[0], noise)).toBeLessThan(13);
    expect((await encode(options, [noise], [1])).bytes).toEqual(first.bytes);
  });
});

describe('GifAnimationEncoder limits', () => {
  const tiny = frame(2, 2, () => opaque(RED));

  it('writes a valid file without frames', async () => {
    const global = readGif(
      (await encode({ width: 5, height: 4, transparent: false, dither: 'none', palette: 'global' }, [], [])).bytes,
    );
    expect(global.packed).toBe(0x80 | 0x70);
    expect(global.globalColorTable).toEqual(new Uint8Array(6));
    expect(global.images).toHaveLength(0);
    const local = readGif(
      (await encode({ width: 5, height: 4, transparent: true, dither: 'none', palette: 'frame' }, [], [])).bytes,
    );
    expect(local.packed).toBe(0x70);
    expect(local.globalColorTable).toBeNull();
    expect(local.order).toEqual(['application']);
  });

  it('rounds and clamps the size, loop count and delays', async () => {
    const options: GifEncoderOptions = {
      width: 2.4,
      height: 1.6,
      transparent: false,
      dither: 'none',
      palette: 'frame',
      loopCount: 70_000,
    };
    const gif = readGif((await encode(options, [tiny, tiny, tiny], [-5, 1e6, 2.5])).bytes);
    expect([gif.width, gif.height]).toEqual([2, 2]);
    expect(netscapeLoop(gif)).toBe(65535);
    expect(gif.images.map((i) => i.control?.delayCs)).toEqual([0, 65535, 3]);
    const rounded = readGif((await encode({ ...options, loopCount: 2.6 }, [tiny], [1])).bytes);
    expect(netscapeLoop(rounded)).toBe(3);
  });

  it('rejects a frame with too few pixels', () => {
    const encoder = new GifAnimationEncoder({
      width: 2,
      height: 2,
      transparent: false,
      dither: 'none',
      palette: 'frame',
    });
    expect(() => encoder.addFrame(tiny.subarray(0, 15), 1)).toThrow();
  });
});
