/**
 * The size in pixels from the header of PNG, JPEG, GIF (with its first frame), WebP and BMP files, built here by
 * hand: every header that is cut off, damaged or of another format has no size, and no bytes make it throw.
 */
import { describe, expect, it } from 'vitest';
import { imageSize } from '../../src/core/imageSize';
import { randomBytes, randomInt, seededRandom } from '../random';

/** Bytes from numbers and ASCII strings, in order. */
function bytes(...parts: (number | string | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p);
    else if (Array.isArray(p)) out.push(...p);
    else for (const c of p) out.push(c.charCodeAt(0));
  }
  return new Uint8Array(out);
}

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG up to the end of the IHDR's height. */
const png = (w: number, h: number) => bytes(PNG_SIGNATURE, u32be(13), 'IHDR', u32be(w), u32be(h));

/** A JPEG with an APP0 segment, `before` (whole segments), then a start of frame `sof` up to its width. */
const jpeg = (w: number, h: number, sof = 0xc0, before: number[] = []) =>
  bytes(
    0xff,
    0xd8,
    0xff,
    0xe0,
    u16be(16),
    'JFIF',
    0,
    [1, 1, 0, 0, 1, 0, 1, 0, 0],
    before,
    0xff,
    sof,
    u16be(17),
    8,
    u16be(h),
    u16be(w),
  );

/** Where a GIF's first frame lies, and how large it is. */
interface GifFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A GIF with the logical screen `w` × `h`: the header, the screen with `flags`, the bytes `blocks` (a color table,
 * extensions), then the first frame's image descriptor up to its height; the frame fills the screen by default.
 */
const gif = (
  w: number,
  h: number,
  {
    version = '89a',
    flags = 0,
    blocks = [] as number[],
    frame = { left: 0, top: 0, width: w, height: h } as GifFrame,
  } = {},
) =>
  bytes(
    `GIF${version}`,
    u16le(w),
    u16le(h),
    flags,
    0,
    0,
    blocks,
    0x2c,
    u16le(frame.left),
    u16le(frame.top),
    u16le(frame.width),
    u16le(frame.height),
  );

/** A GIF extension: its introducer, its label, then `data` in sub-blocks of at most 255 bytes, and the empty one. */
function extension(label: number, data: number[]): number[] {
  const out = [0x21, label];
  for (let i = 0; i < data.length; i += 255) {
    const part = data.slice(i, i + 255);
    out.push(part.length, ...part);
  }
  out.push(0);
  return out;
}

/** A RIFF WebP container around the first chunk `fourcc`, with `data` as the chunk's start. */
const webp = (fourcc: string, data: number[]) => bytes('RIFF', u32le(100), 'WEBP', fourcc, u32le(80), data);

/** A lossy WebP: the frame tag, the start code, then the 14-bit sizes, with scaling bits above them. */
const vp8 = (w: number, h: number) =>
  webp('VP8 ', [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(w | 0x4000), ...u16le(h | 0x8000)]);

/** A lossless WebP: the signature, then the width and height less one in 14 bits each. */
function vp8l(w: number, h: number): Uint8Array {
  const bits = (w - 1) | ((h - 1) << 14);
  return webp('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]);
}

/** An extended WebP: flags and reserved bytes, then the canvas width and height less one in 24 bits each. */
const vp8x = (w: number, h: number) => webp('VP8X', [0x10, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);

/** A BMP with a BITMAPINFOHEADER, up to its height. */
const bmp = (w: number, h: number) => bytes('BM', u32le(1000), u32le(0), u32le(54), u32le(40), u32le(w), u32le(h));

/** A BMP with the old 12-byte core header, up to its height. */
const bmpCore = (w: number, h: number) => bytes('BM', u32le(1000), u32le(0), u32le(26), u32le(12), u16le(w), u16le(h));

describe('imageSize', () => {
  it('reads the size of a PNG from its IHDR chunk', () => {
    expect(imageSize(png(20000, 15000))).toEqual({ width: 20000, height: 15000 });
    expect(imageSize(png(0x7fffffff, 1))).toEqual({ width: 0x7fffffff, height: 1 });
  });

  it('reads the size of a JPEG from its start of frame, walking the segments before it', () => {
    expect(imageSize(jpeg(4000, 3000))).toEqual({ width: 4000, height: 3000 });
    // Progressive (C2) and lossless (C3) frames too.
    expect(imageSize(jpeg(640, 480, 0xc2))).toEqual({ width: 640, height: 480 });
    expect(imageSize(jpeg(640, 480, 0xcf))).toEqual({ width: 640, height: 480 });
    // A Huffman table (C4), an arithmetic coding table (CC) and a restart marker come before the frame.
    const tables = [0xff, 0xc4, ...u16be(4), 0, 0, 0xff, 0xcc, ...u16be(4), 0, 0, 0xff, 0xd0];
    expect(imageSize(jpeg(65535, 2, 0xc0, tables))).toEqual({ width: 65535, height: 2 });
  });

  it('skips the fill bytes before a JPEG marker', () => {
    expect(imageSize(jpeg(100, 50, 0xc0, [0xff, 0xff, 0xff, 0xfe, ...u16be(3), 0]))).toEqual({
      width: 100,
      height: 50,
    });
  });

  it('finds no size in a JPEG whose image data or end comes before any frame, or whose markers are lost', () => {
    expect(imageSize(bytes(0xff, 0xd8, 0xff, 0xda, u16be(8), [0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(imageSize(bytes(0xff, 0xd8, 0xff, 0xd9))).toBeNull();
    expect(imageSize(bytes(0xff, 0xd8, 0x00, 0xc0, u16be(17), 8, u16be(10), u16be(10)))).toBeNull();
    expect(
      imageSize(bytes(0xff, 0xd8, 0xff, 0xe0, u16be(1), 0xff, 0xc0, u16be(17), 8, u16be(10), u16be(10))),
    ).toBeNull();
  });

  it('reads the logical screen of a GIF whose first frame lies in it', () => {
    expect(imageSize(gif(320, 240))).toEqual({ width: 320, height: 240 });
    expect(imageSize(gif(320, 240, { frame: { left: 10, top: 20, width: 100, height: 50 } }))).toEqual({
      width: 320,
      height: 240,
    });
    expect(imageSize(gif(65535, 65535, { version: '87a' }))).toEqual({ width: 65535, height: 65535 });
  });

  it('widens a GIF89a to its first frame, per side, where the frame reaches past the screen', () => {
    expect(imageSize(gif(100, 100, { frame: { left: 0, top: 0, width: 20000, height: 50 } }))).toEqual({
      width: 20000,
      height: 100,
    });
    expect(imageSize(gif(100, 100, { frame: { left: 65535, top: 90, width: 65535, height: 20 } }))).toEqual({
      width: 131070,
      height: 110,
    });
  });

  it('takes the first frame’s size for a GIF87a, as the decoders do', () => {
    expect(imageSize(gif(100, 100, { version: '87a', frame: { left: 5, top: 5, width: 30000, height: 40 } }))).toEqual({
      width: 30000,
      height: 40,
    });
    expect(imageSize(gif(5000, 5000, { version: '87a', frame: { left: 0, top: 0, width: 10, height: 20 } }))).toEqual({
      width: 10,
      height: 20,
    });
  });

  it('keeps the screen of a GIF whose first frame has no size', () => {
    expect(imageSize(gif(300, 200, { frame: { left: 9000, top: 0, width: 0, height: 10 } }))).toEqual({
      width: 300,
      height: 200,
    });
  });

  it('walks past the global color table and the extensions to the first frame', () => {
    const colors = new Array(3 * 256).fill(7);
    const blocks = [
      ...colors,
      ...extension(0xff, Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)).concat([3, 1, 0, 0])),
      ...extension(0xfe, new Array(600).fill(0x2c)),
      ...extension(0xf9, [4, 0, 0, 0]),
    ];
    const frame = { left: 0, top: 0, width: 40000, height: 2500 };
    expect(imageSize(gif(10, 10, { flags: 0x87, blocks, frame }))).toEqual({ width: 40000, height: 2500 });
    // A small table (2 colors) too.
    expect(imageSize(gif(10, 10, { flags: 0x80, blocks: [0, 0, 0, 1, 1, 1], frame }))).toEqual({
      width: 40000,
      height: 2500,
    });
  });

  it('finds no size in a GIF that ends, or has something other than an extension, before its first frame', () => {
    expect(imageSize(bytes('GIF89a', u16le(10), u16le(10), 0, 0, 0, 0x3b))).toBeNull();
    expect(imageSize(bytes('GIF89a', u16le(10), u16le(10), 0, 0, 0, extension(0xf9, [4, 0, 0, 0])))).toBeNull();
    expect(imageSize(bytes('GIF89a', u16le(10), u16le(10), 0, 0, 0, 0x00, 0x2c))).toBeNull();
    // The color table the flags announce is not all there.
    expect(imageSize(bytes('GIF89a', u16le(10), u16le(10), 0x87, 0, 0, new Array(100).fill(0)))).toBeNull();
  });

  it('reads the size of lossy, lossless and extended WebP', () => {
    expect(imageSize(vp8(16383, 1000))).toEqual({ width: 16383, height: 1000 });
    expect(imageSize(vp8l(16384, 16384))).toEqual({ width: 16384, height: 16384 });
    expect(imageSize(vp8l(1, 9999))).toEqual({ width: 1, height: 9999 });
    expect(imageSize(vp8x(16777216, 300))).toEqual({ width: 16777216, height: 300 });
  });

  it('finds no size in a WebP with another first chunk or a damaged one', () => {
    expect(imageSize(webp('ALPH', new Array(20).fill(0)))).toBeNull();
    const badStart = vp8(10, 10);
    badStart[23] = 0;
    expect(imageSize(badStart)).toBeNull();
    const badSignature = vp8l(10, 10);
    badSignature[20] = 0;
    expect(imageSize(badSignature)).toBeNull();
  });

  it('reads the size of a BMP, rows top-down or bottom-up, and with the old core header', () => {
    expect(imageSize(bmp(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(imageSize(bmp(1920, -1080))).toEqual({ width: 1920, height: 1080 });
    expect(imageSize(bmpCore(300, 200))).toEqual({ width: 300, height: 200 });
  });

  it('finds no size in a BMP with a header of an unknown size', () => {
    const odd = bmp(10, 10);
    odd[14] = 20;
    expect(imageSize(odd)).toBeNull();
  });

  it('finds no size when a side is zero or negative', () => {
    expect(imageSize(png(0, 100))).toBeNull();
    expect(imageSize(gif(100, 0))).toBeNull();
    expect(imageSize(jpeg(0, 0))).toBeNull();
    expect(imageSize(bmp(-5, 10))).toBeNull();
  });

  it('finds no size in a header cut off anywhere before its end', () => {
    const gifWithBlocks = gif(1, 2, { flags: 0x80, blocks: [0, 0, 0, 1, 1, 1, ...extension(0xfe, [1, 2, 3])] });
    const headers = [
      png(1, 2),
      jpeg(1, 2),
      gif(1, 2),
      gifWithBlocks,
      vp8(1, 2),
      vp8l(1, 2),
      vp8x(1, 2),
      bmp(1, 2),
      bmpCore(1, 2),
    ];
    for (const header of headers) {
      expect(imageSize(header), 'the whole header').not.toBeNull();
      for (let n = 0; n < header.length; n++) expect(imageSize(header.subarray(0, n)), `${n} bytes`).toBeNull();
    }
  });

  it('finds no size in other formats', () => {
    expect(imageSize(bytes('<svg width="20000" height="20000">'))).toBeNull();
    expect(imageSize(bytes(0, 0, 0, 0x1c, 'ftyp', 'avif', new Array(20).fill(0)))).toBeNull();
    expect(imageSize(bytes('II', 0x2a, 0, new Array(20).fill(0)))).toBeNull();
    expect(imageSize(new Uint8Array(0))).toBeNull();
  });

  it('never throws, whatever the bytes after a known signature', () => {
    const random = seededRandom(7);
    const signatures = [
      bytes(PNG_SIGNATURE),
      bytes(0xff, 0xd8),
      bytes('GIF89a'),
      bytes('RIFF', 0, 0, 0, 0, 'WEBP'),
      bytes('BM'),
    ];
    for (let i = 0; i < 2000; i++) {
      const signature = signatures[i % signatures.length];
      const tail = randomBytes(random, randomInt(random, 0, 64));
      const file = new Uint8Array(signature.length + tail.length);
      file.set(signature);
      file.set(tail, signature.length);
      expect(() => imageSize(file)).not.toThrow();
    }
  });
});
