/**
 * The round print template of a disc: the non-printing outside, the bleed ring, the hub area, the hole, the safe
 * circles, the cut line, the center cross and the labels.
 */
import type { ImageSlotDef, PrintTemplate } from '../../core/types/model';
import { COLORS, fmtMm, SAFE_MARGIN_MM, TEXTS } from './common';
import type { Draw } from './draw';
import { drawGuide } from './rect';

/** Draws the round template of a disc label. */
export function drawCircleTemplate(
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
  g.fillStyle = COLORS.nonPrint;
  g.beginPath();
  g.rect(0, 0, d.px(W), d.px(H));
  g.arc(d.px(cx), d.px(cy), d.px(R + b), 0, TAU);
  g.fill('evenodd');

  // Bleed ring.
  if (b > 0) {
    g.fillStyle = COLORS.bleed;
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
    g.fillStyle = COLORS.regionTints[0];
    g.beginPath();
    g.arc(d.px(cx), d.px(cy), d.px(hubR), 0, TAU);
    g.arc(d.px(cx), d.px(cy), d.px(r), 0, TAU);
    g.fill('evenodd');
  }

  // Hole.
  if (r > 0) {
    g.fillStyle = COLORS.hole;
    g.beginPath();
    g.arc(d.px(cx), d.px(cy), d.px(r), 0, TAU);
    g.fill();
    d.stroke(COLORS.ink, 0.25, []);
    d.circle(cx, cy, r);
  }

  // Safe areas: 3 mm inside the outer edge, and the hub limit toward the center.
  d.stroke(COLORS.safe, 0.2, [1.6, 1.0]);
  if (R - SAFE_MARGIN_MM > hubR) d.circle(cx, cy, R - SAFE_MARGIN_MM);
  if (hubR > r) d.circle(cx, cy, hubR);

  // Cut line.
  d.stroke(COLORS.trim, 0.25, [3, 1.5]);
  d.circle(cx, cy, Math.min(R, Math.min(W, H) / 2 - d.lineMm(0.25) / 2));

  // Center cross.
  const arm = Math.max(r + 4, 6);
  d.stroke(COLORS.ink, 0.15, []);
  g.beginPath();
  g.moveTo(d.px(cx - arm), d.px(cy));
  g.lineTo(d.px(cx + arm), d.px(cy));
  g.moveTo(d.px(cx), d.px(cy - arm));
  g.lineTo(d.px(cx), d.px(cy + arm));
  g.stroke();

  // Fold guides (unusual on discs, but honor them).
  for (const gd of tpl.guides ?? []) {
    drawGuide(d, gd.orientation, gd.posMm, gd.label ?? TEXTS.fold, W, H, {
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
    d.text(name, cx, cy - hubR - band * 0.5, fs, COLORS.label, 'center', 'middle', 700);
    const dims = `Ø ${fmtMm(circle.outerMm)} mm · ${TEXTS.hole} Ø ${fmtMm(circle.innerMm)} mm`;
    // Kept in the upper half of the lower band so it stays clear of the corner legend.
    d.text(dims, cx, cy + hubR + band * 0.4, fs * 0.42, COLORS.labelDim, 'center', 'middle', 500);
  }
  const hubFs = Math.min(2.2, (hubR - r) * 0.22);
  if (hubR > r && hubFs >= 0.8)
    d.text(TEXTS.hub, cx, cy + hubR + hubFs * 1.1, hubFs, COLORS.safe, 'center', 'middle', 500);
  if (R - SAFE_MARGIN_MM > hubR) {
    d.text(
      TEXTS.safe,
      cx,
      cy - R + SAFE_MARGIN_MM + 2.2,
      Math.min(2.2, band * 0.12),
      COLORS.safe,
      'center',
      'middle',
      500,
    );
  }
}
