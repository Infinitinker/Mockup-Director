/**
 * Reads and builds PNG chunk lists for the tests: a reader that splits a PNG into its chunks
 * without trusting their CRCs, and a builder for small grayscale PNGs with valid image data.
 */

/** The 8-byte signature every PNG starts with. */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** One chunk as it is stored in the file. */
export interface PngChunk {
  type: string;
  data: Uint8Array;
  /** The CRC stored after the data. */
  crc: number;
}

/** A chunk to build: its type and data. */
export interface ChunkSpec {
  type: string;
  data: Uint8Array;
}

/** Splits a PNG into its chunks; throws when the signature is wrong or a chunk runs past the end. */
export function readPngChunks(png: Uint8Array): PngChunk[] {
  if (png.length < 8 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('no PNG signature');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error(`chunk header at ${offset} runs past the end`);
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error(`chunk at ${offset} runs past the end`);
    chunks.push({
      type: String.fromCharCode(...png.subarray(offset + 4, offset + 8)),
      data: png.slice(offset + 8, offset + 8 + length),
      crc: view.getUint32(offset + 8 + length),
    });
    offset = end;
  }
  return chunks;
}

/** The type and data bytes of a chunk, the bytes its CRC covers. */
export function crcInput(chunk: ChunkSpec): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4 + chunk.data.length);
  for (let i = 0; i < 4; i++) bytes[i] = chunk.type.charCodeAt(i);
  bytes.set(chunk.data, 4);
  return bytes;
}

/** Joins the signature and the chunks into a PNG, with each chunk's CRC from `crc`. */
export function buildPng(chunks: ChunkSpec[], crc: (bytes: Uint8Array) => number): Uint8Array<ArrayBuffer> {
  const size = chunks.reduce((sum, c) => sum + 12 + c.data.length, 8);
  const png = new Uint8Array(size);
  const view = new DataView(png.buffer);
  png.set(PNG_SIGNATURE);
  let offset = 8;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.data.length);
    const covered = crcInput(chunk);
    png.set(covered, offset + 4);
    view.setUint32(offset + 4 + covered.length, crc(covered));
    offset += 12 + chunk.data.length;
  }
  return png;
}

/** The IHDR data of an 8-bit grayscale image. */
export function grayIhdr(width: number, height: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = 8;
  return data;
}

/**
 * IDAT data for an 8-bit grayscale image: each row is filter byte 0 and its pixels, wrapped in a
 * zlib stream of one stored deflate block.
 */
export function grayIdat(rows: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array(rows.reduce((sum, r) => sum + 1 + r.length, 0));
  let offset = 0;
  for (const row of rows) {
    raw.set(row, offset + 1);
    offset += 1 + row.length;
  }
  const stream = new Uint8Array(2 + 5 + raw.length + 4);
  const view = new DataView(stream.buffer);
  stream[0] = 0x78;
  stream[1] = 0x01;
  stream[2] = 0x01;
  view.setUint16(3, raw.length, true);
  view.setUint16(5, ~raw.length & 0xffff, true);
  stream.set(raw, 7);
  view.setUint32(7 + raw.length, adler32(raw));
  return stream;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
