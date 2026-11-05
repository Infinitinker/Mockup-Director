/**
 * Cardboard / software product boxes.
 *
 *  - boxModel ('box')            – cuboid carton, separate artwork per face.
 *  - 'box-dieline'               – the same carton printed from ONE cross-shaped net image.
 *  - 'box-slim'                  – two-piece telescoping box (lid over a base), lying or standing.
 *
 * Geometry: src/models/box/roundedBox.ts (bevelled cuboid with exact planar UVs per face).
 * Templates / params / materials: src/models/box/common.ts.
 */
import * as THREE from 'three';
import type { ImageSlotDef, LocalizedText, ModelContext, ModelDefinition, ParamValues, PrintTemplate } from '../core/types';
import { L } from './shared';
import {
  aspectOf,
  bevelParam,
  bleedOf,
  bleedParam,
  boxDims,
  colorOf,
  depthParam,
  edgeRadius,
  faceTemplate,
  finishOf,
  finishParam,
  heightParam,
  icon,
  regionMapper,
  sideColorParam,
  surfaceMaterial,
  widthParam,
  BLEED_MM,
} from './box/common';
import { FACE_INDEX, roundedBoxGeometry, type FaceId, type FaceUVMapper } from './box/roundedBox';
import { dielineBoxModel } from './box/dieline';
import { slimBoxModel } from './box/slim';

/** Default retail software / product box, mm. */
export const BOX_DEFAULTS = { w: 135, h: 190, d: 40 } as const;

/** Box slot ids (stable – composite models reuse them). */
export type BoxSlotId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

interface FaceSpec {
  slot: BoxSlotId;
  face: FaceId;
  label: LocalizedText;
  hint: LocalizedText;
  /** Trim size of the face in mm (w = horizontal as seen from outside). */
  size: (W: number, H: number, D: number) => [number, number];
}

const FACE_SPECS: readonly FaceSpec[] = [
  {
    slot: 'front',
    face: 'pz',
    label: L('Przód', 'Front'),
    hint: L('Główna grafika pudełka.', 'Main artwork of the box.'),
    size: (W, H) => [W, H],
  },
  {
    slot: 'back',
    face: 'nz',
    label: L('Tył', 'Back'),
    hint: L('Tył pudełka, oglądany od tyłu.', 'Back of the box, as seen from behind.'),
    size: (W, H) => [W, H],
  },
  {
    slot: 'left',
    face: 'nx',
    label: L('Lewy bok', 'Left side'),
    hint: L('Prawa krawędź grafiki przylega do przodu.', 'The right edge of the artwork meets the front.'),
    size: (_W, H, D) => [D, H],
  },
  {
    slot: 'right',
    face: 'px',
    label: L('Prawy bok', 'Right side'),
    hint: L('Lewa krawędź grafiki przylega do przodu.', 'The left edge of the artwork meets the front.'),
    size: (_W, H, D) => [D, H],
  },
  {
    slot: 'top',
    face: 'py',
    label: L('Góra', 'Top'),
    hint: L('Dolna krawędź grafiki przylega do przodu.', 'The bottom edge of the artwork meets the front.'),
    size: (W, _H, D) => [W, D],
  },
  {
    slot: 'bottom',
    face: 'ny',
    label: L('Spód', 'Bottom'),
    hint: L('Górna krawędź grafiki przylega do przodu.', 'The top edge of the artwork meets the front.'),
    size: (W, _H, D) => [W, D],
  },
];

/** Print template of one box face (trim = face size, 3 mm bleed unless switched off). */
function boxFaceTemplate(spec: FaceSpec, params: ParamValues): PrintTemplate {
  const { W, H, D } = boxDims(params, BOX_DEFAULTS);
  const [w, h] = spec.size(W, H, D);
  return faceTemplate(w, h, bleedOf(params), spec.label);
}

const BOX_SLOTS: ImageSlotDef[] = FACE_SPECS.map((spec) => {
  const [w, h] = spec.size(BOX_DEFAULTS.w, BOX_DEFAULTS.h, BOX_DEFAULTS.d);
  return {
    id: spec.slot,
    label: spec.label,
    hint: spec.hint,
    aspect: aspectOf(faceTemplate(w, h, BLEED_MM, spec.label)),
    template: (params: ParamValues) => boxFaceTemplate(spec, params),
  };
});

/**
 * Build the product box from ctx.params (ids: width, height, depth, bevel, finish, sideColor,
 * bleed) and slots front/back/left/right/top/bottom. Exported for composite models.
 * Root sits on y = 0, centred on x/z, front facing +Z.
 */
export function buildBox(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const { W, H, D } = boxDims(p, BOX_DEFAULTS);
  const finish = finishOf(p);

  const uv: Partial<Record<FaceId, FaceUVMapper>> = {};
  const materials: THREE.Material[] = new Array<THREE.Material>(6);
  let plain: THREE.Material | null = null; // one shared solid material for all faces without artwork

  for (const spec of FACE_SPECS) {
    const primary = spec.slot === 'front';
    if (primary || ctx.hasImage(spec.slot)) {
      const tpl = boxFaceTemplate(spec, p);
      uv[spec.face] = regionMapper(tpl, tpl.regions![0]);
      materials[FACE_INDEX[spec.face]] = surfaceMaterial(finish, { map: ctx.getTexture(spec.slot) });
    } else {
      plain ??= surfaceMaterial(finish, { color: colorOf(p, 'sideColor', sideColorParam.default) });
      materials[FACE_INDEX[spec.face]] = plain;
    }
  }

  const geo = roundedBoxGeometry({ width: W, height: H, depth: D, radius: edgeRadius(p, W, H, D), uv });
  const mesh = new THREE.Mesh(geo, materials);
  mesh.name = 'box';
  mesh.position.y = H / 2;
  mesh.castShadow = true;

  const root = new THREE.Group();
  root.name = 'box-root';
  root.add(mesh);
  return root;
}

export const boxModel: ModelDefinition = {
  id: 'box',
  category: 'box',
  name: L('Pudełko', 'Box'),
  description: L(
    'Kartonowe pudełko produktowe z osobną grafiką na każdej ściance.',
    'Cardboard product box with separate artwork for every face.',
  ),
  icon: icon('<path d="M14 20 H40 V56 H14 Z"/><path d="M14 20 L25 9 H51 L40 20"/><path d="M40 56 L51 45 V9"/>'),
  slots: BOX_SLOTS,
  params: [
    widthParam(BOX_DEFAULTS.w),
    heightParam(BOX_DEFAULTS.h),
    depthParam(BOX_DEFAULTS.d),
    bevelParam,
    finishParam,
    sideColorParam,
    bleedParam,
  ],
  defaultCamera: { yaw: 30, pitch: 12 },
  build: buildBox,
};

/** Additional box variants. */
export const extraBoxModels: ModelDefinition[] = [dielineBoxModel, slimBoxModel];
