/**
 * The print template definitions of the book models, with 3 mm bleed: a single panel, the wrap and
 * the panels of a hardcover or paperback with fold and groove guides, and the notebook covers with
 * their hole zone.
 */
import type { ParamValues, PrintTemplate, TemplateGuide } from '../../core/types/model';
import { type BookKind, wrapLayout } from './cover';
import { noteGeom } from './notebookLayout';

/** Print bleed on every side of every artwork. */
export const BLEED = 3;

const TRIM = 'Trim line';
const FOLD = 'Spine fold';
const GROOVE = 'Hinge groove';

/** Single panel template (front / spine / back) with 3 mm bleed and optional extra guides. */
function panelTemplate(w: number, h: number, label: string, extra: TemplateGuide[] = []): PrintTemplate {
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
      ...extra,
    ],
    regions: [{ xMm: b, yMm: b, wMm: w, hMm: h, label }],
  };
}

export function bookWrapTemplate(p: ParamValues, kind: BookKind): PrintTemplate {
  const w = wrapLayout(p, kind);
  const b = BLEED;
  const hc = w.g.Hc;
  const guides: TemplateGuide[] = [
    { orientation: 'v', posMm: b, label: TRIM },
    { orientation: 'v', posMm: b + w.s0, label: FOLD },
    { orientation: 'v', posMm: b + w.s1, label: FOLD },
    { orientation: 'v', posMm: b + w.L, label: TRIM },
    { orientation: 'h', posMm: b, label: TRIM },
    { orientation: 'h', posMm: b + hc, label: TRIM },
  ];
  if (w.sgB >= 0) guides.push({ orientation: 'v', posMm: b + w.sgB, label: GROOVE });
  if (w.sgF >= 0) guides.push({ orientation: 'v', posMm: b + w.sgF, label: GROOVE });
  return {
    widthMm: w.L + 2 * b,
    heightMm: hc + 2 * b,
    bleedMm: b,
    guides,
    regions: [
      { xMm: b, yMm: b, wMm: w.s0, hMm: hc, label: 'Back' },
      { xMm: b + w.s0, yMm: b, wMm: w.s1 - w.s0, hMm: hc, label: 'Spine' },
      { xMm: b + w.s1, yMm: b, wMm: w.L - w.s1, hMm: hc, label: 'Front' },
    ],
  };
}

export function bookPanelTemplate(p: ParamValues, kind: BookKind, panel: 'front' | 'spine' | 'back'): PrintTemplate {
  const w = wrapLayout(p, kind);
  const hc = w.g.Hc;
  if (panel === 'spine') return panelTemplate(w.s1 - w.s0, hc, 'Spine');
  if (panel === 'front') {
    const extra: TemplateGuide[] = w.sgF >= 0 ? [{ orientation: 'v', posMm: BLEED + w.sgF - w.s1, label: GROOVE }] : [];
    return panelTemplate(w.L - w.s1, hc, 'Front', extra);
  }
  // Back panel: its left edge is the fore-edge (seen from behind the spine is on the right).
  const extra: TemplateGuide[] = w.sgB >= 0 ? [{ orientation: 'v', posMm: BLEED + w.sgB, label: GROOVE }] : [];
  return panelTemplate(w.s0, hc, 'Back', extra);
}

export function noteTemplate(p: ParamValues, face: 'front' | 'back'): PrintTemplate {
  const g = noteGeom(p);
  const b = BLEED;
  const zone = g.hd + g.holeAcross / 2 + 1.5;
  const zoneLabel = 'Hole zone';
  let extra: TemplateGuide;
  if (g.binding === 'top') extra = { orientation: 'h', posMm: b + zone, label: zoneLabel };
  // Left binding: seen from behind the binding edge is on the RIGHT of the back cover.
  else extra = { orientation: 'v', posMm: face === 'front' ? b + zone : b + g.W - zone, label: zoneLabel };
  return panelTemplate(g.W, g.H, face === 'front' ? 'Front' : 'Back', [extra]);
}
