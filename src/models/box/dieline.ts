/**
 * Product box printed from ONE image: the classic cross-shaped net (dieline).
 *
 *            +-------+
 *            |  Top  |                      Top flap above the front (its bottom edge = front top edge),
 *   +--------+-------+--------+-------+     middle row left | front | right | back (all H tall),
 *   |  Left  | Front | Right  | Back  |     bottom flap below the front (its top edge = front bottom edge).
 *   +--------+-------+--------+-------+
 *            | Bottom|                      3 mm bleed around the whole bounding box.
 *            +-------+
 */
import * as THREE from 'three';
import type { ModelContext, ModelDefinition, ParamValues, PrintTemplate, TemplateRegion } from '../../core/types';
import { L } from '../shared';
import {
  aspectOf,
  bevelParam,
  bleedOf,
  bleedParam,
  boxDims,
  depthParam,
  edgeRadius,
  finishOf,
  finishParam,
  FOLD,
  heightParam,
  icon,
  regionMapper,
  surfaceMaterial,
  widthParam,
  BLEED_MM,
} from './common';
import { roundedBoxGeometry, type FaceId, type FaceUVMapper } from './roundedBox';

const DEFAULTS = { w: 135, h: 190, d: 40 } as const;

/** Net regions in a fixed order – index i belongs to NET_FACES[i]. */
const NET_FACES: readonly FaceId[] = ['py', 'nx', 'pz', 'px', 'nz', 'ny'];

/** Exact net template for a W x H x D box (mm) with bleed b. */
export function netTemplate(W: number, H: number, D: number, b: number): PrintTemplate {
  const regions: TemplateRegion[] = [
    { xMm: b + D, yMm: b, wMm: W, hMm: D, label: L('Góra', 'Top') },
    { xMm: b, yMm: b + D, wMm: D, hMm: H, label: L('Lewy bok', 'Left side') },
    { xMm: b + D, yMm: b + D, wMm: W, hMm: H, label: L('Przód', 'Front') },
    { xMm: b + D + W, yMm: b + D, wMm: D, hMm: H, label: L('Prawy bok', 'Right side') },
    { xMm: b + 2 * D + W, yMm: b + D, wMm: W, hMm: H, label: L('Tył', 'Back') },
    { xMm: b + D, yMm: b + D + H, wMm: W, hMm: D, label: L('Spód', 'Bottom') },
  ];
  return {
    widthMm: 2 * W + 2 * D + 2 * b,
    heightMm: H + 2 * D + 2 * b,
    bleedMm: b,
    regions,
    guides: [
      { orientation: 'v', posMm: b + D, label: FOLD },
      { orientation: 'v', posMm: b + D + W, label: FOLD },
      { orientation: 'v', posMm: b + 2 * D + W, label: FOLD },
      { orientation: 'h', posMm: b + D, label: FOLD },
      { orientation: 'h', posMm: b + D + H, label: FOLD },
    ],
  };
}

function templateFor(params: ParamValues): PrintTemplate {
  const { W, H, D } = boxDims(params, DEFAULTS);
  return netTemplate(W, H, D, bleedOf(params));
}

function buildDielineBox(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const { W, H, D } = boxDims(p, DEFAULTS);
  const tpl = templateFor(p);
  const uv: Partial<Record<FaceId, FaceUVMapper>> = {};
  NET_FACES.forEach((face, i) => {
    uv[face] = regionMapper(tpl, tpl.regions![i]);
  });

  const geo = roundedBoxGeometry({ width: W, height: H, depth: D, radius: edgeRadius(p, W, H, D), uv });
  // One material for all faces (a non-array material draws the whole geometry, groups are ignored).
  const mesh = new THREE.Mesh(geo, surfaceMaterial(finishOf(p), { map: ctx.getTexture('net') }));
  mesh.name = 'box-dieline';
  mesh.position.y = H / 2;
  mesh.castShadow = true;

  const root = new THREE.Group();
  root.name = 'box-dieline-root';
  root.add(mesh);
  return root;
}

export const dielineBoxModel: ModelDefinition = {
  id: 'box-dieline',
  category: 'box',
  name: L('Pudełko – siatka (jedno zdjęcie)', 'Box – dieline (single image)'),
  description: L(
    'To samo pudełko, ale cała grafika w jednym pliku: rozkładówka w kształcie krzyża.',
    'The same box, with all artwork in one file: a cross-shaped net.',
  ),
  icon: icon(
    '<path d="M8 24 H16 V16 H32 V24 H56 V40 H32 V48 H16 V40 H8 Z"/>' +
      '<path d="M16 24 V40 M32 24 V40 M40 24 V40 M16 24 H32 M16 40 H32" stroke-width="2" stroke-dasharray="2.5 3"/>',
  ),
  slots: [
    {
      id: 'net',
      label: L('Siatka pudełka', 'Box net'),
      hint: L(
        'Rząd: lewy bok | przód | prawy bok | tył; góra nad przodem, spód pod przodem. Pobierz szablon.',
        'Row: left | front | right | back; top above the front, bottom below it. Download the template.',
      ),
      aspect: aspectOf(netTemplate(DEFAULTS.w, DEFAULTS.h, DEFAULTS.d, BLEED_MM)),
      template: templateFor,
    },
  ],
  params: [
    widthParam(DEFAULTS.w),
    heightParam(DEFAULTS.h),
    depthParam(DEFAULTS.d),
    bevelParam,
    finishParam,
    bleedParam,
  ],
  defaultCamera: { yaw: 30, pitch: 12 },
  build: buildDielineBox,
};
