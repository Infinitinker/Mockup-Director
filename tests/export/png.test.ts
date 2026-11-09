/**
 * Tests the byte-level image helpers in src/export/png.ts: CRC-32, the pHYs chunk that sets a
 * PNG's resolution, and the JFIF density of a JPEG.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPhysChunk,
  crc32,
  dpiToPixelsPerMetre,
  isJpeg,
  isPng,
  setJpegDensity,
  setPngPhys,
} from '../../src/export/png';
import { buildPng, type ChunkSpec, crcInput, grayIdat, grayIhdr, readPngChunks } from './pngChunks';
import { randomBytes, randomInt, seededRandom } from '../random';

const ascii = (text: string) => new TextEncoder().encode(text);

/** Bytes from hex digits; spaces only group them for reading. */
const hex = (digits: string) =>
  Uint8Array.from(digits.match(/[0-9a-f]{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));

/** A bit-by-bit CRC-32 (reflected polynomial 0xEDB88320), independent of the table in the module. */
function bitwiseCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function physData(pixelsPerMeter: number, unit: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, pixelsPerMeter);
  view.setUint32(4, pixelsPerMeter);
  data[8] = unit;
  return data;
}

const IHDR: ChunkSpec = { type: 'IHDR', data: grayIhdr(3, 2) };
const TEXT: ChunkSpec = { type: 'tEXt', data: ascii('Comment\0mockup') };
const IDAT: ChunkSpec = { type: 'IDAT', data: grayIdat([Uint8Array.of(0, 128, 255), Uint8Array.of(10, 20, 30)]) };
const IEND: ChunkSpec = { type: 'IEND', data: new Uint8Array(0) };

/** A 3 x 2 grayscale PNG with a text chunk and no resolution. */
const plainPng = () => buildPng([IHDR, TEXT, IDAT, IEND], crc32);

/** The same image with the given pHYs chunks after the text chunk. */
const pngWithPhys = (...phys: Uint8Array[]) =>
  buildPng([IHDR, TEXT, ...phys.map((data) => ({ type: 'pHYs', data })), IDAT, IEND], crc32);

/** Checks every chunk's CRC and returns the chunks. */
function validChunks(png: Uint8Array) {
  const chunks = readPngChunks(png);
  for (const chunk of chunks) expect(chunk.crc, `CRC of ${chunk.type}`).toBe(crc32(crcInput(chunk)));
  return chunks;
}

describe('crc32', () => {
  it('gives the standard check values', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(ascii('IEND'))).toBe(0xae426082);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('covers only the bytes from start to end', () => {
    const bytes = ascii('xx123456789yyy');
    expect(crc32(bytes, 2, 11)).toBe(0xcbf43926);
    expect(crc32(bytes, 2)).toBe(crc32(bytes.subarray(2)));
    expect(crc32(bytes, 5, 5)).toBe(0);
  });

  it('matches a bit-by-bit CRC-32 on random data', () => {
    const random = seededRandom(0x5eed);
    for (let i = 0; i < 50; i++) {
      const bytes = randomBytes(random, randomInt(random, 0, 600));
      expect(crc32(bytes)).toBe(bitwiseCrc32(bytes));
    }
  });
});

describe('dpiToPixelsPerMetre', () => {
  it('rounds to whole pixels per meter', () => {
    expect(dpiToPixelsPerMetre(300)).toBe(11811);
    expect(dpiToPixelsPerMetre(72)).toBe(2835);
    expect(dpiToPixelsPerMetre(96)).toBe(3780);
  });

  it('never goes below 1', () => {
    expect(dpiToPixelsPerMetre(0)).toBe(1);
    expect(dpiToPixelsPerMetre(-5)).toBe(1);
    expect(dpiToPixelsPerMetre(0.01)).toBe(1);
  });
});

describe('isPng and isJpeg', () => {
  it('recognize the signatures', () => {
    const png = plainPng();
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);
    expect(isPng(png)).toBe(true);
    expect(isJpeg(png)).toBe(false);
    expect(isJpeg(jpeg)).toBe(true);
    expect(isPng(jpeg)).toBe(false);
  });

  it('reject data that is too short or has one byte wrong', () => {
    const png = plainPng();
    expect(isPng(png.subarray(0, 7))).toBe(false);
    const broken = png.slice();
    broken[3] = 0x48;
    expect(isPng(broken)).toBe(false);
    expect(isJpeg(Uint8Array.of(0xff, 0xd8, 0xff))).toBe(false);
    expect(isJpeg(Uint8Array.of(0xff, 0xd9, 0xff, 0xe0))).toBe(false);
  });
});

describe('buildPhysChunk', () => {
  it('builds a 21-byte pHYs chunk in meters with a valid CRC', () => {
    const chunk = buildPhysChunk(300);
    expect(chunk.length).toBe(21);
    const view = new DataView(chunk.buffer);
    expect(view.getUint32(0)).toBe(9);
    expect(String.fromCharCode(...chunk.subarray(4, 8))).toBe('pHYs');
    expect(chunk.subarray(8, 17)).toEqual(physData(11811, 1));
    expect(view.getUint32(17)).toBe(crc32(chunk, 4, 17));
  });
});

describe('setPngPhys', () => {
  it('inserts one pHYs chunk right after IHDR and keeps every other chunk', () => {
    const png = plainPng();
    const before = png.slice();
    const out = setPngPhys(png, 300);
    expect(png).toEqual(before);
    expect(out.length).toBe(png.length + 21);
    expect(out.subarray(0, 8)).toEqual(png.subarray(0, 8));

    const chunks = validChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'tEXt', 'IDAT', 'IEND']);
    expect(chunks[1].data).toEqual(physData(11811, 1));
    const others = chunks.filter((c) => c.type !== 'pHYs');
    expect(others.map(({ type, data, crc }) => ({ type, data, crc }))).toEqual(
      readPngChunks(png).map(({ type, data, crc }) => ({ type, data, crc })),
    );
  });

  it('replaces an existing pHYs chunk, wherever it is, instead of adding a second one', () => {
    const png = pngWithPhys(physData(1, 0));
    const out = setPngPhys(png, 150);
    expect(out.length).toBe(png.length);
    const chunks = validChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'tEXt', 'IDAT', 'IEND']);
    expect(chunks[1].data).toEqual(physData(dpiToPixelsPerMetre(150), 1));

    const late = setPngPhys(buildPng([IHDR, IDAT, { type: 'pHYs', data: physData(11811, 1) }, IEND], crc32), 150);
    const lateChunks = validChunks(late);
    expect(lateChunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(lateChunks[1].data).toEqual(physData(dpiToPixelsPerMetre(150), 1));
  });

  it('drops every old pHYs chunk', () => {
    const out = setPngPhys(pngWithPhys(physData(1, 0), physData(2, 1)), 72);
    expect(out).toEqual(setPngPhys(plainPng(), 72));
  });

  it('gives the same file when set twice as when set once with the last value', () => {
    const twice = setPngPhys(setPngPhys(plainPng(), 300), 600);
    expect(twice).toEqual(setPngPhys(plainPng(), 600));
    expect(readPngChunks(twice).filter((c) => c.type === 'pHYs')).toHaveLength(1);
  });

  it('stores every whole dpi from 1 to 2400 to within 0.02 dpi', () => {
    const png = plainPng();
    for (let dpi = 1; dpi <= 2400; dpi++) {
      const out = setPngPhys(png, dpi);
      const phys = new DataView(out.buffer, 33 + 8, 9);
      const pixelsPerMeter = phys.getUint32(0);
      expect(pixelsPerMeter).toBe(dpiToPixelsPerMetre(dpi));
      expect(phys.getUint32(4)).toBe(pixelsPerMeter);
      expect(phys.getUint8(8)).toBe(1);
      expect(Math.abs(pixelsPerMeter * 0.0254 - dpi)).toBeLessThanOrEqual(0.02);
    }
  });

  it('refuses data that is not a whole PNG with an IHDR', () => {
    const png = plainPng();
    expect(() => setPngPhys(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0), 300)).toThrow();
    expect(() => setPngPhys(png.subarray(0, png.length - 12 - 3), 300)).toThrow();
    expect(() => setPngPhys(buildPng([TEXT, IDAT, IEND], crc32), 300)).toThrow();
  });
});

describe('setJpegDensity', () => {
  /** SOI, a JFIF APP0 segment with aspect-ratio units, and EOI. */
  const jfifJpeg = () => hex('ffd8 ffe0 0010 4a46494600 0102 00 0001 0001 0000 ffd9');

  it('sets the density fields of an existing JFIF segment in dots per inch', () => {
    const jpeg = jfifJpeg();
    const out = setJpegDensity(jpeg, 300);
    expect(jpeg).toEqual(jfifJpeg());
    expect(out.length).toBe(jpeg.length);
    expect([...out.subarray(13, 18)]).toEqual([1, 0x01, 0x2c, 0x01, 0x2c]);
    expect(out.subarray(0, 13)).toEqual(jpeg.subarray(0, 13));
    expect(out.subarray(18)).toEqual(jpeg.subarray(18));
  });

  it('inserts a JFIF segment after SOI when the file starts with another segment', () => {
    const exif = hex('ffd8 ffe1 0004 4578 ffd9');
    const out = setJpegDensity(exif, 600);
    expect(out).toEqual(hex('ffd8 ffe0 0010 4a46494600 0101 01 0258 0258 0000 ffe1 0004 4578 ffd9'));
  });

  it('rounds the density and keeps it between 1 and 65535', () => {
    const density = (dpi: number) => new DataView(setJpegDensity(jfifJpeg(), dpi).buffer).getUint16(14);
    expect(density(299.6)).toBe(300);
    expect(density(0)).toBe(1);
    expect(density(100000)).toBe(65535);
  });

  it('refuses data that is not a JPEG', () => {
    expect(() => setJpegDensity(plainPng(), 300)).toThrow();
  });
});
