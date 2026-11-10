/**
 * What kind of image some bytes are: the MIME type from their first bytes (`sniffMime`), and the type and bytes
 * a data URL holds (`parseDataUrl`).
 */

/** Parse a data: URL into bytes (base64 or percent-encoded). */
export function parseDataUrl(url: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const m = /^data:([^,]*?),/i.exec(url);
  if (!m) return null;
  const meta = m[1];
  const body = url.slice(m[0].length);
  const isB64 = /;base64$/i.test(meta);
  const mime = (meta.replace(/;base64$/i, '').split(';')[0] || 'application/octet-stream').toLowerCase();
  try {
    if (isB64) {
      const bin = atob(body.replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { mime, bytes };
    }
    const enc = new TextEncoder().encode(decodeURIComponent(body));
    const bytes = new Uint8Array(enc.length);
    bytes.set(enc);
    return { mime, bytes };
  } catch {
    return null;
  }
}

/**
 * Determine the real MIME type from magic bytes (file.type is often empty or wrong,
 * e.g. files without extension or from some file pickers). Falls back to the declared type.
 */
export function sniffMime(b: Uint8Array, declared: string, name = ''): string {
  const at = (o: number, ...v: number[]) => v.every((x, i) => b[o + i] === x);
  const ascii = (o: number, s: string) => at(o, ...Array.from(s, (c) => c.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF8')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  if (ascii(0, 'BM')) return 'image/bmp';
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff';
  // SVG: text starting (after optional BOM / whitespace / XML prolog / comments) with <svg
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 2048)).toLowerCase();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters mark a binary file, not SVG text.
  if (/<svg[\s>]/.test(head) && !/[\x00-\x08]/.test(head)) return 'image/svg+xml';
  if (declared) return declared.toLowerCase();
  if (/\.svgz?$/i.test(name)) return 'image/svg+xml';
  return 'application/octet-stream';
}
