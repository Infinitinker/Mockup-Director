/**
 * The legend in a print template's corner: the slot, bleed, trim, safe area, fold, hole, artwork size, resolution and
 * the hint to hide the layer.
 */
import type { ImageSlotDef, PrintTemplate } from '../../core/types/model';
import { clampBleed, COLORS, fmtMm, SAFE_MARGIN_MM, TEXTS } from './common';
import type { Draw } from './draw';

/** Draws the legend in the bottom-left corner, inside the trim where it fits. */
export function drawLegend(
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
  if (b > 0) items.push({ kind: 'bleed', text: `${TEXTS.bleed}: ${fmtMm(b)} mm` });
  const net = b > 0 ? `: ${fmtMm(W - 2 * b)} × ${fmtMm(H - 2 * b)} mm` : '';
  items.push({
    kind: 'trim',
    text: tpl.circle ? `${TEXTS.trim}: Ø ${fmtMm(tpl.circle.outerMm)} mm` : `${TEXTS.trim}${net}`,
  });
  items.push({ kind: 'safe', text: `${TEXTS.safe}: ${fmtMm(SAFE_MARGIN_MM)} mm` });
  if (tpl.guides?.length) items.push({ kind: 'fold', text: TEXTS.foldLegend });
  if (tpl.circle && tpl.circle.innerMm > 0)
    items.push({ kind: 'hole', text: `${TEXTS.hole}: Ø ${fmtMm(tpl.circle.innerMm)} mm` });
  const sizeTxt = `${TEXTS.artboard}: ${fmtMm(W)} × ${fmtMm(H)} mm${b > 0 ? ` (${TEXTS.inclBleed})` : ''}`;
  items.push({ kind: 'none', text: sizeTxt });
  const reduced =
    Math.round(dpi) < Math.round(requestedDpi) ? ` (${TEXTS.reduced} ${Math.round(requestedDpi)} dpi)` : '';
  const dpiTxt = `${Math.round(dpi)} dpi · ${wPx} × ${hPx} px${reduced}`;
  items.push({ kind: 'none', text: dpiTxt });
  items.push({ kind: 'none', text: TEXTS.hint });

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
        g.fillStyle = it.kind === 'bleed' ? COLORS.bleed : COLORS.hole;
        g.fillRect(d.px(sx), d.px(sy - fs * 0.4), d.px(sw), d.px(fs * 0.8));
        if (it.kind === 'hole') {
          d.stroke(COLORS.ink, 0.15, []);
          g.strokeRect(d.px(sx), d.px(sy - fs * 0.4), d.px(sw), d.px(fs * 0.8));
        }
      } else {
        const style =
          it.kind === 'trim'
            ? ([COLORS.trim, 0.25, [3, 1.5]] as const)
            : it.kind === 'safe'
              ? ([COLORS.safe, 0.2, [1.6, 1.0]] as const)
              : ([COLORS.fold, 0.22, [2.2, 0.8, 0.5, 0.8]] as const);
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
    d.text(it.text, tx, cyMm, fs, it.bold ? COLORS.ink : 'rgba(31,37,51,0.85)', 'left', 'middle', it.bold ? 700 : 500);
  });
}
