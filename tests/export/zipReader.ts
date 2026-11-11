/**
 * Reads a ZIP archive for the tests: the end-of-central-directory record, every central directory
 * entry, and the local header and stored data each entry points to.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

/** The end-of-central-directory record. */
export interface ZipEnd {
  /** Offset of the record in the archive. */
  offset: number;
  disk: number;
  centralDisk: number;
  entriesOnDisk: number;
  entries: number;
  centralSize: number;
  centralOffset: number;
  commentLength: number;
}

/** The fields shared by the local and the central header. */
export interface ZipHeader {
  versionNeeded: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  size: number;
  nameBytes: Uint8Array;
  extraLength: number;
}

/** The fields only the central header has. */
export interface ZipCentralHeader extends ZipHeader {
  versionMadeBy: number;
  commentLength: number;
  diskStart: number;
  internalAttributes: number;
  externalAttributes: number;
  localOffset: number;
}

/** A central directory entry, with the local header and data it points to. */
export interface ZipEntryRecord {
  /** The name decoded as UTF-8; reading throws if the bytes are not valid UTF-8. */
  name: string;
  central: ZipCentralHeader;
  local: ZipHeader;
  /** The bytes that follow the local header, `compressedSize` long. */
  data: Uint8Array;
}

/** A whole archive as read back. */
export interface ZipArchive {
  end: ZipEnd;
  entries: ZipEntryRecord[];
}

/** Reads an archive without a comment; throws when a signature or length does not fit. */
export function readZip(zip: Uint8Array): ZipArchive {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const names = new TextDecoder('utf-8', { fatal: true });
  const endOffset = zip.length - 22;
  if (endOffset < 0 || view.getUint32(endOffset, true) !== SIG_END) throw new Error('no end record at the end');
  const end: ZipEnd = {
    offset: endOffset,
    disk: view.getUint16(endOffset + 4, true),
    centralDisk: view.getUint16(endOffset + 6, true),
    entriesOnDisk: view.getUint16(endOffset + 8, true),
    entries: view.getUint16(endOffset + 10, true),
    centralSize: view.getUint32(endOffset + 12, true),
    centralOffset: view.getUint32(endOffset + 16, true),
    commentLength: view.getUint16(endOffset + 20, true),
  };

  const entries: ZipEntryRecord[] = [];
  let offset = end.centralOffset;
  for (let i = 0; i < end.entries; i++) {
    const central = readCentralHeader(zip, view, offset);
    const local = readLocalHeader(zip, view, central.localOffset);
    const dataStart = central.localOffset + 30 + local.nameBytes.length + local.extraLength;
    const dataEnd = dataStart + local.compressedSize;
    if (dataEnd > end.centralOffset) throw new Error(`data of entry ${i} runs into the central directory`);
    entries.push({ name: names.decode(central.nameBytes), central, local, data: zip.slice(dataStart, dataEnd) });
    offset += 46 + central.nameBytes.length + central.extraLength + central.commentLength;
  }
  if (offset !== end.centralOffset + end.centralSize) throw new Error('central directory size does not match');
  return { end, entries };
}

function readCentralHeader(zip: Uint8Array, view: DataView, offset: number): ZipCentralHeader {
  if (view.getUint32(offset, true) !== SIG_CENTRAL) throw new Error(`no central header at ${offset}`);
  const nameLength = view.getUint16(offset + 28, true);
  return {
    versionMadeBy: view.getUint16(offset + 4, true),
    versionNeeded: view.getUint16(offset + 6, true),
    flags: view.getUint16(offset + 8, true),
    method: view.getUint16(offset + 10, true),
    time: view.getUint16(offset + 12, true),
    date: view.getUint16(offset + 14, true),
    crc: view.getUint32(offset + 16, true),
    compressedSize: view.getUint32(offset + 20, true),
    size: view.getUint32(offset + 24, true),
    nameBytes: zip.slice(offset + 46, offset + 46 + nameLength),
    extraLength: view.getUint16(offset + 30, true),
    commentLength: view.getUint16(offset + 32, true),
    diskStart: view.getUint16(offset + 34, true),
    internalAttributes: view.getUint16(offset + 36, true),
    externalAttributes: view.getUint32(offset + 38, true),
    localOffset: view.getUint32(offset + 42, true),
  };
}

function readLocalHeader(zip: Uint8Array, view: DataView, offset: number): ZipHeader {
  if (view.getUint32(offset, true) !== SIG_LOCAL) throw new Error(`no local header at ${offset}`);
  const nameLength = view.getUint16(offset + 26, true);
  return {
    versionNeeded: view.getUint16(offset + 4, true),
    flags: view.getUint16(offset + 6, true),
    method: view.getUint16(offset + 8, true),
    time: view.getUint16(offset + 10, true),
    date: view.getUint16(offset + 12, true),
    crc: view.getUint32(offset + 14, true),
    compressedSize: view.getUint32(offset + 18, true),
    size: view.getUint32(offset + 22, true),
    nameBytes: zip.slice(offset + 30, offset + 30 + nameLength),
    extraLength: view.getUint16(offset + 28, true),
  };
}
