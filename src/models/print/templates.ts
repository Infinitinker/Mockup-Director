/**
 * Print templates of the print models. Every image slot expects the FULL template including the
 * 3 mm bleed, so the trim area of a face maps to the inner rectangle of the image (`trimRect`).
 * A one-panel template, a multi-panel spread with its fold lines, and that trim area as a UV
 * rectangle.
 */
import type { PrintTemplate, TemplateGuide, TemplateRegion } from '../../core/types/model';

/** Print bleed on every side of every template, mm. */
export const BLEED = 3;

/** The label of a trim guide. */
export const TRIM = 'Trim line';
/** The label of a fold guide between the panels of a spread (the brochure's cover has its own). */
const FOLD = 'Fold line (crease)';

/** Single panel template (w x h trim) with 3 mm bleed on every side. */
export function panelTemplate(w: number, h: number, label: string): PrintTemplate {
  const b = BLEED;
  return {
    widthMm: w + 2 * b,
    heightMm: h + 2 * b,
    bleedMm: b,
    guides: [
      { orientation: 'v', posMm: b, label: TRIM },
      { orientation: 'v', posMm: b + w, label: TRIM },
      { orientation: 'h', posMm: b, label: TRIM },
      { orientation: 'h', posMm: b + h, label: TRIM },
    ],
    regions: [{ xMm: b, yMm: b, wMm: w, hMm: h, label }],
  };
}

/** UV sub-rectangle [u0, v0, u1, v1] (v = 0 is the image bottom). */
export type UVRect = [number, number, number, number];
export const FULL_RECT: UVRect = [0, 0, 1, 1];

/** The trim area of a template image with `b` mm of bleed around a w x h trim. */
export function trimRect(w: number, h: number, b = BLEED): UVRect {
  return [b / (w + 2 * b), b / (h + 2 * b), (b + w) / (w + 2 * b), (b + h) / (h + 2 * b)];
}

interface TemplatePanel {
  size: number;
  label: string;
}

/**
 * Multi-panel template with 3 mm bleed. axis 'h': panels left to right (sizes = widths, `cross`
 * = height); axis 'v': panels top to bottom (sizes = heights, `cross` = width). Fold guides
 * between panels, trim guides around.
 */
export function spreadTemplate(panels: TemplatePanel[], cross: number, axis: 'h' | 'v'): PrintTemplate {
  const b = BLEED;
  const total = panels.reduce((s, p) => s + p.size, 0);
  const lineAcross: 'v' | 'h' = axis === 'h' ? 'v' : 'h';
  const lineAlong: 'v' | 'h' = axis === 'h' ? 'h' : 'v';
  const guides: TemplateGuide[] = [{ orientation: lineAcross, posMm: b, label: TRIM }];
  const regions: TemplateRegion[] = [];
  let pos = b;
  panels.forEach((p, i) => {
    regions.push(
      axis === 'h'
        ? { xMm: pos, yMm: b, wMm: p.size, hMm: cross, label: p.label }
        : { xMm: b, yMm: pos, wMm: cross, hMm: p.size, label: p.label },
    );
    pos += p.size;
    guides.push({ orientation: lineAcross, posMm: pos, label: i === panels.length - 1 ? TRIM : FOLD });
  });
  guides.push(
    { orientation: lineAlong, posMm: b, label: TRIM },
    { orientation: lineAlong, posMm: b + cross, label: TRIM },
  );
  return axis === 'h'
    ? { widthMm: total + 2 * b, heightMm: cross + 2 * b, bleedMm: b, guides, regions }
    : { widthMm: cross + 2 * b, heightMm: total + 2 * b, bleedMm: b, guides, regions };
}
