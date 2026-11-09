/**
 * Pure byte-level helpers for embedding a print resolution (DPI) into encoded images.
 *
 * Browsers' canvas encoders never write a resolution, so Photoshop opens such files at 72 dpi.
 * We patch the encoded bytes instead:
 *  - PNG : insert (or replace) a `pHYs` chunk right after IHDR (spec: must precede IDAT).
 *  - JPEG: set the density fields of the JFIF APP0 segment (or insert one after SOI).
 *
 * This module has NO imports and no DOM access so it can be unit-tested with plain Node.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** Standard CRC-32 (IEEE 802.3, as used by PNG / zlib) of bytes[start, end). */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const t = getCrcTable();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DPI -> pixels per metre (PNG pHYs unit 1). 300 dpi -> 11811. */
export function dpiToPixelsPerMetre(dpi: number): number {
  return Math.max(1, Math.round(dpi / 0.0254));
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}

function chunkType(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
}

/** Build a complete pHYs chunk (length + type + data + CRC = 21 bytes). */
export function buildPhysChunk(dpi: number): Uint8Array<ArrayBuffer> {
  const ppm = dpiToPixelsPerMetre(dpi);
  const c = new Uint8Array(21);
  writeU32(c, 0, 9);
  c[4] = 0x70; // p
  c[5] = 0x48; // H
  c[6] = 0x59; // Y
  c[7] = 0x73; // s
  writeU32(c, 8, ppm);
  writeU32(c, 12, ppm);
  c[16] = 1; // unit: metre
  writeU32(c, 17, crc32(c, 4, 17));
  return c;
}

/**
 * Return a copy of a PNG with its resolution set to `dpi` (any existing pHYs chunk is replaced).
 * Throws if the data is not a structurally valid PNG.
 */
export function setPngPhys(png: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  if (!isPng(png)) throw new Error('Not a PNG file');
  // Walk the chunk list; remember IHDR end and any pHYs chunks to drop.
  let o = 8;
  let ihdrEnd = -1;
  const drop: [number, number][] = [];
  while (o + 12 <= png.length) {
    const len = readU32(png, o);
    const type = chunkType(png, o);
    const end = o + 12 + len;
    if (end > png.length) throw new Error(`Truncated PNG chunk ${type}`);
    if (type === 'IHDR') ihdrEnd = end;
    else if (type === 'pHYs') drop.push([o, end]);
    o = end;
    if (type === 'IEND') break;
  }
  if (ihdrEnd < 0) throw new Error('PNG without IHDR');

  const phys = buildPhysChunk(dpi);
  const dropped = drop.reduce((s, [a, b]) => s + (b - a), 0);
  const out = new Uint8Array(png.length - dropped + phys.length);
  let w = 0;
  let r = 0;
  const copy = (from: number, to: number) => {
    out.set(png.subarray(from, to), w);
    w += to - from;
  };
  // Signature + IHDR, then our pHYs, then everything else minus old pHYs chunks.
  copy(0, ihdrEnd);
  out.set(phys, w);
  w += phys.length;
  r = ihdrEnd;
  for (const [a, b] of drop) {
    if (a > r) copy(r, a);
    r = Math.max(r, b);
  }
  copy(r, png.length);
  return out;
}

/** Read the pHYs resolution of a PNG in dpi (rounded to 0.01), or null if absent / not in metres. */
export function readPngDpi(png: Uint8Array): number | null {
  if (!isPng(png)) return null;
  let o = 8;
  while (o + 12 <= png.length) {
    const len = readU32(png, o);
    const type = chunkType(png, o);
    if (type === 'pHYs' && len === 9 && png[o + 16] === 1) {
      return Math.round(readU32(png, o + 8) * 0.0254 * 100) / 100;
    }
    if (type === 'IDAT' || type === 'IEND') return null;
    o += 12 + len;
  }
  return null;
}

/**
 * Return a copy of a JPEG with JFIF density set to `dpi` (units = dots per inch).
 * If the file has no JFIF APP0 segment as its first segment, one is inserted after SOI.
 */
export function setJpegDensity(jpeg: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  if (!isJpeg(jpeg)) throw new Error('Not a JPEG file');
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const hasJfif =
    jpeg.length > 18 &&
    jpeg[2] === 0xff &&
    jpeg[3] === 0xe0 &&
    jpeg[6] === 0x4a && // J
    jpeg[7] === 0x46 && // F
    jpeg[8] === 0x49 && // I
    jpeg[9] === 0x46 && // F
    jpeg[10] === 0x00;
  if (hasJfif) {
    const out = new Uint8Array(jpeg.length);
    out.set(jpeg);
    // APP0 layout: FFE0 len(2) "JFIF\0"(5) ver(2) units(1) Xdens(2) Ydens(2) ...
    out[13] = 1;
    out[14] = d >> 8;
    out[15] = d & 0xff;
    out[16] = d >> 8;
    out[17] = d & 0xff;
    return out;
  }
  const app0 = new Uint8Array([
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x01,
    d >> 8,
    d & 0xff,
    d >> 8,
    d & 0xff,
    0x00,
    0x00,
  ]);
  const out = new Uint8Array(jpeg.length + app0.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}
