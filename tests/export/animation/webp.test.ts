/**
 * Tests the animated WebP muxer in src/export/animation/webp.ts: parsing still WebP files (built
 * here from fixed bytes in place of the engine's encoder) and the RIFF container it writes – the
 * RIFF size, VP8X flags and canvas, ANIM loop count and background, and the ANMF frames.
 */
import { describe, expect, it } from 'vitest';
import { AnimatedWebpWriter, parseWebp } from '../../../src/export/animation/webp';
import { type AnimatedWebp, readAnimatedWebp, readChunks } from './webpReader';

type ChunkSpec = readonly [id: string, payload: Uint8Array];

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const le = (value: number, bytes: number) => Uint8Array.from({ length: bytes }, (_, i) => (value >>> (8 * i)) & 0xff);

/** A RIFF WEBP file of `chunks`; odd payloads get `padding` as their padding byte. */
function riff(chunks: readonly ChunkSpec[], padding = 0): Uint8Array {
  const parts: number[] = [...ascii('WEBP')];
  for (const [id, payload] of chunks) {
    parts.push(...ascii(id), ...le(payload.length, 4), ...payload);
    if (payload.length & 1) parts.push(padding);
  }
  return Uint8Array.from([...ascii('RIFF'), ...le(parts.length, 4), ...parts]);
}

/** A VP8L payload: signature, 14-bit width-1 and height-1, the alpha bit, then `rest`. */
const vp8l = (width: number, height: number, alpha: boolean, rest: number[]) =>
  Uint8Array.from([0x2f, ...le((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28), 4), ...rest]);

/** A VP8 payload: frame tag, start code, 16-bit width and height fields, then `rest`. */
const vp8 = (widthField: number, heightField: number, rest: number[]) =>
  Uint8Array.from([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...le(widthField, 2), ...le(heightField, 2), ...rest]);

/** A VP8X payload: flags, reserved bytes, canvas width-1 and height-1. */
const vp8x = (flags: number, width: number, height: number) =>
  Uint8Array.from([flags, 0, 0, 0, ...le(width - 1, 3), ...le(height - 1, 3)]);

const chunkIds = (data: Uint8Array) => readChunks(data, 0, data.length).map((c) => [c.id, Array.from(c.payload)]);

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('parseWebp', () => {
  it('reads a lossless still: size, alpha bit and the padded VP8L chunk', () => {
    const payload = vp8l(320, 200, true, [1, 2, 3, 4]);
    const still = parseWebp(riff([['VP8L', payload]], 0xee));
    expect([still.width, still.height, still.hasAlpha]).toEqual([320, 200, true]);
    expect(still.data).toEqual(Uint8Array.from([...ascii('VP8L'), ...le(9, 4), ...payload, 0]));
    expect(parseWebp(riff([['VP8L', vp8l(16384, 1, false, [])]])).hasAlpha).toBe(false);
    expect(parseWebp(riff([['VP8L', vp8l(16384, 1, false, [])]])).width).toBe(16384);
  });

  it('reads a lossy still: the 14-bit size from the frame header', () => {
    const still = parseWebp(riff([['VP8 ', vp8(0xc000 | 640, 0x4000 | 480, [9, 9])]]));
    expect([still.width, still.height, still.hasAlpha]).toEqual([640, 480, false]);
    expect(chunkIds(still.data)).toEqual([['VP8 ', Array.from(vp8(0xc000 | 640, 0x4000 | 480, [9, 9]))]]);
  });

  it('keeps only ALPH and image chunks of an extended still, sized by VP8X', () => {
    const alph = Uint8Array.of(0, 7, 7);
    const image = vp8(64, 48, [5]);
    const still = parseWebp(
      riff([
        ['VP8X', vp8x(0x10 | 0x20, 30, 20)],
        ['ICCP', Uint8Array.of(1, 2, 3)],
        ['ALPH', alph],
        ['VP8 ', image],
        ['EXIF', Uint8Array.of(4)],
      ]),
    );
    expect([still.width, still.height, still.hasAlpha]).toEqual([30, 20, true]);
    expect(chunkIds(still.data)).toEqual([
      ['ALPH', [0, 7, 7]],
      ['VP8 ', Array.from(image)],
    ]);
    expect(still.data.length % 2).toBe(0);
  });

  it('takes alpha from an ALPH chunk when the VP8X flag is off', () => {
    const still = parseWebp(
      riff([
        ['VP8X', vp8x(0, 8, 8)],
        ['ALPH', Uint8Array.of(1)],
        ['VP8 ', vp8(8, 8, [])],
      ]),
    );
    expect(still.hasAlpha).toBe(true);
  });

  it('ignores bytes after the RIFF size', () => {
    const file = riff([['VP8L', vp8l(4, 4, false, [1])]]);
    const longer = Uint8Array.from([...file, ...ascii('JUNKJUNK')]);
    expect(parseWebp(longer)).toEqual(parseWebp(file));
  });

  it('rejects files that are not WebP, truncated or without image data', () => {
    const good = riff([['VP8L', vp8l(4, 4, false, [1, 2, 3])]]);
    expect(() => parseWebp(good.subarray(0, 19))).toThrow();
    const notRiff = good.slice();
    notRiff[0] = 0x58;
    expect(() => parseWebp(notRiff)).toThrow();
    const notWebp = good.slice();
    notWebp[8] = 0x58;
    expect(() => parseWebp(notWebp)).toThrow();
    expect(() => parseWebp(good.subarray(0, good.length - 2))).toThrow();
    expect(() =>
      parseWebp(
        riff([
          ['VP8X', vp8x(0x10, 4, 4)],
          ['ALPH', Uint8Array.of(1, 2)],
        ]),
      ),
    ).toThrow();
  });
});

describe('AnimatedWebpWriter', () => {
  const lossless = (alpha: boolean, rest: number[]) => riff([['VP8L', vp8l(40, 30, alpha, rest)]]);
  const lossyWithAlpha = riff([
    ['VP8X', vp8x(0x10, 40, 30)],
    ['ALPH', Uint8Array.of(3, 3, 3)],
    ['VP8 ', vp8(40, 30, [8, 8])],
  ]);

  async function write(frames: readonly Uint8Array[], durations: readonly number[], loopCount?: number) {
    const writer = new AnimatedWebpWriter(40, 30, loopCount);
    frames.forEach((f, i) => {
      writer.addFrame(f, durations[i]);
    });
    const blob = writer.finish();
    expect(blob.type).toBe('image/webp');
    const bytes = await bytesOf(blob);
    return { bytes, webp: readAnimatedWebp(bytes) };
  }

  const expectHeader = (webp: AnimatedWebp, bytes: Uint8Array) => {
    expect(webp.riffSize).toBe(bytes.length - 8);
    expect([webp.canvasWidth, webp.canvasHeight]).toEqual([40, 30]);
    expect(webp.vp8xReserved).toBe(0);
    expect(webp.background).toBe(0);
  };

  it('writes VP8X, ANIM and one full-canvas ANMF per frame', async () => {
    const frames = [lossless(false, [1, 2, 3]), lossless(false, [4, 5]), lossyWithAlpha];
    const { bytes, webp } = await write(frames, [40, 33.4, 2.5], 3);
    expectHeader(webp, bytes);
    expect(webp.order).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF', 'ANMF']);
    expect(webp.vp8xFlags).toBe(0x02 | 0x10);
    expect(webp.loopCount).toBe(3);
    expect(webp.frames.map((f) => [f.x, f.y, f.width, f.height])).toEqual([
      [0, 0, 40, 30],
      [0, 0, 40, 30],
      [0, 0, 40, 30],
    ]);
    expect(webp.frames.map((f) => f.durationMs)).toEqual([40, 33, 3]);
    expect(webp.frames.map((f) => f.flags)).toEqual([0x02, 0x02, 0x02]);
    expect(webp.frames.map((f) => f.chunks.map((c) => c.id))).toEqual([['VP8L'], ['VP8L'], ['ALPH', 'VP8 ']]);
    expect(Array.from(webp.frames[1].chunks[0].payload)).toEqual(Array.from(vp8l(40, 30, false, [4, 5])));
    expect(Array.from(webp.frames[2].chunks[0].payload)).toEqual([3, 3, 3]);
  });

  it('sets only the animation flag and loops forever by default when no frame has alpha', async () => {
    const { bytes, webp } = await write([lossless(false, [1]), lossless(false, [2, 2])], [100, 100]);
    expectHeader(webp, bytes);
    expect(webp.vp8xFlags).toBe(0x02);
    expect(webp.loopCount).toBe(0);
  });

  it('sets the alpha flag for a lossless frame with the alpha bit', async () => {
    const { webp } = await write([lossless(false, [1]), lossless(true, [2])], [10, 10]);
    expect(webp.vp8xFlags).toBe(0x12);
  });

  it('clamps frame durations to 1..0xffffff milliseconds', async () => {
    const frame = lossless(false, [1]);
    const { webp } = await write([frame, frame, frame, frame], [0, -20, 0.4, 1e9]);
    expect(webp.frames.map((f) => f.durationMs)).toEqual([1, 1, 1, 0xffffff]);
  });

  it('writes a valid file without frames', async () => {
    const { bytes, webp } = await write([], []);
    expectHeader(webp, bytes);
    expect(webp.riffSize).toBe(36);
    expect(webp.order).toEqual(['VP8X', 'ANIM']);
  });

  it('rejects a frame of another size', () => {
    const writer = new AnimatedWebpWriter(40, 30);
    expect(() => writer.addFrame(riff([['VP8L', vp8l(40, 31, false, [1])]]), 10)).toThrow();
    expect(() => writer.addFrame(riff([['VP8 ', vp8(41, 30, [])]]), 10)).toThrow();
  });
});
