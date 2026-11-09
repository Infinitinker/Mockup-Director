/**
 * Animated GIF encoder (GIF89a), written from scratch – no dependency.
 *
 *  - Palette: one GLOBAL palette built from sample frames (stable colours, no flicker between
 *    frames, smaller files) or a LOCAL palette per frame; 256 colours via quantize.ts.
 *  - Dithering: Floyd–Steinberg, ordered (Bayer) or none.
 *  - Transparency (transparent background): 1-bit – pixels with alpha below the threshold become
 *    the transparent index, semi-transparent pixels above it are composited over a matte colour;
 *    every frame is a full frame with disposal method 2 (restore to background).
 *  - Opaque output with a global palette: pixels that did not change since they were last drawn
 *    are written as the transparent index and every frame is cropped to the changed rectangle
 *    (disposal method 1 = keep). This keeps static backgrounds perfectly still (no dither
 *    "crawling") and makes turntables much smaller.
 *  - LZW (lzw.ts), NETSCAPE2.0 looping extension, per-frame delays in centiseconds.
 *
 * Frames are compressed as they arrive; only the compressed bytes are kept in memory.
 */
import { ColorHistogram, PaletteMapper, buildPalette, mapFrame, type DitherMode } from './quantize';
import { LzwEncoder } from './lzw';

export interface GifEncoderOptions {
  width: number;
  height: number;
  /** Output with 1-bit transparency (pixels with alpha < alphaThreshold become transparent). */
  transparent: boolean;
  /** 1..255, default 128. */
  alphaThreshold?: number;
  /** Colour semi-transparent pixels are composited over (RGB 0..255). Default white. */
  matte?: [number, number, number];
  dither: DitherMode;
  palette: 'global' | 'frame';
  /** 0 = loop forever (default). */
  loopCount?: number;
}

/** Max colour difference (per channel) for a pixel to count as unchanged between frames. */
const KEEP_TOLERANCE = 2;
/** Histogram sampling: at most this many pixels per frame. */
const HIST_SAMPLES = 400_000;

export class GifAnimationEncoder {
  private readonly w: number;
  private readonly h: number;
  private readonly o: Required<Omit<GifEncoderOptions, 'width' | 'height'>>;
  private readonly chunks: Uint8Array[] = [];
  private readonly lzw = new LzwEncoder();
  private readonly rgb: Uint8Array;
  private readonly visible: Uint8Array | null;
  private readonly indices: Uint8Array;
  private histogram: ColorHistogram | null = null;
  private global: { mapper: PaletteMapper; table: Uint8Array; bits: number; transparentIndex: number } | null = null;
  /** Diff mode (opaque + global palette): source colour of the currently displayed pixels. */
  private shown: Uint8Array | null = null;
  private keep: Uint8Array | null = null;
  private frames = 0;
  private headerWritten = false;

  constructor(options: GifEncoderOptions) {
    this.w = Math.max(1, Math.min(65535, Math.round(options.width)));
    this.h = Math.max(1, Math.min(65535, Math.round(options.height)));
    this.o = {
      transparent: options.transparent,
      alphaThreshold: Math.max(1, Math.min(255, Math.round(options.alphaThreshold ?? 128))),
      matte: options.matte ?? [255, 255, 255],
      dither: options.dither,
      palette: options.palette,
      loopCount: Math.max(0, Math.min(65535, Math.round(options.loopCount ?? 0))),
    };
    const n = this.w * this.h;
    this.rgb = new Uint8Array(n * 3);
    this.visible = this.o.transparent ? new Uint8Array(n) : null;
    this.indices = new Uint8Array(n);
  }

  /** True when the encoder wants palette samples (global palette) before the first frame. */
  get needsPaletteSamples(): boolean {
    return this.o.palette === 'global' && !this.global;
  }

  /** Feed a sample frame (RGBA, width * height) for the global palette. */
  addPaletteSample(rgba: Uint8ClampedArray): void {
    if (!this.needsPaletteSamples) return;
    this.prepare(rgba);
    this.histogram ??= new ColorHistogram();
    this.histogram.addRgb(this.rgb, this.visible, Math.ceil((this.w * this.h) / HIST_SAMPLES));
  }

  /** Encode one frame (RGBA, width * height, un-premultiplied – as from getImageData). */
  addFrame(rgba: Uint8ClampedArray, delayCs: number): void {
    const n = this.w * this.h;
    if (rgba.length < n * 4) throw new Error('GIF frame has the wrong size');
    if (this.o.palette === 'global' && !this.global) {
      // No samples were given – build the palette from this first frame.
      if (!this.histogram) this.addPaletteSample(rgba);
      this.finishGlobalPalette();
    }
    if (!this.headerWritten) this.writeHeader();
    this.prepare(rgba);
    const delay = Math.max(0, Math.min(65535, Math.round(delayCs)));

    if (this.global) {
      const g = this.global;
      // Diff mode: only for opaque output (transparent output needs full frames + disposal 2).
      const diff = !this.o.transparent;
      let x0 = 0,
        y0 = 0,
        x1 = this.w - 1,
        y1 = this.h - 1;
      if (diff) {
        const rect = this.markUnchanged();
        if (!rect) {
          // Nothing changed: a 1x1 transparent frame keeps the timing.
          this.writeFrame(new Uint8Array([g.transparentIndex]), 0, 0, 1, 1, delay, 1, g.transparentIndex, null, g.bits);
          this.frames++;
          return;
        }
        ({ x0, y0, x1, y1 } = rect);
      }
      mapFrame({
        rgb: this.rgb,
        width: this.w,
        height: this.h,
        mapper: g.mapper,
        dither: this.o.dither,
        out: this.indices,
        visible: this.visible,
        keep: diff && this.frames > 0 ? this.keep : null,
        transparentIndex: g.transparentIndex,
      });
      if (diff) this.rememberShown();
      const sub = this.crop(x0, y0, x1, y1);
      const useTransparency = this.o.transparent || (diff && this.frames > 0);
      this.writeFrame(
        sub,
        x0,
        y0,
        x1 - x0 + 1,
        y1 - y0 + 1,
        delay,
        this.o.transparent ? 2 : 1,
        useTransparency ? g.transparentIndex : -1,
        null,
        g.bits,
      );
    } else {
      // Local palette per frame.
      const hist = new ColorHistogram();
      hist.addRgb(this.rgb, this.visible, Math.ceil(n / HIST_SAMPLES));
      const colours = this.o.transparent ? 255 : 256;
      const pal = buildPalette(hist, colours);
      const count = Math.floor(pal.length / 3);
      const transparentIndex = this.o.transparent ? count : -1;
      const bits = bitsFor(count + (this.o.transparent ? 1 : 0));
      const table = new Uint8Array((1 << bits) * 3);
      table.set(pal);
      mapFrame({
        rgb: this.rgb,
        width: this.w,
        height: this.h,
        mapper: new PaletteMapper(pal),
        dither: this.o.dither,
        out: this.indices,
        visible: this.visible,
        transparentIndex: Math.max(0, transparentIndex),
      });
      this.writeFrame(
        this.indices,
        0,
        0,
        this.w,
        this.h,
        delay,
        this.o.transparent ? 2 : 1,
        transparentIndex,
        table,
        bits,
      );
    }
    this.frames++;
  }

  /** Finish the file and return it. */
  finish(): Blob {
    if (!this.headerWritten) {
      if (this.o.palette === 'global' && !this.global) this.finishGlobalPalette();
      this.writeHeader();
    }
    this.chunks.push(new Uint8Array([0x3b])); // trailer
    const blob = new Blob(this.chunks as BlobPart[], { type: 'image/gif' });
    this.chunks.length = 0;
    return blob;
  }

  /* ---------------------------------------------------------------- */

  private finishGlobalPalette(): void {
    const hist = this.histogram ?? new ColorHistogram();
    // Opaque diff mode and transparency both need one reserved index.
    const colours = 255;
    const pal = buildPalette(hist, colours);
    const count = Math.floor(pal.length / 3);
    const transparentIndex = count; // first unused entry
    const bits = bitsFor(count + 1);
    const table = new Uint8Array((1 << bits) * 3);
    table.set(pal);
    this.global = { mapper: new PaletteMapper(pal), table, bits, transparentIndex };
    this.histogram = null;
    if (!this.o.transparent) {
      this.shown = new Uint8Array(this.w * this.h * 3);
      this.keep = new Uint8Array(this.w * this.h);
    }
  }

  /** RGBA -> matte-composited RGB + visibility mask. */
  private prepare(rgba: Uint8ClampedArray): void {
    const n = this.w * this.h;
    const rgb = this.rgb;
    const vis = this.visible;
    const thr = this.o.alphaThreshold;
    const [mr, mg, mb] = this.o.matte;
    for (let p = 0; p < n; p++) {
      const a = rgba[p * 4 + 3];
      const r = rgba[p * 4],
        g = rgba[p * 4 + 1],
        b = rgba[p * 4 + 2];
      if (vis) vis[p] = a >= thr ? 1 : 0;
      if (a === 255) {
        rgb[p * 3] = r;
        rgb[p * 3 + 1] = g;
        rgb[p * 3 + 2] = b;
      } else {
        const k = a / 255;
        rgb[p * 3] = Math.round(r * k + mr * (1 - k));
        rgb[p * 3 + 1] = Math.round(g * k + mg * (1 - k));
        rgb[p * 3 + 2] = Math.round(b * k + mb * (1 - k));
      }
    }
  }

  /** Diff mode: mark unchanged pixels in `keep`; returns the changed rectangle (null = none). */
  private markUnchanged(): { x0: number; y0: number; x1: number; y1: number } | null {
    const { w, h, rgb } = this;
    const { keep, shown } = this.diffBuffers();
    if (this.frames === 0) {
      keep.fill(0);
      return { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    }
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = p * 3;
        const same =
          Math.abs(rgb[i] - shown[i]) <= KEEP_TOLERANCE &&
          Math.abs(rgb[i + 1] - shown[i + 1]) <= KEEP_TOLERANCE &&
          Math.abs(rgb[i + 2] - shown[i + 2]) <= KEEP_TOLERANCE;
        keep[p] = same ? 1 : 0;
        if (!same) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  /** Diff mode: remember the source colour of every pixel drawn in this frame. */
  private rememberShown(): void {
    const buffers = this.diffBuffers();
    const keep = this.frames > 0 ? buffers.keep : null;
    const shown = buffers.shown;
    const rgb = this.rgb;
    const n = this.w * this.h;
    for (let p = 0; p < n; p++) {
      if (keep?.[p]) continue;
      shown[p * 3] = rgb[p * 3];
      shown[p * 3 + 1] = rgb[p * 3 + 1];
      shown[p * 3 + 2] = rgb[p * 3 + 2];
    }
  }

  /** Diff mode: the buffers made together with the global palette. */
  private diffBuffers(): { keep: Uint8Array; shown: Uint8Array } {
    const { keep, shown } = this;
    if (!keep || !shown) throw new Error('The GIF encoder used diff mode before its buffers were made.');
    return { keep, shown };
  }

  private crop(x0: number, y0: number, x1: number, y1: number): Uint8Array {
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    if (cw === this.w && ch === this.h) return this.indices;
    const out = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      const src = (y0 + y) * this.w + x0;
      out.set(this.indices.subarray(src, src + cw), y * cw);
    }
    return out;
  }

  private writeHeader(): void {
    this.headerWritten = true;
    const g = this.global;
    const head = new ByteWriter(32);
    head.ascii('GIF89a');
    head.u16(this.w);
    head.u16(this.h);
    // Global colour table flag | colour resolution (8 bits) | table size.
    head.u8(g ? 0x80 | 0x70 | (g.bits - 1) : 0x70);
    head.u8(0); // background colour index
    head.u8(0); // pixel aspect ratio
    this.chunks.push(head.bytes());
    if (g) this.chunks.push(g.table);
    // NETSCAPE2.0 application extension: loop count.
    const loop = new ByteWriter(19);
    loop.u8(0x21);
    loop.u8(0xff);
    loop.u8(0x0b);
    loop.ascii('NETSCAPE2.0');
    loop.u8(0x03);
    loop.u8(0x01);
    loop.u16(this.o.loopCount);
    loop.u8(0x00);
    this.chunks.push(loop.bytes());
  }

  /**
   * Graphic control extension + image descriptor (+ local colour table) + LZW image data.
   * transparentIndex < 0 = no transparency.
   */
  private writeFrame(
    indices: Uint8Array,
    x: number,
    y: number,
    w: number,
    h: number,
    delayCs: number,
    disposal: number,
    transparentIndex: number,
    localTable: Uint8Array | null,
    bits: number,
  ): void {
    const head = new ByteWriter(24);
    head.u8(0x21);
    head.u8(0xf9);
    head.u8(0x04);
    head.u8(((disposal & 7) << 2) | (transparentIndex >= 0 ? 1 : 0));
    head.u16(delayCs);
    head.u8(Math.max(transparentIndex, 0));
    head.u8(0x00);
    head.u8(0x2c);
    head.u16(x);
    head.u16(y);
    head.u16(w);
    head.u16(h);
    head.u8(localTable ? 0x80 | (bits - 1) : 0);
    this.chunks.push(head.bytes());
    if (localTable) this.chunks.push(localTable);
    this.chunks.push(this.lzw.encode(indices, Math.max(2, bits)));
  }
}

/** Colour table size exponent (1..8) for `count` entries. */
function bitsFor(count: number): number {
  let bits = 1;
  while (1 << bits < count && bits < 8) bits++;
  return bits;
}

class ByteWriter {
  private readonly buf: Uint8Array;
  private pos = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
  }
  u8(v: number): void {
    this.buf[this.pos++] = v & 0xff;
  }
  u16(v: number): void {
    this.u8(v);
    this.u8(v >> 8);
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}
