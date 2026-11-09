/**
 * Tests the ZIP writer in src/export/zip.ts by reading its archives back: names, the UTF-8 flag,
 * sizes, CRCs, header offsets, the end record, the stored data, DOS dates and the format limits.
 */
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../src/export/png';
import { sanitizeZipName, ZipLimitError, ZipWriter } from '../../src/export/zip';
import { randomBytes, randomInt, seededRandom } from '../random';
import { type ZipArchive, readZip } from './zipReader';

const FLAG_UTF8 = 0x0800;
const DATE = new Date(2024, 4, 17, 13, 45, 58);
const DOS_TIME = (13 << 11) | (45 << 5) | 29;
const DOS_DATE = ((2024 - 1980) << 9) | (5 << 5) | 17;

const utf8 = (text: string) => new TextEncoder().encode(text);

async function bytesOf(zip: ZipWriter): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await zip.finish().arrayBuffer());
}

/** Checks what every archive the writer makes must satisfy, against the files that went in. */
function expectArchive(archive: ZipArchive, files: [string, Uint8Array<ArrayBuffer>][], length: number): void {
  const { end, entries } = archive;
  expect(end).toMatchObject({ disk: 0, centralDisk: 0, entriesOnDisk: files.length, entries: files.length });
  expect(end.commentLength).toBe(0);
  expect(end.offset).toBe(length - 22);
  expect(end.centralOffset + end.centralSize).toBe(end.offset);

  let offset = 0;
  let centralSize = 0;
  expect(entries.map((e) => e.name)).toEqual(files.map(([name]) => name));
  entries.forEach((entry, i) => {
    const [name, data] = files[i];
    const nameBytes = utf8(name);
    const shared = {
      versionNeeded: 20,
      flags: FLAG_UTF8,
      method: 0,
      crc: crc32(data),
      compressedSize: data.length,
      size: data.length,
      nameBytes,
      extraLength: 0,
    };
    expect(entry.local).toMatchObject(shared);
    expect(entry.central).toMatchObject({
      ...shared,
      versionMadeBy: 20,
      commentLength: 0,
      diskStart: 0,
      internalAttributes: 0,
      externalAttributes: 0,
      localOffset: offset,
    });
    expect(entry.local.time).toBe(entry.central.time);
    expect(entry.local.date).toBe(entry.central.date);
    expect(entry.data).toEqual(data);
    offset += 30 + nameBytes.length + data.length;
    centralSize += 46 + nameBytes.length;
  });
  expect(end.centralOffset).toBe(offset);
  expect(end.centralSize).toBe(centralSize);
}

describe('sanitizeZipName', () => {
  it('makes forward-slash relative paths without empty, "." or ".." segments', () => {
    expect(sanitizeZipName('a\\b\\c.png')).toBe('a/b/c.png');
    expect(sanitizeZipName('/root//x.png')).toBe('root/x.png');
    expect(sanitizeZipName('../../etc/./passwd')).toBe('etc/passwd');
    expect(sanitizeZipName(' dir / name .png ')).toBe('dir/name .png');
  });

  it('removes control characters and keeps other Unicode', () => {
    expect(sanitizeZipName('a\u0000b\tc\u001f.png')).toBe('abc.png');
    expect(sanitizeZipName('café/日本.png')).toBe('café/日本.png');
  });

  it('falls back to "file" when nothing is left', () => {
    expect(sanitizeZipName('')).toBe('file');
    expect(sanitizeZipName('/./../')).toBe('file');
    expect(sanitizeZipName('\u0001')).toBe('file');
  });
});

describe('ZipWriter', () => {
  it('writes an empty archive as a lone end record', async () => {
    const zip = new ZipWriter();
    expect(zip.count).toBe(0);
    expect(zip.byteLength).toBe(22);
    const bytes = await bytesOf(zip);
    expect(bytes.length).toBe(22);
    expectArchive(readZip(bytes), [], 22);
    expect(readZip(bytes).end.centralOffset).toBe(0);
  });

  it('stores several entries, including an empty one and UTF-8 names', async () => {
    const files: [string, Uint8Array<ArrayBuffer>][] = [
      ['render.png', utf8('not really a PNG')],
      ['empty.txt', new Uint8Array(0)],
      ['café/żółw 日本.jpg', Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 0xff)],
    ];
    const zip = new ZipWriter();
    for (const [name, data] of files) await zip.add(name, data.slice(), DATE);
    expect(zip.count).toBe(3);
    const bytes = await bytesOf(zip);
    expect(bytes.length).toBe(zip.byteLength);
    const archive = readZip(bytes);
    expectArchive(archive, files, bytes.length);
    expect(archive.entries[2].central.nameBytes.length).toBeGreaterThan(files[2][0].length);
    expect(archive.entries[1].central.crc).toBe(0);
    expect(archive.entries[0].central.crc).toBe(crc32(utf8('not really a PNG')));
  });

  it('accepts Blobs and gives an application/zip Blob', async () => {
    const zip = new ZipWriter();
    await zip.add('a.bin', new Blob([utf8('123'), utf8('456789')]), DATE);
    const blob = zip.finish();
    expect(blob.type).toBe('application/zip');
    const archive = readZip(new Uint8Array(await blob.arrayBuffer()));
    expect(archive.entries[0].data).toEqual(utf8('123456789'));
    expect(archive.entries[0].central.crc).toBe(0xcbf43926);
  });

  it('writes the DOS time and date of the entry in local time, clamped to 1980..2107', async () => {
    const zip = new ZipWriter();
    await zip.add('now.png', new Uint8Array(1), DATE);
    await zip.add('old.png', new Uint8Array(1), new Date(1975, 2, 9, 0, 0, 1));
    await zip.add('future.png', new Uint8Array(1), new Date(2200, 11, 31, 23, 59, 59));
    const entries = readZip(await bytesOf(zip)).entries.map((e) => [e.central.time, e.central.date]);
    expect(entries).toEqual([
      [DOS_TIME, DOS_DATE],
      [0, (3 << 5) | 9],
      [(23 << 11) | (59 << 5) | 29, (127 << 9) | (12 << 5) | 31],
    ]);
  });

  it('sanitizes names and refuses one that is already in the archive', async () => {
    const zip = new ZipWriter();
    await zip.add('..\\out\\a.png', utf8('a'), DATE);
    expect(zip.has('out/a.png')).toBe(true);
    expect(zip.has('/out/./a.png')).toBe(true);
    expect(zip.has('out/b.png')).toBe(false);
    const length = zip.byteLength;
    await expect(zip.add('out/a.png', utf8('b'), DATE)).rejects.toThrow();
    expect(zip.count).toBe(1);
    expect(zip.byteLength).toBe(length);
    expect(readZip(await bytesOf(zip)).entries.map((e) => e.name)).toEqual(['out/a.png']);
  });

  it('can finish more than once and keep adding in between', async () => {
    const zip = new ZipWriter();
    await zip.add('one.txt', utf8('1'), DATE);
    const first = await bytesOf(zip);
    expect(await bytesOf(zip)).toEqual(first);
    await zip.add('two.txt', utf8('22'), DATE);
    const second = await bytesOf(zip);
    expectArchive(
      readZip(second),
      [
        ['one.txt', utf8('1')],
        ['two.txt', utf8('22')],
      ],
      second.length,
    );
  });

  it('round-trips random sets of entries', async () => {
    const random = seededRandom(0x21b);
    const letters = ['a', 'B', '7', '-', '_', 'é', 'ł', '日', '\u{1f600}'];
    for (let round = 0; round < 20; round++) {
      const files: [string, Uint8Array<ArrayBuffer>][] = [];
      const count = randomInt(random, 1, 12);
      for (let i = 0; i < count; i++) {
        const stem = Array.from({ length: randomInt(random, 1, 8) }, () => letters[randomInt(random, 0, 8)]).join('');
        files.push([`dir${i % 3}/${i}-${stem}.bin`, randomBytes(random, randomInt(random, 0, 400))]);
      }
      const zip = new ZipWriter();
      for (const [name, data] of files) await zip.add(name, data, DATE);
      const bytes = await bytesOf(zip);
      expect(bytes.length).toBe(zip.byteLength);
      expectArchive(readZip(bytes), files, bytes.length);
    }
  });
});

describe('ZipWriter limits', () => {
  /** A Blob that claims a size without holding the bytes. */
  class SizedBlob extends Blob {
    constructor(private readonly claimed: number) {
      super([]);
    }

    override get size(): number {
      return this.claimed;
    }
  }

  it('names its error', () => {
    const error = new ZipLimitError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ZipLimitError');
  });

  it('refuses an entry of 4 GB or one that would bring the archive to 4 GB, adding nothing', async () => {
    const zip = new ZipWriter();
    await zip.add('small.bin', utf8('x'), DATE);
    const length = zip.byteLength;
    await expect(zip.add('huge.bin', new SizedBlob(0xffffffff), DATE)).rejects.toBeInstanceOf(ZipLimitError);
    await expect(zip.add('big.bin', new SizedBlob(0xffffffff - 207), DATE)).rejects.toBeInstanceOf(ZipLimitError);
    expect(zip.count).toBe(1);
    expect(zip.byteLength).toBe(length);
    expect(zip.has('big.bin')).toBe(false);
    expectArchive(readZip(await bytesOf(zip)), [['small.bin', utf8('x')]], length);
  });

  it('accepts an entry that keeps the archive one byte below 4 GB', async () => {
    const zip = new ZipWriter();
    await zip.add('small.bin', utf8('x'), DATE);
    await zip.add('big.bin', new SizedBlob(0xffffffff - 208), DATE);
    expect(zip.count).toBe(2);
    expect(zip.byteLength).toBe(0xffffffff - 1);
  });

  it('refuses a name longer than 65535 bytes', async () => {
    const zip = new ZipWriter();
    await zip.add('a'.repeat(0xffff), new Uint8Array(0), DATE);
    await expect(zip.add('b'.repeat(0x10000), new Uint8Array(0), DATE)).rejects.toThrow();
    expect(zip.count).toBe(1);
  });

  it('counts the name limit in UTF-8 bytes, not characters', async () => {
    const zip = new ZipWriter();
    await zip.add(`${'é'.repeat(0x7fff)}a`, new Uint8Array(0), DATE);
    await expect(zip.add('é'.repeat(0x8000), new Uint8Array(0), DATE)).rejects.toThrow();
    expect(zip.count).toBe(1);
  });

  it('stops at 65534 entries, below the ZIP64 sentinel, and the archive stays valid', async () => {
    const zip = new ZipWriter();
    const empty = new Uint8Array(0);
    for (let i = 0; i < 0xfffe; i++) await zip.add(`${i}`, empty, DATE);
    await expect(zip.add('one-more', empty, DATE)).rejects.toBeInstanceOf(ZipLimitError);
    expect(zip.count).toBe(0xfffe);
    const bytes = await bytesOf(zip);
    const archive = readZip(bytes);
    expect(archive.end.entries).toBe(0xfffe);
    expect(archive.end.entriesOnDisk).toBe(0xfffe);
    expect(archive.entries.at(-1)?.name).toBe(`${0xfffe - 1}`);
    expect(archive.end.centralOffset + archive.end.centralSize + 22).toBe(bytes.length);
  });
});
