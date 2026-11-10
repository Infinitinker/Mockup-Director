/**
 * Print templates.
 *
 * Renders a PNG "bottom layer" for Photoshop / Affinity at the exact physical artwork size:
 * white artboard, bleed zone (light red), dashed trim line, dashed safe area (3 mm inside trim),
 * labeled regions (front / spine / back …) with their sizes, fold guides, disc circles and a
 * small legend. The PNG carries a pHYs chunk, so the document opens at the right print size.
 */
import type { ImageSlotDef, ParamValues, PrintTemplate, TemplateRegion } from '../core/types';
import { UserError } from '../core/errors';
import { round1 } from '../core/math';
import { resolveTemplate } from '../models/slots';
import { setPngDpi } from './exporter';

/** Safe-area inset inside the trim line, mm. */
const SAFE_MARGIN_MM = 3;
/** Pixel limits for the template canvas (WebKit canvas memory budget). */
const MAX_SIDE_PX = 12000;
const MAX_PIXELS = 60_000_000;

const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Arial, sans-serif';
const C = {
  bleed: 'rgba(235, 70, 70, 0.16)',
  trim: '#d0182f',
  safe: '#2563eb',
  fold: '#0f9d6b',
  regionTints: ['rgba(70, 120, 230, 0.07)', 'rgba(40, 170, 120, 0.07)'],
  regionBorder: 'rgba(60, 70, 90, 0.35)',
  label: 'rgba(40, 48, 66, 0.55)',
  labelDim: 'rgba(40, 48, 66, 0.75)',
  nonPrint: 'rgba(110, 120, 140, 0.14)',
  hole: 'rgba(110, 120, 140, 0.30)',
  ink: '#1f2533',
};

const T = {
  bleed: 'Bleed',
  trim: 'Trim',
  safe: 'Safe area',
  fold: 'Fold',
  foldLegend: 'Fold line',
  artboard: 'Artwork size',
  inclBleed: 'incl. bleed',
  hole: 'Hole',
  hub: 'Hub area (often unprinted)',
  reduced: 'reduced from',
  hint: 'Guide layer: hide it before export.',
  tooLarge: 'Not enough memory for a print template this large. Close other tabs and try again.',
};

interface TemplateRenderResult {
  blob: Blob;
  /** Effective resolution (may be lower than requested for very large templates). */
  dpi: number;
  requestedDpi: number;
  widthPx: number;
  heightPx: number;
  template: PrintTemplate;
}

/**
 * Renders a print template PNG (guides, regions, bleed) for a slot and reports the effective dpi and
 * pixel size; null if the slot has no template. A template function that throws reaches the caller.
 * @param params current model params – needed when slot.template is a function of them.
 */
export async function renderTemplateDetailed(
  slot: ImageSlotDef,
  dpi: number,
  params: ParamValues,
): Promise<TemplateRenderResult | null> {
  const tpl = resolveTemplate(slot, params);
  if (!tpl) return null;
  const requested = Math.max(10, Math.min(2400, Number.isFinite(dpi) ? dpi : 300));
  let eff = Math.floor(effectiveDpi(tpl, requested));

  // Retry with a lower resolution if the engine refuses a canvas this big.
  for (let attempt = 0; attempt < 4; attempt++) {
    const k = eff / 25.4;
    const w = Math.max(1, Math.round(tpl.widthMm * k));
    const h = Math.max(1, Math.round(tpl.heightMm * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (g && canvas.width === w) {
      drawTemplate(g, tpl, slot, k, eff, requested, w, h);
      const raw = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      canvas.width = 0;
      canvas.height = 0;
      if (raw) {
        const blob = await setPngDpi(raw, eff);
        return { blob, dpi: eff, requestedDpi: requested, widthPx: w, heightPx: h, template: tpl };
      }
    }
    eff = Math.max(30, Math.floor(eff * 0.7));
  }
  throw new UserError(T.tooLarge);
}

/** Highest dpi ≤ requested that keeps the canvas within MAX_SIDE_PX and MAX_PIXELS. */
function effectiveDpi(tpl: PrintTemplate, requested: number): number {
  const bySide = (MAX_SIDE_PX * 25.4) / Math.max(tpl.widthMm, tpl.heightMm);
  const byArea = Math.sqrt(MAX_PIXELS / (tpl.widthMm * tpl.heightMm)) * 25.4;
  return Math.max(1, Math.min(requested, bySide, byArea));
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function drawTemplate(
  g: CanvasRenderingContext2D,
  tpl: PrintTemplate,
  slot: ImageSlotDef,
  k: number,
  dpi: number,
  requestedDpi: number,
  wPx: number,
  hPx: number,
): void {
  const d = new Draw(g, k);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, wPx, hPx);
  if (tpl.circle) drawCircleTemplate(d, tpl, tpl.circle, slot);
  else drawRectTemplate(d, tpl, slot);
  drawLegend(d, tpl, slot, dpi, requestedDpi, wPx, hPx);
}

function drawRectTemplate(d: Draw, tpl: PrintTemplate, slot: ImageSlotDef): void {
  const W = tpl.widthMm;
  const H = tpl.heightMm;
  const b = clampBleed(tpl);
  const trim = { x: b, y: b, w: W - 2 * b, h: H - 2 * b };
  const g = d.g;

  // Bleed zone: tint everything, then clear the trimmed area back to white.
  if (b > 0) {
    g.fillStyle = C.bleed;
    g.fillRect(0, 0, d.px(W), d.px(H));
    g.fillStyle = '#ffffff';
    g.fillRect(d.px(trim.x), d.px(trim.y), d.px(trim.w), d.px(trim.h));
  }

  // Regions: alternating tints + thin border.
  const regions = tpl.regions ?? [];
  regions.forEach((r, i) => {
    g.fillStyle = C.regionTints[i % C.regionTints.length];
    g.fillRect(d.px(r.xMm), d.px(r.yMm), d.px(r.wMm), d.px(r.hMm));
    d.stroke(C.regionBorder, 0.15, []);
    g.strokeRect(d.px(r.xMm), d.px(r.yMm), d.px(r.wMm), d.px(r.hMm));
  });

  // Safe area: per region (clipped to the trim box) or for the whole trim box.
  d.stroke(C.safe, 0.2, [1.6, 1.0]);
  const safeBoxes = regions.length ? regions.map((r) => intersect(r, trim)).filter(nonNull) : [trim];
  for (const r of safeBoxes) {
    const s = SAFE_MARGIN_MM;
    if (r.w > 2 * s + 0.5 && r.h > 2 * s + 0.5) d.rect(r.x + s, r.y + s, r.w - 2 * s, r.h - 2 * s);
  }

  // Fold guides.
  for (const gd of tpl.guides ?? []) drawGuide(d, gd.orientation, gd.posMm, gd.label ?? T.fold, W, H, trim);

  // Trim line (on top of everything else). Without bleed it coincides with the artboard edge,
  // so inset it by half the stroke to keep it fully visible.
  const lw = d.lineMm(0.25);
  d.stroke(C.trim, 0.25, [3, 1.5]);
  if (b > 0) d.rect(trim.x, trim.y, trim.w, trim.h);
  else d.rect(lw / 2, lw / 2, W - lw, H - lw);
  if (b > 0) {
    // Small "cut" caption in the top bleed area.
    const fs = Math.min(b * 0.6, 2.4);
    if (fs >= 0.9) {
      d.text(`${T.trim} · ${T.bleed} ${fmtMm(b)} mm`, trim.x + 2, b / 2, fs, C.trim, 'left', 'middle', 500);
    }
  }

  // Region labels (or one label for the whole template).
  // Labels show the TRIMMED (finished) size of each region and are centered on its visible part.
  if (regions.length) {
    regions.forEach((r) => {
      const v = intersect(r, trim);
      if (v) drawRegionLabel(d, { xMm: v.x, yMm: v.y, wMm: v.w, hMm: v.h, label: r.label });
    });
  } else drawRegionLabel(d, { xMm: trim.x, yMm: trim.y, wMm: trim.w, hMm: trim.h, label: slot.label });
}

function drawGuide(
  d: Draw,
  orientation: 'v' | 'h',
  pos: number,
  label: string,
  W: number,
  H: number,
  trim: { x: number; y: number; w: number; h: number },
): void {
  const g = d.g;
  d.stroke(C.fold, 0.22, [2.2, 0.8, 0.5, 0.8]); // dash-dot = fold convention
  g.beginPath();
  if (orientation === 'v') {
    g.moveTo(d.px(pos), 0);
    g.lineTo(d.px(pos), d.px(H));
  } else {
    g.moveTo(0, d.px(pos));
    g.lineTo(d.px(W), d.px(pos));
  }
  g.stroke();
  const fs = Math.max(1.4, Math.min(2.6, Math.min(W, H) * 0.014));
  if (orientation === 'v') {
    // Rotated along the line (reads bottom→top), just left of it, ending near the top.
    g.save();
    g.translate(d.px(pos - 0.5), d.px(trim.y + SAFE_MARGIN_MM + 1));
    g.rotate(-Math.PI / 2);
    d.textAt(label, 0, 0, fs, C.fold, 'right', 'bottom', 600, true);
    g.restore();
  } else {
    d.text(label, trim.x + SAFE_MARGIN_MM + 1, pos - 0.5, fs, C.fold, 'left', 'bottom', 600, true);
  }
}

/** Big centered label + size line; rotated 90° for tall narrow regions (spines). */
function drawRegionLabel(d: Draw, r: TemplateRegion): void {
  const { label } = r;
  const dims = `${fmtMm(r.wMm)} × ${fmtMm(r.hMm)} mm`;
  const maxFont = 16;
  const fitH = fitLabel(d, label, dims, r.wMm * 0.86, r.hMm * 0.8, maxFont);
  const fitV = fitLabel(d, label, dims, r.hMm * 0.86, r.wMm * 0.8, maxFont);
  const rotate = fitV > fitH * 1.3;
  const fs = rotate ? fitV : fitH;
  if (fs < 0.8) return;
  const g = d.g;
  g.save();
  g.translate(d.px(r.xMm + r.wMm / 2), d.px(r.yMm + r.hMm / 2));
  if (rotate) g.rotate(-Math.PI / 2); // spine text reads bottom→top (EU convention)
  const dimFs = fs * 0.42;
  const gap = fs * 0.25;
  const total = fs + gap + dimFs;
  // textAt() works in px of the current (translated/rotated) transform.
  d.textAt(label, 0, d.px(-total / 2 + fs * 0.5), fs, C.label, 'center', 'middle', 700);
  d.textAt(dims, 0, d.px(total / 2 - dimFs * 0.5), dimFs, C.labelDim, 'center', 'middle', 500);
  g.restore();
}

/** Largest font size (mm) for label + dims lines inside maxW × maxH. */
function fitLabel(d: Draw, label: string, dims: string, maxW: number, maxH: number, maxFont: number): number {
  if (maxW <= 0 || maxH <= 0) return 0;
  const ref = 10; // mm
  const wLabel = d.measure(label, ref, 700);
  const wDims = d.measure(dims, ref * 0.42, 500);
  const byW = (maxW / Math.max(wLabel, wDims, 1e-6)) * ref;
  const byH = maxH / (1 + 0.25 + 0.42);
  return Math.min(maxFont, byW, byH);
}

function drawCircleTemplate(
  d: Draw,
  tpl: PrintTemplate,
  circle: NonNullable<PrintTemplate['circle']>,
  slot: ImageSlotDef,
): void {
  const g = d.g;
  const W = tpl.widthMm;
  const H = tpl.heightMm;
  const cx = W / 2;
  const cy = H / 2;
  const R = circle.outerMm / 2;
  const r = Math.max(0, circle.innerMm / 2);
  const b = Math.max(0, tpl.bleedMm ?? 0);
  const TAU = Math.PI * 2;

  // Outside the printed disc (incl. bleed): non-printing tint.
  g.fillStyle = C.nonPrint;
  g.beginPath();
  g.rect(0, 0, d.px(W), d.px(H));
  g.arc(d.px(cx), d.px(cy), d.px(R + b), 0, TAU);
  g.fill('evenodd');

  // Bleed ring.
  if (b > 0) {
    g.fillStyle = C.bleed;
    g.beginPath();
    g.arc(d.px(cx), d.px(cy), d.px(R + b), 0, TAU);
    g.arc(d.px(cx), d.px(cy), d.px(R), 0, TAU);
    g.fill('evenodd');
  }

  // Hub area (clamping / stacking ring) – the inner print limit. Taken from the template when the
  // model states it (printInnerMm), otherwise the common convention (0.15 × outer, Ø 36 on a CD).
  const hubR =
    circle.printInnerMm !== undefined && circle.printInnerMm > 0
      ? Math.min(R - 1, Math.max(r, circle.printInnerMm / 2))
      : circle.outerMm >= 60
        ? Math.min(R - 5, Math.max(r + SAFE_MARGIN_MM, circle.outerMm * 0.15))
        : r + SAFE_MARGIN_MM;
  if (hubR > r) {
    g.fillStyle = C.regionTints[0];
    g.beginPath();
    g.arc(d.px(cx), d.px(cy), d.px(hubR), 0, TAU);
    g.arc(d.px(cx), d.px(cy), d.px(r), 0, TAU);
    g.fill('evenodd');
  }

  // Hole.
  if (r > 0) {
    g.fillStyle = C.hole;
    g.beginPath();
    g.arc(d.px(cx), d.px(cy), d.px(r), 0, TAU);
    g.fill();
    d.stroke(C.ink, 0.25, []);
    d.circle(cx, cy, r);
  }

  // Safe areas: 3 mm inside the outer edge, and the hub limit toward the center.
  d.stroke(C.safe, 0.2, [1.6, 1.0]);
  if (R - SAFE_MARGIN_MM > hubR) d.circle(cx, cy, R - SAFE_MARGIN_MM);
  if (hubR > r) d.circle(cx, cy, hubR);

  // Cut line.
  d.stroke(C.trim, 0.25, [3, 1.5]);
  d.circle(cx, cy, Math.min(R, Math.min(W, H) / 2 - d.lineMm(0.25) / 2));

  // Center cross.
  const arm = Math.max(r + 4, 6);
  d.stroke(C.ink, 0.15, []);
  g.beginPath();
  g.moveTo(d.px(cx - arm), d.px(cy));
  g.lineTo(d.px(cx + arm), d.px(cy));
  g.moveTo(d.px(cx), d.px(cy - arm));
  g.lineTo(d.px(cx), d.px(cy + arm));
  g.stroke();

  // Fold guides (unusual on discs, but honor them).
  for (const gd of tpl.guides ?? []) {
    drawGuide(d, gd.orientation, gd.posMm, gd.label ?? T.fold, W, H, {
      x: b,
      y: b,
      w: W - 2 * b,
      h: H - 2 * b,
    });
  }

  // Labels: slot name in the upper printable band, diameters in the lower one, hub note near it.
  const band = R - hubR;
  const name = slot.label;
  const fs = Math.min(12, band * 0.28, (R * 1.2) / Math.max(1, name.length * 0.55));
  if (fs >= 0.8) {
    d.text(name, cx, cy - hubR - band * 0.5, fs, C.label, 'center', 'middle', 700);
    const dims = `Ø ${fmtMm(circle.outerMm)} mm · ${T.hole} Ø ${fmtMm(circle.innerMm)} mm`;
    // Kept in the upper half of the lower band so it stays clear of the corner legend.
    d.text(dims, cx, cy + hubR + band * 0.4, fs * 0.42, C.labelDim, 'center', 'middle', 500);
  }
  const hubFs = Math.min(2.2, (hubR - r) * 0.22);
  if (hubR > r && hubFs >= 0.8) d.text(T.hub, cx, cy + hubR + hubFs * 1.1, hubFs, C.safe, 'center', 'middle', 500);
  if (R - SAFE_MARGIN_MM > hubR) {
    d.text(T.safe, cx, cy - R + SAFE_MARGIN_MM + 2.2, Math.min(2.2, band * 0.12), C.safe, 'center', 'middle', 500);
  }
}

function drawLegend(
  d: Draw,
  tpl: PrintTemplate,
  slot: ImageSlotDef,
  dpi: number,
  requestedDpi: number,
  wPx: number,
  hPx: number,
): void {
  const g = d.g;
  const W = tpl.widthMm;
  const H = tpl.heightMm;
  const b = clampBleed(tpl);
  // Circle templates have little free corner space – use the smallest legend there.
  const fs = tpl.circle
    ? Math.max(1.4, Math.min(2.4, Math.min(W, H) * 0.012))
    : Math.max(1.6, Math.min(3.2, Math.min(W, H) * 0.02));
  const lh = fs * 1.45;
  const sw = fs * 2.4; // swatch width

  type Item = { kind: 'bleed' | 'trim' | 'safe' | 'fold' | 'hole' | 'none'; text: string; bold?: boolean };
  const items: Item[] = [{ kind: 'none', text: slot.label, bold: true }];
  if (b > 0) items.push({ kind: 'bleed', text: `${T.bleed}: ${fmtMm(b)} mm` });
  const net = b > 0 ? `: ${fmtMm(W - 2 * b)} × ${fmtMm(H - 2 * b)} mm` : '';
  items.push({
    kind: 'trim',
    text: tpl.circle ? `${T.trim}: Ø ${fmtMm(tpl.circle.outerMm)} mm` : `${T.trim}${net}`,
  });
  items.push({ kind: 'safe', text: `${T.safe}: ${fmtMm(SAFE_MARGIN_MM)} mm` });
  if (tpl.guides?.length) items.push({ kind: 'fold', text: T.foldLegend });
  if (tpl.circle && tpl.circle.innerMm > 0)
    items.push({ kind: 'hole', text: `${T.hole}: Ø ${fmtMm(tpl.circle.innerMm)} mm` });
  const sizeTxt = `${T.artboard}: ${fmtMm(W)} × ${fmtMm(H)} mm${b > 0 ? ` (${T.inclBleed})` : ''}`;
  items.push({ kind: 'none', text: sizeTxt });
  const reduced = Math.round(dpi) < Math.round(requestedDpi) ? ` (${T.reduced} ${Math.round(requestedDpi)} dpi)` : '';
  const dpiTxt = `${Math.round(dpi)} dpi · ${wPx} × ${hPx} px${reduced}`;
  items.push({ kind: 'none', text: dpiTxt });
  items.push({ kind: 'none', text: T.hint });

  const textW = Math.max(
    ...items.map((it) => d.measure(it.text, fs, it.bold ? 700 : 500) + (it.kind === 'none' ? 0 : sw + fs * 0.6)),
  );
  const pad = fs * 0.7;
  const boxW = textW + pad * 2;
  const boxH = items.length * lh + pad * 2 - (lh - fs);
  // Bottom-left corner, inside the trim + a little air (or at the artboard corner if it doesn't fit).
  const inset = tpl.circle ? 1 : b + Math.min(SAFE_MARGIN_MM, 2);
  const x = Math.max(0.5, Math.min(inset, W - boxW - 0.5));
  const y = Math.max(0.5, H - inset - boxH);

  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.fillRect(d.px(x), d.px(y), d.px(boxW), d.px(boxH));
  d.stroke('rgba(60,70,90,0.35)', 0.12, []);
  g.strokeRect(d.px(x), d.px(y), d.px(boxW), d.px(boxH));

  items.forEach((it, i) => {
    const cyMm = y + pad + fs / 2 + i * lh;
    let tx = x + pad;
    if (it.kind !== 'none') {
      const sx = tx;
      const sy = cyMm;
      if (it.kind === 'bleed' || it.kind === 'hole') {
        g.fillStyle = it.kind === 'bleed' ? C.bleed : C.hole;
        g.fillRect(d.px(sx), d.px(sy - fs * 0.4), d.px(sw), d.px(fs * 0.8));
        if (it.kind === 'hole') {
          d.stroke(C.ink, 0.15, []);
          g.strokeRect(d.px(sx), d.px(sy - fs * 0.4), d.px(sw), d.px(fs * 0.8));
        }
      } else {
        const style =
          it.kind === 'trim'
            ? ([C.trim, 0.25, [3, 1.5]] as const)
            : it.kind === 'safe'
              ? ([C.safe, 0.2, [1.6, 1.0]] as const)
              : ([C.fold, 0.22, [2.2, 0.8, 0.5, 0.8]] as const);
        // Scale dashes down so the pattern is recognizable inside the small swatch.
        d.stroke(
          style[0],
          style[1],
          style[2].map((v) => v * Math.min(1, sw / 8)),
        );
        g.beginPath();
        g.moveTo(d.px(sx), d.px(sy));
        g.lineTo(d.px(sx + sw), d.px(sy));
        g.stroke();
      }
      tx += sw + fs * 0.6;
    }
    d.text(it.text, tx, cyMm, fs, it.bold ? C.ink : 'rgba(31,37,51,0.85)', 'left', 'middle', it.bold ? 700 : 500);
  });
}

/* ------------------------------------------------------------------ */
/* Small drawing helper working in millimeters                         */
/* ------------------------------------------------------------------ */

class Draw {
  readonly g: CanvasRenderingContext2D;
  /** px per mm */
  readonly k: number;
  constructor(g: CanvasRenderingContext2D, k: number) {
    this.g = g;
    this.k = k;
  }

  /** mm → px */
  px(mm: number): number {
    return mm * this.k;
  }

  /** A line width in mm that is never thinner than 1 px. */
  lineMm(mm: number): number {
    return Math.max(mm, 1 / this.k);
  }

  stroke(color: string, widthMm: number, dashMm: readonly number[]): void {
    this.g.strokeStyle = color;
    this.g.lineWidth = Math.max(1, widthMm * this.k);
    this.g.setLineDash(dashMm.map((v) => v * this.k));
    this.g.lineCap = 'butt';
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.g.strokeRect(this.px(x), this.px(y), this.px(w), this.px(h));
  }

  circle(cx: number, cy: number, r: number): void {
    this.g.beginPath();
    this.g.arc(this.px(cx), this.px(cy), this.px(r), 0, Math.PI * 2);
    this.g.stroke();
  }

  font(sizeMm: number, weight: number): string {
    return `${weight} ${Math.max(1, sizeMm * this.k)}px ${FONT}`;
  }

  /** Text width in mm. */
  measure(text: string, sizeMm: number, weight: number): number {
    this.g.font = this.font(sizeMm, weight);
    return this.g.measureText(text).width / this.k;
  }

  /** Text at a position in mm (absolute). */
  text(
    s: string,
    xMm: number,
    yMm: number,
    sizeMm: number,
    color: string,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    weight: number,
    backdrop = false,
  ): void {
    this.textAt(s, this.px(xMm), this.px(yMm), sizeMm, color, align, baseline, weight, backdrop);
  }

  /** Text at a position in px in the CURRENT transform (used after translate/rotate). */
  textAt(
    s: string,
    xPx: number,
    yPx: number,
    sizeMm: number,
    color: string,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    weight: number,
    backdrop = false,
  ): void {
    const g = this.g;
    g.font = this.font(sizeMm, weight);
    g.textAlign = align;
    g.textBaseline = baseline;
    if (backdrop) {
      const w = g.measureText(s).width;
      const h = sizeMm * this.k;
      const pad = h * 0.2;
      const left = align === 'center' ? xPx - w / 2 : align === 'right' || align === 'end' ? xPx - w : xPx;
      const top =
        baseline === 'middle' ? yPx - h / 2 : baseline === 'bottom' || baseline === 'alphabetic' ? yPx - h : yPx;
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(left - pad, top - pad * 0.5, w + pad * 2, h + pad);
    }
    g.fillStyle = color;
    g.fillText(s, xPx, yPx);
  }
}

/* ------------------------------------------------------------------ */
/* Utils                                                               */
/* ------------------------------------------------------------------ */

function clampBleed(tpl: PrintTemplate): number {
  // Never let the bleed swallow the whole artboard.
  const b = Math.min(tpl.bleedMm ?? 0, tpl.widthMm / 2 - 0.5, tpl.heightMm / 2 - 0.5);
  return Math.max(b, 0);
}

function intersect(
  r: TemplateRegion,
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  const x0 = Math.max(r.xMm, box.x);
  const y0 = Math.max(r.yMm, box.y);
  const x1 = Math.min(r.xMm + r.wMm, box.x + box.w);
  const y1 = Math.min(r.yMm + r.hMm, box.y + box.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function nonNull<T>(v: T | null): v is T {
  return v !== null;
}

/** mm with at most 1 decimal. */
function fmtMm(n: number): string {
  return String(round1(n));
}
