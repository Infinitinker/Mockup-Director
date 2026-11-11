/**
 * What kind of image some bytes are, by their first bytes before the declared type and the name, and the type
 * and bytes in a data URL. The tests pin today's behavior, quirks included.
 */
import { describe, expect, it } from 'vitest';
import { parseDataUrl, sniffMime } from '../../src/core/mime';

/** Bytes from numbers and ASCII strings, in order. */
function bytes(...parts: (number | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p);
    else for (const c of p) out.push(c.charCodeAt(0));
  }
  return new Uint8Array(out);
}

const text = (s: string) => new TextEncoder().encode(s);

describe('sniffMime', () => {
  it('knows the raster formats by their magic numbers, whatever the declared type', () => {
    expect(sniffMime(bytes(0x89, 'PNG\r\n'), 'image/jpeg')).toBe('image/png');
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0), '')).toBe('image/jpeg');
    expect(sniffMime(bytes('GIF89a'), '')).toBe('image/gif');
    expect(sniffMime(bytes('GIF87a'), '')).toBe('image/gif');
    expect(sniffMime(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '), '')).toBe('image/webp');
    expect(sniffMime(bytes('BM', 0, 0), '')).toBe('image/bmp');
    expect(sniffMime(bytes('II', 0x2a, 0x00), '')).toBe('image/tiff');
    expect(sniffMime(bytes('MM', 0x00, 0x2a), '')).toBe('image/tiff');
  });

  it('knows AVIF and HEIC by the brand of their ftyp box', () => {
    for (const brand of ['avif', 'avis']) {
      expect(sniffMime(bytes(0, 0, 0, 0x1c, 'ftyp', brand), '')).toBe('image/avif');
    }
    for (const brand of ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1']) {
      expect(sniffMime(bytes(0, 0, 0, 0x1c, 'ftyp', brand), '')).toBe('image/heic');
    }
  });

  it('lets an unknown ftyp brand fall through to the declared type', () => {
    expect(sniffMime(bytes(0, 0, 0, 0x1c, 'ftyp', 'isom'), 'video/mp4')).toBe('video/mp4');
    expect(sniffMime(bytes(0, 0, 0, 0x1c, 'ftyp', 'isom'), '')).toBe('application/octet-stream');
  });

  it('knows SVG text after a byte order mark, an XML prolog or a comment', () => {
    expect(sniffMime(bytes(0xef, 0xbb, 0xbf, '<svg xmlns="http://www.w3.org/2000/svg">'), '')).toBe('image/svg+xml');
    expect(sniffMime(text('<?xml version="1.0"?>\n<!-- logo -->\n<SVG>'), 'text/xml')).toBe('image/svg+xml');
  });

  it('takes an svg tag anywhere in the first 2048 bytes as SVG', () => {
    expect(sniffMime(text('<html><body><svg></svg></body></html>'), 'text/html')).toBe('image/svg+xml');
    expect(sniffMime(text(`${' '.repeat(2048)}<svg>`), 'text/plain')).toBe('text/plain');
  });

  it('needs whitespace or the end of the tag after <svg', () => {
    expect(sniffMime(text('<svgfoo>'), '')).toBe('application/octet-stream');
    expect(sniffMime(text('<svg\nwidth="1">'), '')).toBe('image/svg+xml');
  });

  it('does not take text with control characters as SVG', () => {
    expect(sniffMime(text('<svg>\u0001'), '')).toBe('application/octet-stream');
    expect(sniffMime(text('<svg>\u0000'), 'image/svg+xml')).toBe('image/svg+xml');
  });

  it('falls back to the declared type, lowercased', () => {
    expect(sniffMime(text('plain'), 'Image/PNG')).toBe('image/png');
  });

  it('uses the name only when there is no declared type', () => {
    expect(sniffMime(text('plain'), '', 'logo.svg')).toBe('image/svg+xml');
    expect(sniffMime(bytes(0x1f, 0x8b, 0x08), '', 'logo.SVGZ')).toBe('image/svg+xml');
    expect(sniffMime(text('plain'), 'text/plain', 'logo.svg')).toBe('text/plain');
  });

  it('gives application/octet-stream when nothing is known', () => {
    expect(sniffMime(text('plain'), '')).toBe('application/octet-stream');
    expect(sniffMime(text('plain'), '', 'notes.txt')).toBe('application/octet-stream');
    expect(sniffMime(new Uint8Array(0), '')).toBe('application/octet-stream');
  });
});

describe('parseDataUrl', () => {
  it('decodes base64, ignoring whitespace and missing padding', () => {
    expect(parseDataUrl('data:text/plain;base64,SGk=')).toEqual({ mime: 'text/plain', bytes: text('Hi') });
    expect(parseDataUrl('data:text/plain;base64,S G\nk=')).toEqual({ mime: 'text/plain', bytes: text('Hi') });
    expect(parseDataUrl('data:text/plain;base64,SGk')).toEqual({ mime: 'text/plain', bytes: text('Hi') });
  });

  it('decodes percent-encoded text as UTF-8, keeping a plus sign', () => {
    expect(parseDataUrl('data:image/svg+xml,%3Csvg%3E')).toEqual({ mime: 'image/svg+xml', bytes: text('<svg>') });
    expect(parseDataUrl('data:text/plain,%C3%A9+x')).toEqual({ mime: 'text/plain', bytes: text('é+x') });
  });

  it('drops parameters from the MIME type and lowercases it', () => {
    expect(parseDataUrl('data:image/svg+xml;charset=utf-8,<svg/>')?.mime).toBe('image/svg+xml');
    expect(parseDataUrl('data:text/plain;charset=utf-8;base64,SGk=')?.mime).toBe('text/plain');
    expect(parseDataUrl('DATA:IMAGE/PNG;BASE64,SGk=')).toEqual({ mime: 'image/png', bytes: text('Hi') });
  });

  it('gives application/octet-stream for an empty MIME type', () => {
    expect(parseDataUrl('data:,Hi')).toEqual({ mime: 'application/octet-stream', bytes: text('Hi') });
    expect(parseDataUrl('data:;base64,SGk=')).toEqual({ mime: 'application/octet-stream', bytes: text('Hi') });
  });

  it('returns null for what is not a data URL', () => {
    expect(parseDataUrl('data:text/plain')).toBeNull();
    expect(parseDataUrl('https://example.com/a,b')).toBeNull();
  });

  it('returns null for invalid base64 or percent escapes', () => {
    expect(parseDataUrl('data:image/png;base64,@@@')).toBeNull();
    expect(parseDataUrl('data:text/plain,%ZZ')).toBeNull();
    expect(parseDataUrl('data:text/plain,%E0%A4%A')).toBeNull();
  });

  it('returns bytes backed by their own ArrayBuffer', () => {
    for (const url of ['data:text/plain;base64,SGk=', 'data:text/plain,Hi']) {
      const parsed = parseDataUrl(url);
      expect(parsed?.bytes.buffer).toBeInstanceOf(ArrayBuffer);
      expect(parsed?.bytes.byteOffset).toBe(0);
      expect(parsed?.bytes.byteLength).toBe(parsed?.bytes.buffer.byteLength);
    }
  });
});
