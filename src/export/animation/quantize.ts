/**
 * Colour quantisation for the GIF encoder.
 *
 *  - ColorHistogram: 5-bit-per-channel histogram (32 768 bins) that also keeps the exact colour
 *    sums per bin, so palette colours are true averages (no 5-bit banding).
 *  - buildPalette(): variance-based median cut (each split cuts the box with the largest weighted
 *    squared error at the position that minimises the error of both halves – Wu-style), followed
 *    by a few weighted k-means (Lloyd) refinement passes.
 *  - PaletteMapper: nearest palette colour with a lazily filled 6-bit lookup cache.
 *  - mapFrame(): RGB -> palette indices with Floyd–Steinberg (serpentine), ordered (Bayer 8x8)
 *    or no dithering; supports transparent and "unchanged" (kept from the previous frame) pixels.
 */

const BINS = 1 << 15;
/** Perceptual channel weights for squared distances (approximates the "redmean" metric). */
const WR = 3;
const WG = 4;
const WB = 2;

export class ColorHistogram {
  readonly count = new Float64Array(BINS);
  readonly sumR = new Float64Array(BINS);
  readonly sumG = new Float64Array(BINS);
  readonly sumB = new Float64Array(BINS);
  total = 0;

  /**
   * Add the pixels of an interleaved RGB buffer. `visible` (optional, one byte per pixel) skips
   * pixels marked 0. `step` samples every n-th pixel (large frames).
   */
  addRgb(rgb: Uint8Array, visible: Uint8Array | null, step = 1): void {
    const n = Math.floor(rgb.length / 3);
    const s = Math.max(1, Math.floor(step));
    const { count, sumR, sumG, sumB } = this;
    for (let p = 0; p < n; p += s) {
      if (visible && !visible[p]) continue;
      const r = rgb[p * 3],
        g = rgb[p * 3 + 1],
        b = rgb[p * 3 + 2];
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      count[bin] += 1;
      sumR[bin] += r;
      sumG[bin] += g;
      sumB[bin] += b;
      this.total += 1;
    }
  }
}

interface Box {
  start: number;
  end: number;
  /** Weighted squared error of the box around its mean. */
  sse: number;
}

/**
 * Build a palette of at most `maxColors` colours (interleaved RGB bytes; length = colours * 3).
 * Always returns at least one colour.
 */
export function buildPalette(hist: ColorHistogram, maxColors: number): Uint8Array {
  const max = Math.max(1, Math.min(256, Math.floor(maxColors)));
  // Collect the non-empty bins as weighted points.
  let m = 0;
  for (let i = 0; i < BINS; i++) if (hist.count[i] > 0) m++;
  if (m === 0) return new Uint8Array([0, 0, 0]);
  const pr = new Float32Array(m),
    pg = new Float32Array(m),
    pb = new Float32Array(m),
    pw = new Float64Array(m);
  for (let i = 0, k = 0; i < BINS; i++) {
    const c = hist.count[i];
    if (c <= 0) continue;
    pr[k] = hist.sumR[i] / c;
    pg[k] = hist.sumG[i] / c;
    pb[k] = hist.sumB[i] / c;
    pw[k] = c;
    k++;
  }
  if (m <= max) {
    const out = new Uint8Array(m * 3);
    for (let k = 0; k < m; k++) {
      out[k * 3] = Math.round(pr[k]);
      out[k * 3 + 1] = Math.round(pg[k]);
      out[k * 3 + 2] = Math.round(pb[k]);
    }
    return out;
  }

  const order = new Int32Array(m);
  for (let k = 0; k < m; k++) order[k] = k;

  const boxSse = (start: number, end: number): number => {
    let w = 0,
      r = 0,
      g = 0,
      b = 0,
      rr = 0,
      gg = 0,
      bb = 0;
    for (let i = start; i < end; i++) {
      const k = order[i],
        c = pw[k];
      w += c;
      r += c * pr[k];
      g += c * pg[k];
      b += c * pb[k];
      rr += c * pr[k] * pr[k];
      gg += c * pg[k] * pg[k];
      bb += c * pb[k] * pb[k];
    }
    if (w <= 0) return 0;
    return WR * (rr - (r * r) / w) + WG * (gg - (g * g) / w) + WB * (bb - (b * b) / w);
  };

  const boxes: Box[] = [{ start: 0, end: m, sse: boxSse(0, m) }];
  let prefW = new Float64Array(0),
    prefR = prefW,
    prefG = prefW,
    prefB = prefW,
    prefQ = prefW;
  while (boxes.length < max) {
    // The box with the largest error that can still be split.
    let bi = -1;
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i];
      if (bx.end - bx.start >= 2 && bx.sse > 0 && (bi < 0 || bx.sse > boxes[bi].sse)) bi = i;
    }
    if (bi < 0) break;
    const box = boxes[bi];
    const len = box.end - box.start;

    // Split axis: the channel with the largest weighted variance.
    let w = 0,
      r = 0,
      g = 0,
      b = 0,
      rr = 0,
      gg = 0,
      bb = 0;
    for (let i = box.start; i < box.end; i++) {
      const k = order[i],
        c = pw[k];
      w += c;
      r += c * pr[k];
      g += c * pg[k];
      b += c * pb[k];
      rr += c * pr[k] * pr[k];
      gg += c * pg[k] * pg[k];
      bb += c * pb[k] * pb[k];
    }
    const vr = WR * (rr - (r * r) / w),
      vg = WG * (gg - (g * g) / w),
      vb = WB * (bb - (b * b) / w);
    const axis = vr >= vg && vr >= vb ? pr : vg >= vb ? pg : pb;
    order.subarray(box.start, box.end).sort((a, c) => axis[a] - axis[c]);

    // Split position minimising SSE(left) + SSE(right) (prefix sums over the sorted points).
    if (prefW.length < len + 1) {
      prefW = new Float64Array(len + 1);
      prefR = new Float64Array(len + 1);
      prefG = new Float64Array(len + 1);
      prefB = new Float64Array(len + 1);
      prefQ = new Float64Array(len + 1);
    }
    prefW[0] = prefR[0] = prefG[0] = prefB[0] = prefQ[0] = 0;
    for (let i = 0; i < len; i++) {
      const k = order[box.start + i],
        c = pw[k];
      prefW[i + 1] = prefW[i] + c;
      prefR[i + 1] = prefR[i] + c * pr[k];
      prefG[i + 1] = prefG[i] + c * pg[k];
      prefB[i + 1] = prefB[i] + c * pb[k];
      prefQ[i + 1] = prefQ[i] + c * (WR * pr[k] * pr[k] + WG * pg[k] * pg[k] + WB * pb[k] * pb[k]);
    }
    const sseOf = (wq: number, ws: number, rs: number, gs: number, bs: number) =>
      ws > 0 ? wq - (WR * rs * rs + WG * gs * gs + WB * bs * bs) / ws : 0;
    let bestI = 1,
      best = Infinity;
    const tw = prefW[len],
      tr = prefR[len],
      tg = prefG[len],
      tb = prefB[len],
      tq = prefQ[len];
    for (let i = 1; i < len; i++) {
      const e =
        sseOf(prefQ[i], prefW[i], prefR[i], prefG[i], prefB[i]) +
        sseOf(tq - prefQ[i], tw - prefW[i], tr - prefR[i], tg - prefG[i], tb - prefB[i]);
      if (e < best) {
        best = e;
        bestI = i;
      }
    }
    const mid = box.start + bestI;
    boxes.splice(
      bi,
      1,
      { start: box.start, end: mid, sse: boxSse(box.start, mid) },
      { start: mid, end: box.end, sse: boxSse(mid, box.end) },
    );
  }

  // Box means = initial palette.
  const n = boxes.length;
  const cr = new Float64Array(n),
    cg = new Float64Array(n),
    cb = new Float64Array(n);
  boxes.forEach((bx, j) => {
    let w = 0,
      r = 0,
      g = 0,
      b = 0;
    for (let i = bx.start; i < bx.end; i++) {
      const k = order[i],
        c = pw[k];
      w += c;
      r += c * pr[k];
      g += c * pg[k];
      b += c * pb[k];
    }
    cr[j] = r / w;
    cg[j] = g / w;
    cb[j] = b / w;
  });

  // Weighted k-means refinement (a few passes are enough – the median cut start is already good).
  const assign = new Int32Array(m);
  const ar = new Float64Array(n),
    ag = new Float64Array(n),
    ab = new Float64Array(n),
    aw = new Float64Array(n);
  for (let iter = 0; iter < 3; iter++) {
    ar.fill(0);
    ag.fill(0);
    ab.fill(0);
    aw.fill(0);
    for (let k = 0; k < m; k++) {
      let bj = 0,
        bd = Infinity;
      const r = pr[k],
        g = pg[k],
        b = pb[k];
      for (let j = 0; j < n; j++) {
        const dr = r - cr[j],
          dg = g - cg[j],
          db = b - cb[j];
        const d = WR * dr * dr + WG * dg * dg + WB * db * db;
        if (d < bd) {
          bd = d;
          bj = j;
        }
      }
      assign[k] = bj;
      const c = pw[k];
      ar[bj] += c * r;
      ag[bj] += c * g;
      ab[bj] += c * b;
      aw[bj] += c;
    }
    for (let j = 0; j < n; j++) {
      if (aw[j] > 0) {
        cr[j] = ar[j] / aw[j];
        cg[j] = ag[j] / aw[j];
        cb[j] = ab[j] / aw[j];
      }
    }
  }

  const out = new Uint8Array(n * 3);
  for (let j = 0; j < n; j++) {
    out[j * 3] = Math.max(0, Math.min(255, Math.round(cr[j])));
    out[j * 3 + 1] = Math.max(0, Math.min(255, Math.round(cg[j])));
    out[j * 3 + 2] = Math.max(0, Math.min(255, Math.round(cb[j])));
  }
  return out;
}

/** Nearest palette colour with a 6-bit-per-channel lookup cache (filled lazily). */
export class PaletteMapper {
  readonly palette: Uint8Array;
  readonly size: number;
  private readonly cache = new Int16Array(1 << 18).fill(-1);

  constructor(palette: Uint8Array) {
    this.palette = palette;
    this.size = Math.floor(palette.length / 3);
  }

  nearest(r: number, g: number, b: number): number {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = this.cache[key];
    if (hit >= 0) return hit;
    // Search for the centre of the 6-bit cell, so the cached answer does not depend on which
    // colour of the cell happened to be looked up first.
    const qr = (r & ~3) + 1.5,
      qg = (g & ~3) + 1.5,
      qb = (b & ~3) + 1.5;
    const p = this.palette;
    let best = 0,
      bd = Infinity;
    for (let j = 0; j < this.size; j++) {
      const dr = qr - p[j * 3],
        dg = qg - p[j * 3 + 1],
        db = qb - p[j * 3 + 2];
      const d = WR * dr * dr + WG * dg * dg + WB * db * db;
      if (d < bd) {
        bd = d;
        best = j;
        if (d === 0) break;
      }
    }
    this.cache[key] = best;
    return best;
  }
}

export type DitherMode = 'floyd' | 'ordered' | 'none';

export interface MapFrameOptions {
  /** Interleaved RGB, width * height * 3. */
  rgb: Uint8Array;
  width: number;
  height: number;
  mapper: PaletteMapper;
  dither: DitherMode;
  /** Output indices (width * height). */
  out: Uint8Array;
  /** 0 = transparent pixel (written as `transparentIndex`). null = all visible. */
  visible?: Uint8Array | null;
  /** 1 = pixel unchanged since the previous frame (written as `transparentIndex`, no error diffusion). */
  keep?: Uint8Array | null;
  transparentIndex?: number;
}

/** Floyd–Steinberg error strength (slightly damped: less noise, less temporal "crawling"). */
const FS_STRENGTH = 0.85;
/** Ordered dithering amplitude in 0..255 units. */
const ORDERED_SPREAD = 32;
/** 8x8 Bayer matrix (values 0..63). */
const BAYER8 = new Uint8Array([
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54,
  22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29,
  53, 21,
]);

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Map an RGB frame to palette indices. */
export function mapFrame(o: MapFrameOptions): void {
  const { rgb, width: w, height: h, mapper, out } = o;
  const visible = o.visible ?? null;
  const keep = o.keep ?? null;
  const T = o.transparentIndex ?? 0;
  const pal = mapper.palette;

  if (o.dither === 'floyd') {
    let cur = new Float32Array((w + 2) * 3);
    let next = new Float32Array((w + 2) * 3);
    for (let y = 0; y < h; y++) {
      const dir = y & 1 ? -1 : 1; // serpentine
      next.fill(0);
      for (let i = 0; i < w; i++) {
        const x = dir > 0 ? i : w - 1 - i;
        const p = y * w + x;
        if ((visible && !visible[p]) || (keep && keep[p])) {
          out[p] = T;
          continue; // error is dropped at holes
        }
        const e = (x + 1) * 3;
        const r = clampByte(rgb[p * 3] + cur[e]);
        const g = clampByte(rgb[p * 3 + 1] + cur[e + 1]);
        const b = clampByte(rgb[p * 3 + 2] + cur[e + 2]);
        const idx = mapper.nearest(r, g, b);
        out[p] = idx;
        const er = (r - pal[idx * 3]) * FS_STRENGTH;
        const eg = (g - pal[idx * 3 + 1]) * FS_STRENGTH;
        const eb = (b - pal[idx * 3 + 2]) * FS_STRENGTH;
        const f = e + dir * 3; // forward neighbour
        const bk = e - dir * 3; // backward neighbour (next row)
        cur[f] += er * 0.4375;
        cur[f + 1] += eg * 0.4375;
        cur[f + 2] += eb * 0.4375;
        next[bk] += er * 0.1875;
        next[bk + 1] += eg * 0.1875;
        next[bk + 2] += eb * 0.1875;
        next[e] += er * 0.3125;
        next[e + 1] += eg * 0.3125;
        next[e + 2] += eb * 0.3125;
        next[f] += er * 0.0625;
        next[f + 1] += eg * 0.0625;
        next[f + 2] += eb * 0.0625;
      }
      const t = cur;
      cur = next;
      next = t;
    }
    return;
  }

  const ordered = o.dither === 'ordered';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if ((visible && !visible[p]) || (keep && keep[p])) {
        out[p] = T;
        continue;
      }
      let r = rgb[p * 3],
        g = rgb[p * 3 + 1],
        b = rgb[p * 3 + 2];
      if (ordered) {
        const d = ((BAYER8[((y & 7) << 3) | (x & 7)] + 0.5) / 64 - 0.5) * ORDERED_SPREAD;
        r = clampByte(r + d);
        g = clampByte(g + d);
        b = clampByte(b + d);
      }
      out[p] = mapper.nearest(r, g, b);
    }
  }
}
