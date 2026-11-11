/**
 * The single-sheet flyer ('print-flyer'): A6, A5, A4, DL or a custom size, with an optional gentle
 * bend along its long edge. Slots 'front' (primary) and 'back'.
 */
import type * as THREE from 'three';
import type { ModelContext, ModelDefinition, ParamValues } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { icon } from '../../icon';
import { mmParam, num, str } from '../../params';
import { colorParam, CUSTOM_HEIGHT, CUSTOM_WIDTH, G_DIM, thicknessParam } from '../common';
import { edgeMat, finishOf, finishParam, PAPER_FINISH, printedMat, solidMat } from '../finishes';
import { trimRect } from '../templates';
import { arrange, finishRoot, type Layout, layoutOf, layoutParam } from './arrangement';
import { bentSheetGeometries, type SheetMaterials, sheetMeshes } from './sheet';
import { orientationParam, trimSizeOf, twoSidedSlots } from './twoSided';

/** Portrait trim sizes, mm. */
const FLYER_SIZES: Record<string, [number, number]> = {
  a6: [105, 148],
  a5: [148, 210],
  a4: [210, 297],
  dl: [99, 210],
};
const flyerDims = (p: ParamValues) => trimSizeOf(p, FLYER_SIZES, 'a5', 'portrait', [50, 500]);
const FLYER_LAYOUTS: Layout[] = ['flat', 'leaning', 'pair'];

export const flyerModel: ModelDefinition = {
  id: 'print-flyer',
  category: 'print',
  name: 'Flyer',
  description: 'Single-sheet flyer / leaflet A6 / A5 / A4 / DL or a custom size, with an optional gentle sheet bend.',
  icon: icon(
    '<rect x="15" y="5" width="34" height="54" rx="1.5"/><rect x="21" y="12" width="22" height="16" rx="1"/>' +
      '<path d="M21 35h22M21 41h22M21 47h13"/>',
  ),
  slots: twoSidedSlots(flyerDims, 148, 210, 'flyer', 'Without artwork the back shows the paper color.'),
  params: [
    {
      id: 'size',
      type: 'select',
      label: 'Size',
      group: G_DIM,
      options: [
        { value: 'a6', label: 'A6 (105 × 148 mm)' },
        { value: 'a5', label: 'A5 (148 × 210 mm)' },
        { value: 'a4', label: 'A4 (210 × 297 mm)' },
        { value: 'dl', label: 'DL (99 × 210 mm)' },
        { value: 'custom', label: 'Custom' },
      ],
      default: 'a5',
    },
    orientationParam('portrait'),
    mmParam('width', CUSTOM_WIDTH, 148, 50, 500, 1, G_DIM),
    mmParam('height', CUSTOM_HEIGHT, 210, 50, 500, 1, G_DIM),
    {
      id: 'bend',
      type: 'number',
      label: 'Sheet bend',
      group: G_DIM,
      min: 0,
      max: 100,
      step: 1,
      default: 0,
      unit: '%',
    },
    thicknessParam(0.12, 0.06, 0.4, 0.01),
    finishParam('satin'),
    colorParam('paperColor', 'Paper color (edges, empty back)', '#f7f6f2'),
    layoutParam(FLYER_LAYOUTS, 'flat'),
  ],
  defaultCamera: { yaw: 15, pitch: 40, fov: 24 },
  build(ctx: ModelContext): THREE.Object3D {
    const p = ctx.params;
    const [w, h] = flyerDims(p);
    const t = clamp(num(p, 'thickness', 0.12), 0.04, 0.6);
    const f = finishOf(p, PAPER_FINISH, 'satin');
    const paper = str(p, 'paperColor', '#f7f6f2');
    const rect = trimRect(w, h);
    const geos = bentSheetGeometries(w, h, t, clamp(num(p, 'bend', 0), 0, 100) / 100, rect, rect);
    const mats: SheetMaterials = {
      front: printedMat(ctx.getTexture('front'), f),
      back: ctx.hasArtwork('back') ? printedMat(ctx.getTexture('back'), f) : solidMat(paper, f),
      edge: edgeMat(paper),
    };
    const root = arrange(() => sheetMeshes(geos, mats), layoutOf(p, FLYER_LAYOUTS, 'flat'), w, h, t, 1);
    return finishRoot(root, 'Flyer');
  },
};
