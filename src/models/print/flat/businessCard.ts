/**
 * The business card ('print-business-card'): 90 × 50, 85 × 55, 89 × 51 mm or a custom size; single,
 * leaning, stacked or front and back side by side. Slots 'front' (primary) and 'back'.
 */
import type * as THREE from 'three';
import type { ModelContext, ModelDefinition, ParamValues } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { icon } from '../../icon';
import { mmParam, num, str } from '../../params';
import { colorParam, CUSTOM_HEIGHT, CUSTOM_WIDTH, G_DIM, thicknessParam } from '../common';
import { edgeMat, finishOf, finishParam, PAPER_FINISH, printedMat, solidMat } from '../finishes';
import { trimRect } from '../templates';
import { arrange, CARD_LAYOUTS, finishRoot, layoutOf, layoutParam, stackCountParam } from './arrangement';
import { flatSheetGeometries, type SheetMaterials, sheetMeshes } from './sheet';
import { orientationParam, trimSizeOf, twoSidedSlots } from './twoSided';

/** Landscape trim sizes, mm. */
const BC_SIZES: Record<string, [number, number]> = {
  '90x50': [90, 50],
  '85x55': [85, 55],
  '89x51': [89, 51],
};
const businessCardDims = (p: ParamValues) => trimSizeOf(p, BC_SIZES, '90x50', 'landscape', [30, 150]);

export const businessCardModel: ModelDefinition = {
  id: 'print-business-card',
  category: 'print',
  name: 'Business card',
  description:
    'Business card 90 × 50 / 85 × 55 / 89 × 51 mm or a custom size: single, standing, in a stack or front and back side by side.',
  icon: icon(
    '<path d="M14 22V16.5a2.5 2.5 0 0 1 2.5-2.5h39a2.5 2.5 0 0 1 2.5 2.5v21a2.5 2.5 0 0 1-2.5 2.5H50"/>' +
      '<rect x="6" y="22" width="44" height="26" rx="2.5"/><path d="M13 31h17M13 37h11"/>',
  ),
  slots: twoSidedSlots(businessCardDims, 90, 50, 'business card', 'Without artwork the back shows the paper color.'),
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: '90x50', label: '90 × 50 mm (Polish standard)' },
        { value: '85x55', label: '85 × 55 mm (EU)' },
        { value: '89x51', label: '89 × 51 mm (US, 3.5 × 2″)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: '90x50',
    },
    orientationParam('landscape'),
    mmParam('width', CUSTOM_WIDTH, 90, 30, 150, 0.5, G_DIM),
    mmParam('height', CUSTOM_HEIGHT, 50, 30, 150, 0.5, G_DIM),
    mmParam('cornerRadius', 'Corner radius', 0, 0, 6, 0.5, G_DIM),
    thicknessParam(0.4, 0.3, 0.8, 0.05),
    finishParam('matte', 'Finish'),
    colorParam('paperColor', 'Paper color (edges, empty back)', '#f7f6f2'),
    layoutParam(CARD_LAYOUTS, 'flat'),
    stackCountParam,
  ],
  defaultCamera: { yaw: 18, pitch: 38, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const [w, h] = businessCardDims(p);
    const t = clamp(num(p, 'thickness', 0.4), 0.2, 1);
    const r = clamp(num(p, 'cornerRadius', 0), 0, Math.min(w, h) / 2 - 0.5);
    const f = finishOf(p, PAPER_FINISH, 'matte');
    const paper = str(p, 'paperColor', '#f7f6f2');
    const rect = trimRect(w, h);
    const geos = flatSheetGeometries(w, h, t, r, rect, rect);
    const mats: SheetMaterials = {
      front: printedMat(ctx.getTexture('front'), f),
      back: ctx.hasArtwork('back') ? printedMat(ctx.getTexture('back'), f) : solidMat(paper, f),
      edge: edgeMat(paper),
    };
    const root = arrange(
      () => sheetMeshes(geos, mats),
      layoutOf(p, CARD_LAYOUTS, 'flat'),
      w,
      h,
      t,
      num(p, 'stackCount', 6),
    );
    return finishRoot(root, 'Business card');
  },
};
