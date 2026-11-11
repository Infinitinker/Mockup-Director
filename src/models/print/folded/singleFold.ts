/**
 * A sheet folded once, the factory behind the greeting card and the bi-fold brochure: its sizes and
 * the fold on the left or at the top (a tent, printed as a vertical spread), its Outside and Inside
 * slots with templates, its parameters and its build.
 */
import type * as THREE from 'three';
import type {
  ImageSlotDef,
  ModelContext,
  ModelDefinition,
  ParamDef,
  ParamValues,
  PrintTemplate,
} from '../../../core/types/model';
import { clamp, round1 } from '../../../core/math';
import { mmParam, num, str } from '../../params';
import { G_DIM, thicknessParam } from '../common';
import { type Finish, finishParam } from '../finishes';
import { BLEED, spreadTemplate } from '../templates';
import { buildFolded, paperColorParam, paperOf } from './build';
import { horizontalUV, LAYER_GAP, type UVFn } from './hingedSheet';
import { openAngleParam, poseOf, poseParam } from './pose';

interface PaperSize {
  value: string;
  label: string;
  /** Folded size, portrait (w <= h for the named paper formats). */
  w: number;
  h: number;
}

export interface CardVariant {
  sizes: PaperSize[];
  defaultSize: string;
  /** Default custom folded size. */
  customW: number;
  customH: number;
  defaultPose: 'standing' | 'lying';
  defaultAngle: number;
  defaultThickness: number;
  defaultFinish: Finish;
  name: string;
}

interface CardLayout {
  /** Folded front face size as seen from the front. */
  pw: number;
  ph: number;
  /** true = fold at the top (landscape tent / calendar fold), false = fold on the left. */
  tent: boolean;
}

/**
 * Folded size from the Size parameter + orientation. Named formats are turned landscape for the
 * top fold (A6 tent card = 148 × 105); custom sizes are used exactly as entered.
 */
function cardLayout(p: ParamValues, v: CardVariant): CardLayout {
  const tent = str(p, 'orientation', 'portrait') === 'top';
  const id = str(p, 'size', v.defaultSize);
  if (id === 'custom') {
    return {
      pw: clamp(num(p, 'customWidth', v.customW), 30, 500),
      ph: clamp(num(p, 'customHeight', v.customH), 30, 500),
      tent,
    };
  }
  const paper = v.sizes.find((s) => s.value === id) ?? v.sizes.find((s) => s.value === v.defaultSize) ?? v.sizes[0];
  const short = Math.min(paper.w, paper.h);
  const long = Math.max(paper.w, paper.h);
  return tent ? { pw: long, ph: short, tent } : { pw: short, ph: long, tent };
}

/**
 * Portrait: outside = [Back | Front] side by side, inside = [inside left | inside right].
 * Tent (fold at the top): a vertical spread as it is printed – outside = Back (upside down, so it
 * reads correctly when the card stands) over Front; inside = inside top (backs the front) over
 * inside bottom.
 */
function cardTemplate(p: ParamValues, v: CardVariant, side: 'outside' | 'inside'): PrintTemplate {
  const { pw, ph, tent } = cardLayout(p, v);
  if (!tent) {
    const labels = side === 'outside' ? ['Back', 'Front (cover)'] : ['Inside – left', 'Inside – right'];
    return spreadTemplate(
      labels.map((label) => ({ size: pw, label })),
      ph,
      'h',
    );
  }
  const labels = side === 'outside' ? ['Back (upside down)', 'Front (cover)'] : ['Inside – top', 'Inside – bottom'];
  return spreadTemplate(
    labels.map((label) => ({ size: ph, label })),
    pw,
    'v',
  );
}

function cardSlots(v: CardVariant): ImageSlotDef[] {
  const def = v.sizes.find((s) => s.value === v.defaultSize) ?? v.sizes[0];
  const w = Math.min(def.w, def.h);
  const h = Math.max(def.w, def.h);
  const aspect = (2 * w + 2 * BLEED) / (h + 2 * BLEED);
  return [
    {
      id: 'outside',
      label: 'Outside',
      hint:
        `Outside spread: Back | Front (${round1(2 * w)} × ${round1(h)} mm + 3 mm bleed for the default size). ` +
        'With the fold at the top the layout is vertical: the back (upside down) above the front. The template shows the layout.',
      aspect,
      template: (p) => cardTemplate(p, v, 'outside'),
    },
    {
      id: 'inside',
      label: 'Inside',
      hint: 'Inside spread as seen when opened (left | right, or top / bottom with the fold at the top). Without artwork the inside is plain paper.',
      aspect,
      template: (p) => cardTemplate(p, v, 'inside'),
    },
  ];
}

function cardParams(v: CardVariant): ParamDef[] {
  return [
    {
      id: 'size',
      type: 'select',
      label: 'Size (folded)',
      group: G_DIM,
      options: [...v.sizes.map((s) => ({ value: s.value, label: s.label })), { value: 'custom', label: 'Custom' }],
      default: v.defaultSize,
    },
    {
      id: 'orientation',
      type: 'select',
      label: 'Fold',
      group: G_DIM,
      options: [
        { value: 'portrait', label: 'On the left (portrait, like a book)' },
        { value: 'top', label: 'At the top (landscape tent)' },
      ],
      default: 'portrait',
    },
    mmParam('customWidth', 'Width (custom size)', v.customW, 30, 500, 0.5, G_DIM),
    mmParam('customHeight', 'Height (custom size)', v.customH, 30, 500, 0.5, G_DIM),
    poseParam(v.defaultPose),
    openAngleParam(v.defaultAngle),
    thicknessParam(v.defaultThickness, 0.06, 0.8, 0.01),
    finishParam(v.defaultFinish),
    paperColorParam,
  ];
}

function buildCard(ctx: ModelContext, v: CardVariant, aspect: number): THREE.Object3D {
  const p = ctx.params;
  const { pw, ph, tent } = cardLayout(p, v);
  const { lying, angle } = poseOf(p, v.defaultPose, v.defaultAngle);
  const paper = paperOf(p, v.defaultThickness, v.defaultFinish);
  let widths: number[];
  let height: number;
  let outUV: UVFn;
  let inUV: UVFn;
  if (!tent) {
    // Sheet X across [Back | Front], Y up the card.
    widths = [pw, pw];
    height = ph;
    const uv = horizontalUV(2 * pw, ph);
    outUV = uv.out;
    inUV = uv.inn;
  } else {
    // Tent: sheet X runs DOWN the vertical print spread (X = 0 at the back's free edge = image
    // top, X = ph at the fold, X = 2 ph at the front's free edge = image bottom); Y runs left to
    // right across the card. Outside seen from +Z with image-up = -X: u grows with Y, v with -X.
    // The back panel's top on the card is the fold, so the back is upside down in the image.
    // Inside: the sheet is turned over around the horizontal axis (like opening a top-fold card),
    // so u still grows with Y and v grows with +X (inside top = backs the front).
    widths = [ph, ph];
    height = pw;
    const tw = pw + 2 * BLEED;
    const th = 2 * ph + 2 * BLEED;
    outUV = (X, Y) => [(BLEED + Y) / tw, 1 - (BLEED + X) / th];
    inUV = (X, Y) => [(BLEED + Y) / tw, (BLEED + X) / th];
  }
  return buildFolded(
    ctx,
    {
      widths,
      height,
      base: 0,
      folds: [{ dir: 'in', open: angle, gap: LAYER_GAP }],
      pose: {
        lying,
        foldAxis: tent ? 'top' : 'vertical',
        front: 1,
        back: 0,
        groundFace: 'outside',
        // Wide open: face the bisector (front and back both visible); nearly closed: mostly the front.
        frontYaw: Math.min(35, (180 - angle) / 2),
      },
      outUV,
      inUV,
      ...paper,
      outsideAspect: aspect,
    },
    v.name,
  );
}

export function cardModel(
  v: CardVariant,
  def: Pick<ModelDefinition, 'id' | 'name' | 'description' | 'icon' | 'defaultCamera'>,
): ModelDefinition {
  const slots = cardSlots(v);
  const aspect = slots[0].aspect;
  return {
    ...def,
    category: 'print',
    slots,
    params: cardParams(v),
    build: (ctx) => buildCard(ctx, v, aspect),
  };
}
