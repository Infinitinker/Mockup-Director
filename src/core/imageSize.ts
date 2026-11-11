/**
 * The size in pixels of an image, read from the header at the start of its file without decoding it: PNG, JPEG,
 * GIF (with its first frame's descriptor), WebP and BMP. Other formats, and headers that are cut off or damaged,
 * have no size here (null).
 */

/** An image's size in pixels. */
export interface PixelSize {
  width: number;
  height: number;
}

/** The size in the header of the image file `b`, or null when the format or its header is not known. */
export function imageSize(b: Uint8Array): PixelSize | null {
  const size = pngSize(b) ?? gifSize(b) ?? webpSize(b) ?? bmpSize(b) ?? jpegSize(b);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** Bytes at `offset` equal `values` (false when the file ends before them). */
function at(b: Uint8Array, offset: number, ...values: number[]): boolean {
  return offset + values.length <= b.length && values.every((v, i) => b[offset + i] === v);
}

/** The ASCII text `s` is at `offset`. */
const ascii = (b: Uint8Array, offset: number, s: string): boolean =>
  at(b, offset, ...Array.from(s, (c) => c.charCodeAt(0)));

const u16be = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b: Uint8Array, o: number): number =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const i32le = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

/** PNG: the IHDR chunk, which comes first. */
function pngSize(b: Uint8Array): PixelSize | null {
  if (!at(b, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) || !ascii(b, 12, 'IHDR') || b.length < 24) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/**
 * GIF: the logical screen and the first frame, whose image descriptor (0x2C) is found by walking past the global
 * color table and the extension blocks. Browser decoders widen the screen when the first frame is larger, and take
 * the first frame's size for GIF87a, so the size is per side the larger of the screen and the frame's offset plus
 * its size, and for GIF87a the frame's size. A frame without a size leaves the screen's, as in the decoders.
 */
function gifSize(b: Uint8Array): PixelSize | null {
  const is87a = ascii(b, 0, 'GIF87a');
  if (!(is87a || ascii(b, 0, 'GIF89a')) || b.length < 13) return null;
  const screen = { width: u16le(b, 6), height: u16le(b, 8) };
  const flags = b[10];
  // The global color table, when there is one: 2^(n + 1) colors of 3 bytes.
  let i = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
  while (i < b.length) {
    if (b[i] === 0x2c) {
      if (i + 9 > b.length) return null;
      const width = u16le(b, i + 5);
      const height = u16le(b, i + 7);
      if (!width || !height) return screen;
      if (is87a) return { width, height };
      return {
        width: Math.max(screen.width, u16le(b, i + 1) + width),
        height: Math.max(screen.height, u16le(b, i + 3) + height),
      };
    }
    // The trailer (0x3B) or anything else but an extension (0x21): no frame to read.
    if (b[i] !== 0x21) return null;
    // An extension: its label, then data sub-blocks, each after a byte with its length, up to an empty one.
    i += 2;
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i += 1;
  }
  return null;
}

/** WebP: the first chunk, lossy (VP8), lossless (VP8L) or extended (VP8X, the canvas). */
function webpSize(b: Uint8Array): PixelSize | null {
  if (!ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null;
  if (ascii(b, 12, 'VP8 ')) {
    // The frame tag (3 bytes), the start code, then 14-bit sizes with 2 bits of scaling above them.
    if (!at(b, 23, 0x9d, 0x01, 0x2a) || b.length < 30) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, 'VP8L')) {
    // The signature byte, then the width and the height less one, 14 bits each.
    if (!at(b, 20, 0x2f) || b.length < 25) return null;
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  if (ascii(b, 12, 'VP8X')) {
    // Flags and reserved bytes (4), then the canvas width and height less one, 24 bits each.
    if (b.length < 30) return null;
    return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  }
  return null;
}

/** BMP: the info header after the 14-byte file header; a negative height means rows top-down. */
function bmpSize(b: Uint8Array): PixelSize | null {
  if (!ascii(b, 0, 'BM') || b.length < 18) return null;
  const headerSize = i32le(b, 14);
  if (headerSize === 12) {
    if (b.length < 22) return null;
    return { width: u16le(b, 18), height: u16le(b, 20) };
  }
  if (headerSize < 40 || b.length < 26) return null;
  return { width: i32le(b, 18), height: Math.abs(i32le(b, 22)) };
}

/** JPEG: the first start-of-frame segment, found by walking the segments from the start. */
function jpegSize(b: Uint8Array): PixelSize | null {
  if (!at(b, 0, 0xff, 0xd8)) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    // Any number of 0xFF fill bytes may come before a marker.
    while (b[i] === 0xff) i += 1;
    if (i >= b.length) return null;
    const marker = b[i];
    i += 1;
    // Markers without a segment: TEM, the restart markers and a repeated start of image.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // The end of the image, or the image data, before any frame.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (i + 2 > b.length) return null;
    const length = u16be(b, i);
    if (length < 2) return null;
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC): length, precision, then height and width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > b.length) return null;
      return { width: u16be(b, i + 5), height: u16be(b, i + 3) };
    }
    i += length;
  }
  return null;
}
