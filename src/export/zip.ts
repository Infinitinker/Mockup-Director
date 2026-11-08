/**
 * Minimal ZIP archive writer (PKWARE APPNOTE 6.3) used by the batch export.
 *
 *  - "store" method only (no compression – PNG / JPEG / WebP are already compressed);
 *  - CRC-32 from ./png (IEEE 802.3, the same polynomial ZIP uses);
 *  - UTF-8 file names (general purpose bit 11), DOS date / time of the moment the entry was added;
 *  - no ZIP64: the archive is limited to < 4 GB and < 65535 entries (the 0xFFFF… sentinels are never written) – add() throws ZipLimitError
 *    BEFORE the limit would be crossed, so everything added so far still forms a valid archive.
 *
 * The entry data is kept as Blobs and the final archive is assembled with `new Blob([...parts])`,
 * so no single huge ArrayBuffer has to be allocated (the engine may keep the parts on disk).
 */
import { crc32 } from './png';

/** Thrown by ZipWriter.add() when the entry would make the archive exceed the ZIP (non-ZIP64) limits. */
export class ZipLimitError extends Error {
  constructor(message = 'ZIP archive limit reached (4 GB / 65535 entries)') {
    super(message);
    this.name = 'ZipLimitError';
  }
}

interface ZipEntry {
  name: Uint8Array<ArrayBuffer>;
  data: Blob;
  crc: number;
  size: number;
  /** Offset of the local file header from the start of the archive. */
  offset: number;
  time: number;
  date: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
/** Version 2.0 (needed for UTF-8 names in practice; MS-DOS attribute compatibility). */
const VERSION = 20;
/** General purpose bit 11: file name and comment are UTF-8. */
const FLAG_UTF8 = 0x0800;
const MAX_U32 = 0xffffffff;
/**
 * 0xFFFF / 0xFFFFFFFF in the end record are the ZIP64 sentinels ("look for the ZIP64 record") –
 * readers such as 7-Zip / libarchive would then search for a record we never write. Stay below them.
 */
const MAX_ENTRIES = 0xfffe;
const MAX_NAME_BYTES = 0xffff;

/** MS-DOS time / date fields (local time, 2-second resolution, years 1980..2107). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
  const date = (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/** Make a safe relative entry name: forward slashes, no leading slash, no "." / ".." segments. */
export function sanitizeZipName(name: string): string {
  const parts = name
    .replace(/\\/g, '/')
    .split('/')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed from ZIP entry names.
    .map((p) => p.replace(/[\u0000-\u001f]/g, '').trim())
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/') || 'file';
}

export class ZipWriter {
  private entries: ZipEntry[] = [];
  private names = new Set<string>();
  /** Bytes of local headers + data written so far (= offset of the next local header). */
  private dataBytes = 0;
  /** Bytes the central directory will take. */
  private centralBytes = 0;
  private readonly encoder = new TextEncoder();

  /** Number of entries added. */
  get count(): number {
    return this.entries.length;
  }

  /** Size the archive would have if finished now. */
  get byteLength(): number {
    return this.dataBytes + this.centralBytes + END_RECORD;
  }

  /** True when an entry with this (sanitized) name exists. */
  has(name: string): boolean {
    return this.names.has(sanitizeZipName(name));
  }

  /**
   * Add a file. Names must be unique (throws otherwise).
   * @throws ZipLimitError when the archive would exceed 4 GB or 65535 entries (nothing is added).
   */
  async add(name: string, data: Blob | Uint8Array<ArrayBuffer>, date: Date = new Date()): Promise<void> {
    const clean = sanitizeZipName(name);
    if (this.names.has(clean)) throw new Error(`Duplicate ZIP entry name: ${clean}`);
    const nameBytes = this.encoder.encode(clean);
    if (nameBytes.length > MAX_NAME_BYTES) throw new Error('ZIP entry name too long');
    if (this.entries.length >= MAX_ENTRIES) throw new ZipLimitError();

    const blob = data instanceof Blob ? data : new Blob([data]);
    const size = blob.size;
    const after =
      this.dataBytes +
      LOCAL_HEADER +
      nameBytes.length +
      size +
      this.centralBytes +
      CENTRAL_HEADER +
      nameBytes.length +
      END_RECORD;
    // Every offset / size field is 32-bit; keep the WHOLE archive below the limit.
    if (size >= MAX_U32 || after >= MAX_U32) throw new ZipLimitError();

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(bytes);
    const { time, date: dosDate } = dosDateTime(date);
    this.entries.push({ name: nameBytes, data: blob, crc, size, offset: this.dataBytes, time, date: dosDate });
    this.names.add(clean);
    this.dataBytes += LOCAL_HEADER + nameBytes.length + size;
    this.centralBytes += CENTRAL_HEADER + nameBytes.length;
  }

  /** Assemble the archive. The writer can still be used afterwards (finish() again for a new Blob). */
  finish(): Blob {
    const parts: BlobPart[] = [];
    for (const e of this.entries) {
      parts.push(this.localHeader(e), e.data);
    }
    const central = new Uint8Array(this.centralBytes);
    let o = 0;
    for (const e of this.entries) {
      central.set(this.centralHeader(e), o);
      o += CENTRAL_HEADER + e.name.length;
    }
    parts.push(central, this.endRecord());
    return new Blob(parts, { type: 'application/zip' });
  }

  private localHeader(e: ZipEntry): Uint8Array<ArrayBuffer> {
    const b = new Uint8Array(LOCAL_HEADER + e.name.length);
    const v = new DataView(b.buffer);
    v.setUint32(0, SIG_LOCAL, true);
    v.setUint16(4, VERSION, true); // version needed to extract
    v.setUint16(6, FLAG_UTF8, true);
    v.setUint16(8, 0, true); // method: stored
    v.setUint16(10, e.time, true);
    v.setUint16(12, e.date, true);
    v.setUint32(14, e.crc, true);
    v.setUint32(18, e.size, true); // compressed size
    v.setUint32(22, e.size, true); // uncompressed size
    v.setUint16(26, e.name.length, true);
    v.setUint16(28, 0, true); // extra field length
    b.set(e.name, LOCAL_HEADER);
    return b;
  }

  private centralHeader(e: ZipEntry): Uint8Array<ArrayBuffer> {
    const b = new Uint8Array(CENTRAL_HEADER + e.name.length);
    const v = new DataView(b.buffer);
    v.setUint32(0, SIG_CENTRAL, true);
    v.setUint16(4, VERSION, true); // version made by (0 = MS-DOS attributes)
    v.setUint16(6, VERSION, true); // version needed to extract
    v.setUint16(8, FLAG_UTF8, true);
    v.setUint16(10, 0, true); // method: stored
    v.setUint16(12, e.time, true);
    v.setUint16(14, e.date, true);
    v.setUint32(16, e.crc, true);
    v.setUint32(20, e.size, true);
    v.setUint32(24, e.size, true);
    v.setUint16(28, e.name.length, true);
    v.setUint16(30, 0, true); // extra field length
    v.setUint16(32, 0, true); // comment length
    v.setUint16(34, 0, true); // disk number start
    v.setUint16(36, 0, true); // internal attributes
    v.setUint32(38, 0, true); // external attributes
    v.setUint32(42, e.offset, true);
    b.set(e.name, CENTRAL_HEADER);
    return b;
  }

  private endRecord(): Uint8Array<ArrayBuffer> {
    const b = new Uint8Array(END_RECORD);
    const v = new DataView(b.buffer);
    v.setUint32(0, SIG_END, true);
    v.setUint16(4, 0, true); // this disk
    v.setUint16(6, 0, true); // disk with the central directory
    v.setUint16(8, this.entries.length, true);
    v.setUint16(10, this.entries.length, true);
    v.setUint32(12, this.centralBytes, true);
    v.setUint32(16, this.dataBytes, true); // central directory offset
    v.setUint16(20, 0, true); // comment length
    return b;
  }
}
