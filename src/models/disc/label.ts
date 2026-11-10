/**
 * The disc label: the disc's outer size and center hole, the label's artwork slot and print
 * template, the disc params every disc-showing model shares, and the printable ring they give.
 *
 * Label print: Ø 118 outer, inner Ø configurable (typ. 36 / 38 / 46; hub-printable 22).
 */
import type { ImageSlotDef, ParamDef, ParamValues } from '../../core/types/model';
import { round1 } from '../../core/math';
import { bool, num } from '../params';

export const DISC_DIAMETER = 120;
export const R_HOLE = 7.5;
/** Standard printable outer diameter (the outer 1 mm rim stays clear). */
const PRINT_OUTER = 118;
/** "Full-face" printable discs: hub-printable from Ø 22 almost to the edge. */
const FULL_FACE_INNER = 22;
const FULL_FACE_OUTER = 119.5;

/** The disc-label image slot (id 'disc'), reused by composite "... with disc" models. */
export const discSlot: ImageSlotDef = {
  id: 'disc',
  label: 'Disc label',
  hint: 'A 120 × 120 mm square whose center is the disc’s center. The print covers Ø 118 mm, from the label inner diameter (36 mm by default) outward. Extend the background to the 120 mm edge: it acts as bleed. Transparent PNG areas show the silver disc, or white when “Transparent label areas” is set to White base coat.',
  aspect: 1,
  // A function of the params, so the downloaded template follows 'discInner' / 'discFullFace'
  // exactly like the 3D label does (placeholder.ts resolves it with defaults for the round
  // placeholder).
  template: (params: ParamValues) => {
    const { inner, outer } = discPrintArea(params);
    const label = `Print Ø ${round1(outer)} mm`;
    const lo = (DISC_DIAMETER - outer) / 2;
    const hi = (DISC_DIAMETER + outer) / 2;
    return {
      widthMm: DISC_DIAMETER,
      heightMm: DISC_DIAMETER,
      bleedMm: 0,
      circle: { outerMm: DISC_DIAMETER, innerMm: R_HOLE * 2, printOuterMm: outer, printInnerMm: inner },
      // Tangent lines of the printable area (the template draws the circles itself).
      guides: [
        { orientation: 'v', posMm: lo, label },
        { orientation: 'v', posMm: hi, label },
        { orientation: 'h', posMm: lo, label },
        { orientation: 'h', posMm: hi, label },
      ],
    };
  },
};

const G_DISC = 'Disc';

/**
 * Disc params, all prefixed 'disc' so composite models can merge them with their own params.
 * buildDisc() falls back to these defaults when a param is missing.
 */
export const discParams: ParamDef[] = [
  {
    id: 'discFinish',
    type: 'select',
    label: 'Label finish',
    group: G_DISC,
    options: [
      { value: 'matte', label: 'Matte' },
      { value: 'glossy', label: 'Glossy' },
    ],
    default: 'matte',
  },
  {
    id: 'discInner',
    type: 'number',
    label: 'Label inner diameter',
    group: G_DISC,
    min: 15,
    max: 46,
    step: 0.5,
    default: 36,
    unit: 'mm',
  },
  {
    id: 'discFullFace',
    type: 'boolean',
    label: 'Full-face print (Ø 22–119.5 mm)',
    group: G_DISC,
    default: false,
  },
  {
    id: 'discLabelBase',
    type: 'select',
    label: 'Transparent label areas',
    group: G_DISC,
    options: [
      { value: 'silver', label: 'Silver (no base)' },
      { value: 'white', label: 'White base coat' },
    ],
    default: 'silver',
  },
  {
    id: 'discDataSide',
    type: 'select',
    label: 'Data side',
    group: G_DISC,
    options: [
      { value: 'silver', label: 'Silver (pressed CD/DVD)' },
      { value: 'gold', label: 'Gold (CD-R)' },
      { value: 'violet', label: 'Violet (DVD±R)' },
      { value: 'dark', label: 'Dark (BD-R)' },
    ],
    default: 'silver',
  },
];

/** Printable annulus (inner / outer DIAMETER, mm) for the current params. */
export function discPrintArea(params: ParamValues): { inner: number; outer: number } {
  if (bool(params, 'discFullFace', false)) return { inner: FULL_FACE_INNER, outer: FULL_FACE_OUTER };
  const inner = Math.max(R_HOLE * 2, Math.min(46, num(params, 'discInner', 36)));
  return { inner, outer: PRINT_OUTER };
}
