/**
 * GIF LZW compression (variable-length codes, 12-bit maximum, clear code when the table is full).
 *
 * Code size rule (the classic, decoder-compatible "compress" behavior): a code is always written
 * with the CURRENT size; afterwards, if the next free code no longer fits (nextCode > 2^size - 1)
 * and size < 12, the size grows by one. After a clear code the size returns to minCodeSize + 1.
 * Output is packed LSB-first and split into data sub-blocks of at most 255 bytes, terminated by a
 * zero-length block.
 */

const MAX_CODES = 4096;

/** Reusable LZW encoder (keeps its 1M-entry string table between frames). */
export class LzwEncoder {
  /** table[prefix * 256 + byte] = code + 1 (0 = empty). */
  private readonly table = new Uint16Array(MAX_CODES * 256);
  /** Slots used since the last reset – cleared one by one instead of zeroing the whole table. */
  private readonly used = new Int32Array(MAX_CODES);
  private usedCount = 0;

  // Bit packer state.
  private buf = new Uint8Array(1 << 16);
  private len = 0;
  private acc = 0;
  private accBits = 0;

  /**
   * Compress `indices` (every value < 2^minCodeSize) and return the complete image-data payload:
   * the LZW minimum code size byte, the data sub-blocks and the block terminator.
   */
  encode(indices: Uint8Array, minCodeSize: number): Uint8Array {
    const minSize = Math.max(2, Math.min(8, minCodeSize));
    const clear = 1 << minSize;
    const eoi = clear + 1;
    this.len = 0;
    this.acc = 0;
    this.accBits = 0;
    this.reset();

    let size = minSize + 1;
    let nextCode = eoi + 1;
    const write = (code: number) => {
      this.acc |= code << this.accBits;
      this.accBits += size;
      while (this.accBits >= 8) {
        this.push(this.acc & 0xff);
        this.acc >>>= 8;
        this.accBits -= 8;
      }
    };

    write(clear);
    const n = indices.length;
    if (n > 0) {
      const table = this.table;
      let prefix = indices[0];
      for (let i = 1; i < n; i++) {
        const k = indices[i];
        const slot = prefix * 256 + k;
        const hit = table[slot];
        if (hit) {
          prefix = hit - 1;
          continue;
        }
        write(prefix);
        if (nextCode < MAX_CODES) {
          // The code becomes known to the decoder one step later – grow the size when the new
          // next code would not fit any more (see the module comment).
          table[slot] = nextCode + 1;
          this.used[this.usedCount++] = slot;
          nextCode++;
          if (nextCode > 1 << size && size < 12) size++;
        } else {
          write(clear);
          this.reset();
          nextCode = eoi + 1;
          size = minSize + 1;
        }
        prefix = k;
      }
      write(prefix);
      // The decoder adds one more entry after reading this code; keep its code size in sync.
      if (nextCode < MAX_CODES && nextCode + 1 > 1 << size && size < 12) size++;
    }
    write(eoi);
    if (this.accBits > 0) this.push(this.acc & 0xff);

    // Split into sub-blocks.
    const data = this.buf.subarray(0, this.len);
    const blocks = Math.ceil(data.length / 255);
    const out = new Uint8Array(1 + data.length + blocks + 1);
    out[0] = minSize;
    let o = 1;
    for (let i = 0; i < data.length; i += 255) {
      const chunk = Math.min(255, data.length - i);
      out[o++] = chunk;
      out.set(data.subarray(i, i + chunk), o);
      o += chunk;
    }
    out[o] = 0;
    return out;
  }

  private reset(): void {
    for (let i = 0; i < this.usedCount; i++) this.table[this.used[i]] = 0;
    this.usedCount = 0;
  }

  private push(byte: number): void {
    if (this.len >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = byte;
  }
}
