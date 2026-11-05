/**
 * Animated WebP muxer. Every frame is encoded by the engine (canvas.toBlob('image/webp', q)) and
 * its bitstream chunks (VP8 or VP8L, plus ALPH for lossy frames with alpha) are re-wrapped into
 * one extended-format RIFF file:
 *
 *   RIFF <size> WEBP
 *     VP8X  flags (animation, alpha), canvas width-1 / height-1 (24 bit each)
 *     ANIM  background colour (BGRA), loop count (16 bit)
 *     ANMF  x/2, y/2, width-1, height-1, duration (ms) – 24 bit each – flags, then the frame's
 *           ALPH + VP8 / VP8L chunks          (one ANMF per frame)
 *
 * Chunk sizes are little-endian 32 bit; every chunk payload is padded to an even length.
 * Only the small encoded frames are kept in memory.
 */

interface ParsedFrame {
  /** ALPH / VP8 / VP8L chunks of the frame, complete with headers and padding. */
  data: Uint8Array;
  width: number;
  height: number;
  hasAlpha: boolean;
}

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Parse a still WebP file (as produced by canvas.toBlob) into its frame chunks. */
export function parseWebp(bytes: Uint8Array): ParsedFrame {
  if (bytes.length < 20 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') {
    throw new Error('Not a WebP file');
  }
  const end = Math.min(bytes.length, 8 + u32(bytes, 4));
  const keep: Uint8Array[] = [];
  let width = 0, height = 0, hasAlpha = false;
  let o = 12;
  while (o + 8 <= end) {
    const id = fourcc(bytes, o);
    const size = u32(bytes, o + 4);
    const payload = o + 8;
    if (payload + size > end) throw new Error('Truncated WebP chunk');
    const total = 8 + size + (size & 1);
    if (id === 'VP8X') {
      hasAlpha = hasAlpha || (bytes[payload] & 0x10) !== 0;
      width = u24(bytes, payload + 4) + 1;
      height = u24(bytes, payload + 7) + 1;
    } else if (id === 'ALPH') {
      hasAlpha = true;
      keep.push(chunkCopy(bytes, o, size));
    } else if (id === 'VP8 ') {
      // Frame header: 3-byte frame tag, start code 9d 01 2a, 14-bit width / height.
      if (!width && size >= 10) {
        width = (bytes[payload + 6] | (bytes[payload + 7] << 8)) & 0x3fff;
        height = (bytes[payload + 8] | (bytes[payload + 9] << 8)) & 0x3fff;
      }
      keep.push(chunkCopy(bytes, o, size));
    } else if (id === 'VP8L') {
      // Signature 0x2f, then 14 bit width-1, 14 bit height-1, 1 bit alpha_is_used, 3 bit version.
      if (size >= 5) {
        const bits = u32(bytes, payload + 1);
        if (!width) {
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
        }
        hasAlpha = hasAlpha || ((bits >>> 28) & 1) === 1;
      }
      keep.push(chunkCopy(bytes, o, size));
    }
    // ICCP / EXIF / XMP / ANIM are not needed for animation frames.
    o += total;
  }
  if (!keep.some((c) => { const id = fourcc(c, 0); return id === 'VP8 ' || id === 'VP8L'; })) {
    throw new Error('WebP without image data');
  }
  return { data: concat(keep), width, height, hasAlpha };
}

/** Copy a chunk (header + payload + padding byte). */
function chunkCopy(bytes: Uint8Array, offset: number, size: number): Uint8Array {
  const out = new Uint8Array(8 + size + (size & 1)); // padding byte stays 0
  out.set(bytes.subarray(offset, offset + 8 + size));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

class Writer {
  private readonly b: Uint8Array;
  private o = 0;
  constructor(size: number) {
    this.b = new Uint8Array(size);
  }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.b[this.o++] = s.charCodeAt(i); }
  u8(v: number) { this.b[this.o++] = v & 0xff; }
  u16(v: number) { this.u8(v); this.u8(v >>> 8); }
  u24(v: number) { this.u8(v); this.u8(v >>> 8); this.u8(v >>> 16); }
  u32(v: number) { this.u8(v); this.u8(v >>> 8); this.u8(v >>> 16); this.u8(v >>> 24); }
  bytes() { return this.b; }
}

export class AnimatedWebpWriter {
  private readonly frames: Uint8Array[] = [];
  private alpha = false;
  private bytes = 0;

  constructor(private readonly width: number, private readonly height: number, private readonly loopCount = 0) {}

  /** Add one frame (a complete still WebP file of exactly width × height). */
  addFrame(webp: Uint8Array, durationMs: number): void {
    const f = parseWebp(webp);
    if (f.width && f.height && (f.width !== this.width || f.height !== this.height)) {
      throw new Error(`WebP frame is ${f.width}×${f.height}, expected ${this.width}×${this.height}`);
    }
    this.alpha = this.alpha || f.hasAlpha;
    const anmfSize = 16 + f.data.length; // f.data is already made of even-sized chunks
    const w = new Writer(8 + 16);
    w.ascii('ANMF');
    w.u32(anmfSize);
    w.u24(0); // x / 2
    w.u24(0); // y / 2
    w.u24(this.width - 1);
    w.u24(this.height - 1);
    w.u24(Math.max(1, Math.min(0xffffff, Math.round(durationMs))));
    // Reserved (6 bits) | blending method (1 = do NOT blend – full frames replace the canvas,
    // transparent pixels included) | disposal (0 = none).
    w.u8(0x02);
    this.frames.push(w.bytes(), f.data);
    this.bytes += 8 + anmfSize;
  }

  finish(): Blob {
    const head = new Writer(12 + 18 + 14);
    const riffSize = 4 + 18 + 14 + this.bytes;
    head.ascii('RIFF');
    head.u32(riffSize);
    head.ascii('WEBP');
    head.ascii('VP8X');
    head.u32(10);
    head.u8(0x02 | (this.alpha ? 0x10 : 0)); // animation | alpha
    head.u24(0); // reserved
    head.u24(this.width - 1);
    head.u24(this.height - 1);
    head.ascii('ANIM');
    head.u32(6);
    head.u32(0); // background colour (BGRA) – transparent; viewers may ignore it
    head.u16(this.loopCount);
    const blob = new Blob([head.bytes(), ...this.frames] as BlobPart[], { type: 'image/webp' });
    this.frames.length = 0;
    return blob;
  }
}
