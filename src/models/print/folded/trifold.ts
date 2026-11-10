/**
 * The tri-fold leaflet ('print-trifold'): a DL leaflet from an A4 sheet, roll or Z-fold, standing
 * partly open or lying. Slots 'outside' (primary) and 'inside'.
 */
import * as THREE from 'three';
import type {
  ImageSlotDef,
  ModelContext,
  ModelDefinition,
  ParamDef,
  ParamValues,
  PrintTemplate,
} from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { icon } from '../../icon';
import { mmParam, num, str } from '../../params';
import { G_DIM, thicknessParam } from '../common';
import { finishParam } from '../finishes';
import { BLEED, spreadTemplate } from '../templates';
import { buildFolded, paperColorParam, paperOf } from './build';
import { horizontalUV, LAYER_GAP } from './hingedSheet';
import { openAngleParam, poseOf, poseParam } from './pose';

const deg = THREE.MathUtils.degToRad;

type TriFoldType = 'roll' | 'z';

interface TrifoldLayout {
  type: TriFoldType;
  /** Panel widths left to right on the OUTSIDE. */
  widths: number[];
  height: number;
}

/**
 * Roll (letter) fold: outside = [inner flap | back | front cover]; the flap that folds in is
 * `flapInset` narrower and the other two share the difference, so the sheet stays 3 x panel width
 * (A4: 97 | 100 | 100). Z-fold: three equal panels [panel 1 | panel 2 | front cover].
 */
function trifoldLayout(p: ParamValues): TrifoldLayout {
  const type: TriFoldType = str(p, 'foldType', 'z') === 'roll' ? 'roll' : 'z';
  const pw = clamp(num(p, 'panelWidth', 99), 50, 200);
  const height = clamp(num(p, 'height', 210), 50, 400);
  if (type === 'z') return { type, widths: [pw, pw, pw], height };
  const inset = clamp(num(p, 'flapInset', 3), 0, pw * 0.3);
  return { type, widths: [pw - (2 * inset) / 3, pw + inset / 3, pw + inset / 3], height };
}

const TRI_OUT_LABELS: Record<TriFoldType, string[]> = {
  roll: ['Inner flap (folds in)', 'Back', 'Front cover'],
  z: ['Panel 1', 'Panel 2', 'Front cover'],
};
/** Inside labels in INSIDE-image order (left to right), i.e. the reverse panel order. */
const TRI_IN_LABELS: Record<TriFoldType, string[]> = {
  roll: ['Inside – left', 'Inside – middle', 'Inside – right (on the flap)'],
  z: ['Inside 1', 'Inside 2', 'Inside 3 / back cover'],
};

function trifoldTemplate(p: ParamValues, side: 'outside' | 'inside'): PrintTemplate {
  const lay = trifoldLayout(p);
  const widths = side === 'outside' ? lay.widths : [...lay.widths].reverse();
  const labels = side === 'outside' ? TRI_OUT_LABELS[lay.type] : TRI_IN_LABELS[lay.type];
  return spreadTemplate(
    widths.map((size, i) => ({ size, label: labels[i] })),
    lay.height,
    'h',
  );
}

/**
 * Roll fold: the flap stays tucked under the cover until the cover is open far enough to clear it.
 * While the cover still leans over the back (< 90°) the flap is additionally capped so its free
 * edge stays `clearance` mm below the cover plane: in the back panel's cross-section that is
 * wBack·sin(α) − wFlap·sin(α + β) ≥ clearance (α = cover, β = flap opening). This matters for a
 * small flap inset, where the 76° schedule alone would push the flap through the cover.
 */
function rollFlapOpen(coverOpen: number, wFlap: number, wBack: number, clearance: number): number {
  const desired = coverOpen <= 76 ? 0 : Math.min(180, ((coverOpen - 76) * 180) / 104);
  if (desired <= 0 || coverOpen >= 90) return desired;
  const k = (wBack * Math.sin(deg(coverOpen)) - clearance) / wFlap;
  if (k >= 1) return desired;
  const limit = THREE.MathUtils.radToDeg(Math.asin(clamp(k, -1, 1))) - coverOpen;
  return clamp(Math.min(desired, limit), 0, 180);
}

const TRI_ASPECT = (297 + 2 * BLEED) / (210 + 2 * BLEED);

const trifoldSlots: ImageSlotDef[] = [
  {
    id: 'outside',
    label: 'Outside',
    hint:
      'The whole outside of the sheet, its 3 panels from left to right. Roll fold: Inner flap | Back | Front cover. ' +
      'Z-fold: Panel 1 | Panel 2 | Front cover. For A4: 297 × 210 mm + 3 mm bleed, 303 × 216 mm in all (download the template).',
    aspect: TRI_ASPECT,
    template: (p) => trifoldTemplate(p, 'outside'),
  },
  {
    id: 'inside',
    label: 'Inside',
    hint:
      'The inside of the leaflet (3 panels) as seen when opened. The left panel backs the front cover, the right one ' +
      'backs the flap (in a Z-fold, panel 1, which is the back cover). Without artwork the inside is plain paper.',
    aspect: TRI_ASPECT,
    template: (p) => trifoldTemplate(p, 'inside'),
  },
];

const trifoldParams: ParamDef[] = [
  {
    id: 'foldType',
    type: 'select',
    label: 'Fold type',
    group: G_DIM,
    options: [
      { value: 'roll', label: 'Roll / letter fold' },
      { value: 'z', label: 'Z-fold (zigzag)' },
    ],
    default: 'z',
  },
  mmParam('panelWidth', 'Panel width (a third of the sheet)', 99, 50, 200, 0.5, G_DIM),
  mmParam('height', 'Height', 210, 50, 400, 0.5, G_DIM),
  mmParam('flapInset', 'Narrower flap (roll fold)', 3, 0, 6, 0.5, G_DIM),
  poseParam('standing'),
  openAngleParam(60),
  thicknessParam(0.15, 0.06, 0.8, 0.01),
  finishParam('satin'),
  paperColorParam,
];

function buildTrifold(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const lay = trifoldLayout(p);
  const { lying, angle } = poseOf(p, 'standing', 60);
  const paper = paperOf(p, 0.15, 'satin');
  const t = paper.thickness;
  const W = lay.widths.reduce((s, w) => s + w, 0);
  const uv = horizontalUV(W, lay.height);
  const roll = lay.type === 'roll';
  return buildFolded(
    ctx,
    {
      widths: lay.widths,
      height: lay.height,
      // Roll: the back panel stays put; the flap (in, first layer) and the cover (in, nested over
      // the flap) hinge on it. Z: panel 1 is the base (bottom of the closed stack, inside down).
      base: roll ? 1 : 0,
      folds: roll
        ? [
            { dir: 'in', open: rollFlapOpen(angle, lay.widths[0], lay.widths[1], 2 * t + 0.3), gap: LAYER_GAP },
            { dir: 'in', open: angle, gap: t / 2 + 2 * LAYER_GAP },
          ]
        : [
            { dir: 'out', open: angle, gap: LAYER_GAP },
            { dir: 'in', open: angle, gap: LAYER_GAP },
          ],
      pose: {
        lying,
        foldAxis: 'vertical',
        front: 2,
        back: 1,
        groundFace: roll ? 'outside' : 'inside',
        // Roll: like a card – wide open the bisector of the cover/back "V", nearly closed mostly
        // the cover (a pure bisector would show the spine edge-on at small angles).
        // Z: panels 1 and 3 are parallel – turn them slightly left so the camera's default yaw
        // shows the zigzag.
        frontYaw: roll ? Math.min(35, (180 - angle) / 2) : -15,
      },
      outUV: uv.out,
      inUV: uv.inn,
      ...paper,
      outsideAspect: TRI_ASPECT,
    },
    'Tri-fold leaflet',
  );
}

export const trifoldModel: ModelDefinition = {
  id: 'print-trifold',
  category: 'print',
  name: 'Tri-fold leaflet',
  description:
    'DL leaflet from an A4 sheet (297 × 210 mm → 99 × 210 mm), roll or Z-fold; standing partially opened or lying.',
  icon: icon(
    '<path d="M6 13l17 5v37L6 50z"/><path d="M23 18l18-5v37l-18 5z"/><path d="M41 13l17 5v37l-17-5z"/>' +
      '<path d="M45 24l9 2.6M45 30l9 2.6"/>',
    2.5,
  ),
  slots: trifoldSlots,
  params: trifoldParams,
  defaultCamera: { yaw: 15, pitch: 14 },
  build: buildTrifold,
};
