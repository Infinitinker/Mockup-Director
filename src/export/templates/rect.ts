/**
 * The rectangular print template: bleed, regions, safe areas, fold guides, the trim line and the region labels. The
 * fold guide is also drawn on round templates.
 */
import type { ImageSlotDef, PrintTemplate, TemplateRegion } from '../../core/types/model';
import { clampBleed, COLORS, fmtMm, SAFE_MARGIN_MM, TEXTS } from './common';
import type { Draw } from './draw';

/** Draws a rectangular template; regions are labeled with their trimmed size, or the slot when it has none. */
export function drawRectTemplate(d: Draw, tpl: PrintTemplate, slot: ImageSlotDef): void {
  const W = tpl.widthMm;
  const H = tpl.heightMm;
  const b = clampBleed(tpl);
  const trim = { x: b, y: b, w: W - 2 * b, h: H - 2 * b };
  const g = d.g;

  // Bleed zone: tint everything, then clear the trimmed area back to white.
  if (b > 0) {
    g.fillStyle = COLORS.bleed;
    g.fillRect(0, 0, d.px(W), d.px(H));
    g.fillStyle = '#ffffff';
    g.fillRect(d.px(trim.x), d.px(trim.y), d.px(trim.w), d.px(trim.h));
  }

  // Regions: alternating tints + thin border.
  const regions = tpl.regions ?? [];
  regions.forEach((r, i) => {
    g.fillStyle = COLORS.regionTints[i % COLORS.regionTints.length];
    g.fillRect(d.px(r.xMm), d.px(r.yMm), d.px(r.wMm), d.px(r.hMm));
    d.stroke(COLORS.regionBorder, 0.15, []);
    g.strokeRect(d.px(r.xMm), d.px(r.yMm), d.px(r.wMm), d.px(r.hMm));
  });

  // Safe area: per region (clipped to the trim box) or for the whole trim box.
  d.stroke(COLORS.safe, 0.2, [1.6, 1.0]);
  const safeBoxes = regions.length ? regions.map((r) => intersect(r, trim)).filter(nonNull) : [trim];
  for (const r of safeBoxes) {
    const s = SAFE_MARGIN_MM;
    if (r.w > 2 * s + 0.5 && r.h > 2 * s + 0.5) d.rect(r.x + s, r.y + s, r.w - 2 * s, r.h - 2 * s);
  }

  // Fold guides.
  for (const gd of tpl.guides ?? []) drawGuide(d, gd.orientation, gd.posMm, gd.label ?? TEXTS.fold, W, H, trim);

  // Trim line (on top of everything else). Without bleed it coincides with the artboard edge,
  // so inset it by half the stroke to keep it fully visible.
  const lw = d.lineMm(0.25);
  d.stroke(COLORS.trim, 0.25, [3, 1.5]);
  if (b > 0) d.rect(trim.x, trim.y, trim.w, trim.h);
  else d.rect(lw / 2, lw / 2, W - lw, H - lw);
  if (b > 0) {
    // Small "cut" caption in the top bleed area.
    const fs = Math.min(b * 0.6, 2.4);
    if (fs >= 0.9) {
      d.text(
        `${TEXTS.trim} · ${TEXTS.bleed} ${fmtMm(b)} mm`,
        trim.x + 2,
        b / 2,
        fs,
        COLORS.trim,
        'left',
        'middle',
        500,
      );
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

/** Draws a fold guide across the whole artboard, labeled along the line just inside the safe area. */
export function drawGuide(
  d: Draw,
  orientation: 'v' | 'h',
  pos: number,
  label: string,
  W: number,
  H: number,
  trim: { x: number; y: number; w: number; h: number },
): void {
  const g = d.g;
  d.stroke(COLORS.fold, 0.22, [2.2, 0.8, 0.5, 0.8]); // dash-dot = fold convention
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
    d.textAt(label, 0, 0, fs, COLORS.fold, 'right', 'bottom', 600, true);
    g.restore();
  } else {
    d.text(label, trim.x + SAFE_MARGIN_MM + 1, pos - 0.5, fs, COLORS.fold, 'left', 'bottom', 600, true);
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
  d.textAt(label, 0, d.px(-total / 2 + fs * 0.5), fs, COLORS.label, 'center', 'middle', 700);
  d.textAt(dims, 0, d.px(total / 2 - dimFs * 0.5), dimFs, COLORS.labelDim, 'center', 'middle', 500);
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

/** The part of a region inside a box, or null when they do not overlap. */
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
