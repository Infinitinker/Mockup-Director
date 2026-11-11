/**
 * Reads RIFF chunks and the layout of an animated WebP file for the tests. Strict: chunk sizes
 * must fit, padding bytes must be zero and the chunks must fill the RIFF size exactly.
 */

/** One chunk with its payload (without the padding byte). */
export interface RiffChunk {
  id: string;
  /** Offset of the chunk header. */
  offset: number;
  payload: Uint8Array;
}

/** One ANMF chunk. */
export interface WebpFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
  flags: number;
  /** The frame's chunks (ALPH, VP8, VP8L). */
  chunks: RiffChunk[];
}

/** An animated WebP file. */
export interface AnimatedWebp {
  /** The RIFF size field. */
  riffSize: number;
  /** Chunk ids in file order. */
  order: string[];
  vp8xFlags: number;
  /** The three reserved bytes after the VP8X flags. */
  vp8xReserved: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Background color as stored, a little-endian BGRA word. */
  background: number;
  loopCount: number;
  frames: WebpFrame[];
}

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(...b.subarray(o, o + 4));
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32 = (b: Uint8Array, o: number) => (u24(b, o) | (b[o + 3] << 24)) >>> 0;

/** Reads the chunks from `start` to exactly `end`. */
export function readChunks(bytes: Uint8Array, start: number, end: number): RiffChunk[] {
  const chunks: RiffChunk[] = [];
  let o = start;
  while (o < end) {
    if (o + 8 > end) throw new Error(`chunk header at ${o} runs past ${end}`);
    const size = u32(bytes, o + 4);
    const padded = size + (size & 1);
    if (o + 8 + padded > end) throw new Error(`chunk at ${o} runs past ${end}`);
    if (size & 1 && bytes[o + 8 + size] !== 0) throw new Error(`chunk at ${o} has a nonzero padding byte`);
    chunks.push({ id: fourcc(bytes, o), offset: o, payload: bytes.slice(o + 8, o + 8 + size) });
    o += 8 + padded;
  }
  return chunks;
}

/** Reads `bytes` as an animated WebP file. */
export function readAnimatedWebp(bytes: Uint8Array): AnimatedWebp {
  if (fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') throw new Error('not a RIFF WEBP file');
  const riffSize = u32(bytes, 4);
  if (riffSize + 8 !== bytes.length) throw new Error(`RIFF size ${riffSize} does not match ${bytes.length} bytes`);
  const chunks = readChunks(bytes, 12, bytes.length);
  const one = (id: string) => {
    const found = chunks.filter((c) => c.id === id);
    if (found.length !== 1) throw new Error(`expected one ${id} chunk, found ${found.length}`);
    return found[0].payload;
  };
  const vp8x = one('VP8X');
  const anim = one('ANIM');
  if (vp8x.length !== 10 || anim.length !== 6) throw new Error('VP8X or ANIM has the wrong size');
  const frames = chunks
    .filter((c) => c.id === 'ANMF')
    .map((c): WebpFrame => {
      const p = c.payload;
      return {
        x: u24(p, 0) * 2,
        y: u24(p, 3) * 2,
        width: u24(p, 6) + 1,
        height: u24(p, 9) + 1,
        durationMs: u24(p, 12),
        flags: p[15],
        chunks: readChunks(p, 16, p.length),
      };
    });
  return {
    riffSize,
    order: chunks.map((c) => c.id),
    vp8xFlags: vp8x[0],
    vp8xReserved: u24(vp8x, 1),
    canvasWidth: u24(vp8x, 4) + 1,
    canvasHeight: u24(vp8x, 7) + 1,
    background: u32(anim, 0),
    loopCount: u16(anim, 4),
    frames,
  };
}
