/**
 * A strict GIF LZW decoder for the tests: reads data sub-blocks and expands the variable-length
 * codes back to pixel indices, failing on anything a conforming decoder would reject or that
 * shows the encoder out of step (codes past the table, missing end code, stray bytes).
 */

/** The data sub-blocks that follow an image or extension header. */
export interface SubBlocks {
  /** The payload of each sub-block, in order (without the size bytes). */
  blocks: Uint8Array[];
  /** Offset just after the zero-length block terminator. */
  end: number;
}

/** The result of decoding one image's LZW data. */
export interface LzwDecoded {
  indices: Uint8Array;
  /** Clear codes read, the leading one included. */
  clearCodes: number;
  /** The largest code size used, in bits. */
  largestCodeSize: number;
  /** The number of codes read, clear and end codes included. */
  codes: number;
}

const MAX_CODES = 4096;

/** Reads sub-blocks starting at `offset` up to and including the terminator. */
export function readSubBlocks(bytes: Uint8Array, offset: number): SubBlocks {
  const blocks: Uint8Array[] = [];
  let o = offset;
  for (;;) {
    if (o >= bytes.length) throw new Error(`sub-blocks at ${offset} have no terminator`);
    const size = bytes[o++];
    if (size === 0) return { blocks, end: o };
    if (o + size > bytes.length) throw new Error(`sub-block at ${o - 1} runs past the end`);
    blocks.push(bytes.slice(o, o + size));
    o += size;
  }
}

/** Joins byte arrays. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Decodes LZW `data` (the joined sub-blocks) written with `minCodeSize`. */
export function decodeLzw(minCodeSize: number, data: Uint8Array): LzwDecoded {
  if (minCodeSize < 2 || minCodeSize > 8) throw new Error(`minimum code size ${minCodeSize} is out of range`);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const prefix = new Int16Array(MAX_CODES).fill(-1);
  const suffix = new Uint8Array(MAX_CODES);
  for (let i = 0; i < clear; i++) suffix[i] = i;

  let bitPos = 0;
  let largestCodeSize = 0;
  const read = (size: number): number => {
    if (bitPos + size > data.length * 8) throw new Error('LZW data ends before the end code');
    largestCodeSize = Math.max(largestCodeSize, size);
    let value = 0;
    for (let k = 0; k < size; k++, bitPos++) {
      value |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << k;
    }
    return value;
  };
  const first = (code: number): number => {
    let c = code;
    while (prefix[c] >= 0) c = prefix[c];
    return suffix[c];
  };
  const out: number[] = [];
  const emit = (code: number, extra: number | null) => {
    const string: number[] = [];
    for (let c = code; c >= 0; c = prefix[c]) string.push(suffix[c]);
    for (let i = string.length - 1; i >= 0; i--) out.push(string[i]);
    if (extra !== null) out.push(extra);
  };

  let size = minCodeSize + 1;
  let next = end + 1;
  let previous = -1;
  let clearCodes = 0;
  let codes = 0;
  if (read(size) !== clear) throw new Error('LZW data does not start with a clear code');
  clearCodes++;
  codes++;
  for (;;) {
    const code = read(size);
    codes++;
    if (code === clear) {
      clearCodes++;
      size = minCodeSize + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;
    if (previous < 0) {
      if (code > clear) throw new Error(`first code ${code} after a clear code is not a pixel`);
      emit(code, null);
      previous = code;
      continue;
    }
    if (code > next || (code === next && next >= MAX_CODES))
      throw new Error(`code ${code} is past the table (${next})`);
    const firstByte = code === next ? first(previous) : first(code);
    if (code === next) emit(previous, firstByte);
    else emit(code, null);
    if (next < MAX_CODES) {
      prefix[next] = previous;
      suffix[next] = firstByte;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    previous = code;
  }
  const usedBytes = Math.ceil(bitPos / 8);
  if (usedBytes !== data.length) throw new Error(`${data.length - usedBytes} bytes follow the end code`);
  if (bitPos & 7 && data[usedBytes - 1] >> (bitPos & 7)) throw new Error('padding bits after the end code are set');
  return { indices: Uint8Array.from(out), clearCodes, largestCodeSize, codes };
}
