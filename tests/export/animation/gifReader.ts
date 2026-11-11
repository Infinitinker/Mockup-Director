/**
 * Reads a GIF file into its blocks for the tests: the logical screen, color tables, application
 * and graphic control extensions and images with their LZW data decoded. Strict: unknown block
 * introducers, misplaced extensions, wrong pixel counts and bytes after the trailer all throw.
 */
import { concatBytes, decodeLzw, readSubBlocks } from './lzwDecoder';

/** A graphic control extension. */
export interface GifControl {
  disposal: number;
  userInput: boolean;
  hasTransparency: boolean;
  delayCs: number;
  transparentIndex: number;
  /** The reserved bits of the packed byte. */
  reserved: number;
}

/** An application extension, such as NETSCAPE2.0. */
export interface GifApplication {
  /** Identifier and authentication code, 11 characters. */
  identifier: string;
  blocks: Uint8Array[];
}

/** An image with its decoded pixel indices. */
export interface GifImage {
  control: GifControl | null;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Local color table (RGB triples), if the image has one. */
  localColorTable: Uint8Array | null;
  /** The packed byte of the image descriptor. */
  packed: number;
  minCodeSize: number;
  indices: Uint8Array;
  clearCodes: number;
}

/** A whole GIF file. */
export interface GifFile {
  signature: string;
  width: number;
  height: number;
  /** The packed byte of the logical screen descriptor. */
  packed: number;
  globalColorTable: Uint8Array | null;
  backgroundIndex: number;
  aspectRatio: number;
  applications: GifApplication[];
  images: GifImage[];
  /** Block kinds in file order: 'application', 'image' or 'extension:<label>'. */
  order: string[];
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** Reads `bytes` as a GIF file. */
export function readGif(bytes: Uint8Array): GifFile {
  let o = 0;
  const need = (count: number) => {
    if (o + count > bytes.length) throw new Error(`GIF ends at ${bytes.length}, needed ${count} bytes at ${o}`);
  };
  const u8 = () => {
    need(1);
    return bytes[o++];
  };
  const u16 = () => {
    need(2);
    const v = bytes[o] | (bytes[o + 1] << 8);
    o += 2;
    return v;
  };
  const table = (packed: number) => {
    const length = 3 << ((packed & 7) + 1);
    need(length);
    const t = bytes.slice(o, o + length);
    o += length;
    return t;
  };

  need(6);
  const signature = ascii(bytes, 0, 6);
  o = 6;
  const width = u16();
  const height = u16();
  const packed = u8();
  const backgroundIndex = u8();
  const aspectRatio = u8();
  const globalColorTable = packed & 0x80 ? table(packed) : null;
  const applications: GifApplication[] = [];
  const images: GifImage[] = [];
  const order: string[] = [];
  let control: GifControl | null = null;

  for (;;) {
    const introducer = u8();
    if (introducer === 0x3b) {
      if (o !== bytes.length) throw new Error(`${bytes.length - o} bytes follow the trailer`);
      if (control) throw new Error('graphic control extension without an image');
      return {
        signature,
        width,
        height,
        packed,
        globalColorTable,
        backgroundIndex,
        aspectRatio,
        applications,
        images,
        order,
      };
    }
    if (introducer === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        if (control) throw new Error('two graphic control extensions before one image');
        if (u8() !== 4) throw new Error('graphic control extension size is not 4');
        const flags = u8();
        const delayCs = u16();
        const transparentIndex = u8();
        if (u8() !== 0) throw new Error('graphic control extension has no terminator');
        control = {
          disposal: (flags >> 2) & 7,
          userInput: (flags & 2) !== 0,
          hasTransparency: (flags & 1) !== 0,
          delayCs,
          transparentIndex,
          reserved: flags >> 5,
        };
      } else if (label === 0xff) {
        if (u8() !== 11) throw new Error('application extension header size is not 11');
        need(11);
        const identifier = ascii(bytes, o, 11);
        const sub = readSubBlocks(bytes, o + 11);
        o = sub.end;
        applications.push({ identifier, blocks: sub.blocks });
        order.push('application');
      } else {
        o = readSubBlocks(bytes, o).end;
        order.push(`extension:${label.toString(16)}`);
      }
      continue;
    }
    if (introducer === 0x2c) {
      const left = u16();
      const top = u16();
      const w = u16();
      const h = u16();
      const imagePacked = u8();
      const localColorTable = imagePacked & 0x80 ? table(imagePacked) : null;
      const minCodeSize = u8();
      const sub = readSubBlocks(bytes, o);
      o = sub.end;
      const decoded = decodeLzw(minCodeSize, concatBytes(sub.blocks));
      if (decoded.indices.length !== w * h) {
        throw new Error(`image ${images.length} has ${decoded.indices.length} pixels, expected ${w * h}`);
      }
      images.push({
        control,
        left,
        top,
        width: w,
        height: h,
        localColorTable,
        packed: imagePacked,
        minCodeSize,
        indices: decoded.indices,
        clearCodes: decoded.clearCodes,
      });
      control = null;
      order.push('image');
      continue;
    }
    throw new Error(`unknown block introducer 0x${introducer.toString(16)} at ${o - 1}`);
  }
}
