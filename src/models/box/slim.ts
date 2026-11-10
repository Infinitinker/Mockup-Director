/**
 * Two-piece telescoping box ("lid & base"): a lid shell that is slightly larger than the base and
 * covers its upper part – the typical board-game / gift / smartphone / cosmetics box.
 *
 * Built lying flat (lid top facing +Y): width W along x, length H along z, thickness D along y.
 * The lid's outer size is W x H (= the main artwork). The base is inset by the board thickness on
 * every side, so a fine step (the lid edge) is visible around the box at (100 % − lid height) of the
 * thickness. "Standing" rotates the whole box so the lid top faces the camera (+Z) with the lid
 * artwork upright (the box stands on its front wall, the opening faces away from the viewer).
 *
 * Artwork:
 *  - 'lid'      (primary) lid top, W x H.
 *  - 'lidSides' the four lid walls as one band: front | right | back | left (height = lid height).
 *  - 'base'     the visible part of the base walls as one band (same order).
 * Bands read upright when the box lies flat; empty bands use the color params.
 */
import * as THREE from 'three';
import type {
  ModelContext,
  ModelDefinition,
  NumberParamDef,
  ParamValues,
  PrintTemplate,
  SelectParamDef,
} from '../../core/types/model';
import { placeOnGround } from '../geometry';
import { num, str } from '../params';
import {
  aspectOf,
  bandTemplate,
  bevelParam,
  bleedOf,
  bleedParam,
  colorOf,
  colorParam,
  depthParam,
  edgeRadius,
  faceTemplate,
  finishOf,
  finishParam,
  G_DIM,
  heightParam,
  icon,
  regionMapper,
  sideColorParam,
  surfaceMaterial,
  widthParam,
  BLEED_MM,
  type Finish,
} from './common';
import { FACE_INDEX, roundedBoxGeometry, type FaceId, type FaceUVMapper } from './roundedBox';

const DEFAULTS = { w: 180, h: 240, d: 40, cover: 67 } as const;

/* ------------------------------------------------------------------ */
/* Params                                                              */
/* ------------------------------------------------------------------ */

const lidCoverParam: NumberParamDef = {
  id: 'lidCover',
  label: 'Lid height',
  type: 'number',
  min: 30,
  max: 100,
  step: 1,
  default: DEFAULTS.cover,
  unit: '%',
  group: G_DIM,
};

const orientationParam: SelectParamDef = {
  id: 'orientation',
  label: 'Placement',
  type: 'select',
  options: [
    { value: 'flat', label: 'Lying flat (lid up)' },
    { value: 'upright', label: 'Standing (lid facing front)' },
  ],
  default: 'flat',
  group: G_DIM,
};

const baseColorParam = colorParam('baseColor', 'Base color (no artwork)', '#d8d4cc');

/* ------------------------------------------------------------------ */
/* Dimensions & templates                                              */
/* ------------------------------------------------------------------ */

interface SlimDims {
  W: number;
  H: number;
  D: number;
  /** lid wall height */
  lidH: number;
  /** visible height of the base below the lid (0 for a full-telescope lid) */
  baseVis: number;
  /** inset of the base = lid board thickness */
  t: number;
}

function slimDims(params: ParamValues): SlimDims {
  const W = Math.max(5, num(params, 'width', DEFAULTS.w));
  const H = Math.max(5, num(params, 'height', DEFAULTS.h));
  const D = Math.max(2, num(params, 'depth', DEFAULTS.d));
  const cover = Math.min(100, Math.max(lidCoverParam.min, num(params, 'lidCover', DEFAULTS.cover))) / 100;
  const lidH = D * cover;
  return { W, H, D, lidH, baseVis: D - lidH, t: Math.min(1.5, Math.min(W, H) * 0.05) };
}

const LID_LABEL = 'Lid – top';

function lidTemplate(params: ParamValues): PrintTemplate {
  const { W, H } = slimDims(params);
  return faceTemplate(W, H, bleedOf(params), LID_LABEL);
}

/** Band panels in wrap order (front | right | back | left) for a w x l footprint. */
function wallPanels(w: number, l: number) {
  return [
    { w, label: 'Front' },
    { w: l, label: 'Right side' },
    { w, label: 'Back' },
    { w: l, label: 'Left side' },
  ];
}
/** Faces matching wallPanels() order. */
const WALL_FACES: readonly FaceId[] = ['pz', 'px', 'nz', 'nx'];

function lidSidesTemplate(params: ParamValues): PrintTemplate {
  const { W, H, lidH } = slimDims(params);
  return bandTemplate(wallPanels(W, H), lidH, bleedOf(params));
}

function baseTemplate(params: ParamValues): PrintTemplate {
  const { W, H, baseVis, t } = slimDims(params);
  return bandTemplate(wallPanels(W - 2 * t, H - 2 * t), Math.max(1, baseVis), bleedOf(params));
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/** Lazily created solid material, shared by every face that uses it within one build. */
function solid(finish: Finish, color: string): () => THREE.Material {
  let m: THREE.Material | null = null;
  return () => (m ??= surfaceMaterial(finish, { color }));
}

function buildSlimBox(ctx: ModelContext): THREE.Object3D {
  const p = ctx.params;
  const dims = slimDims(p);
  const { W, H, D, lidH, baseVis, t } = dims;
  const finish = finishOf(p);
  const sidePlain = solid(finish, colorOf(p, 'sideColor', sideColorParam.default));
  const basePlain = solid(finish, colorOf(p, 'baseColor', baseColorParam.default));
  const hasBase = baseVis > 0.05;

  const inner = new THREE.Group(); // lying flat, bottom on y = 0
  inner.name = 'box-slim';

  /* ---- Lid ---- */
  const lidUV: Partial<Record<FaceId, FaceUVMapper>> = {};
  const lidMats: THREE.Material[] = new Array<THREE.Material>(6);
  const lidTpl = lidTemplate(p);
  lidUV.py = regionMapper(lidTpl, 0);
  lidMats[FACE_INDEX.py] = surfaceMaterial(finish, { map: ctx.getTexture('lid') });

  const lidSidesMat = ctx.hasArtwork('lidSides') ? surfaceMaterial(finish, { map: ctx.getTexture('lidSides') }) : null;
  const sidesTpl = lidSidesTemplate(p);
  WALL_FACES.forEach((face, i) => {
    if (lidSidesMat) lidUV[face] = regionMapper(sidesTpl, i);
    lidMats[FACE_INDEX[face]] = lidSidesMat ?? sidePlain();
  });
  // Underside of the lid: the narrow rim around the base – or the whole bottom of a full-telescope box.
  lidMats[FACE_INDEX.ny] = hasBase ? sidePlain() : basePlain();

  const lid = new THREE.Mesh(
    roundedBoxGeometry({ width: W, height: lidH, depth: H, radius: edgeRadius(p, W, lidH, H), uv: lidUV }),
    lidMats,
  );
  lid.name = 'lid';
  lid.position.y = D - lidH / 2;
  lid.castShadow = true;
  inner.add(lid);

  /* ---- Base (only the part below the lid plus a small hidden overlap) ---- */
  if (hasBase) {
    const overlap = Math.min(2, lidH * 0.5);
    const hb = baseVis + overlap;
    const baseUV: Partial<Record<FaceId, FaceUVMapper>> = {};
    const baseMats: THREE.Material[] = new Array<THREE.Material>(6);
    const baseMat = ctx.hasArtwork('base') ? surfaceMaterial(finish, { map: ctx.getTexture('base') }) : null;
    const tpl = baseTemplate(p);
    // Region covers the VISIBLE height only. The hidden overlap above it runs on into the top
    // bleed of the band (rectMapper extrapolates linearly) and is clamped at the bleed's outer
    // edge; without bleed it repeats the top trim row. A large lid bevel can curve inwards past
    // the base wall and reveal a little of this strip, so it must carry real artwork.
    const regionH = Math.max(1, baseVis); // same height baseTemplate() gives the regions
    const maxT = (regionH + bleedOf(p)) / regionH;
    WALL_FACES.forEach((face, i) => {
      if (baseMat) {
        const m = regionMapper(tpl, i);
        baseUV[face] = (s, tt) => m(s, Math.min(maxT, (tt * hb) / baseVis));
      }
      baseMats[FACE_INDEX[face]] = baseMat ?? basePlain();
    });
    baseMats[FACE_INDEX.ny] = basePlain();
    baseMats[FACE_INDEX.py] = basePlain(); // skipped (hidden inside the lid) – entry kept for indexing

    const base = new THREE.Mesh(
      roundedBoxGeometry({
        width: W - 2 * t,
        height: hb,
        depth: H - 2 * t,
        radius: Math.min(edgeRadius(p, W - 2 * t, hb, H - 2 * t), 1.5),
        uv: baseUV,
        skip: ['py'],
      }),
      baseMats,
    );
    base.name = 'base';
    base.position.y = hb / 2;
    base.castShadow = true;
    inner.add(base);
  }

  const root = new THREE.Group();
  root.name = 'box-slim-root';
  root.add(inner);
  if (str(p, 'orientation', 'flat') === 'upright') {
    // +90° about X: lid top (+Y) → +Z (facing the camera), back wall (−Z) → up, so the lid artwork reads upright.
    inner.rotation.x = Math.PI / 2;
    placeOnGround(inner);
  }
  return root;
}

/* ------------------------------------------------------------------ */
/* Definition                                                          */
/* ------------------------------------------------------------------ */

const DEF_DIMS = slimDims({});

export const slimBoxModel: ModelDefinition = {
  id: 'box-slim',
  category: 'box',
  name: 'Slim box',
  description:
    'Flat two-piece box with a lid over a base (board game, gift, phone, cosmetics), lying flat or standing.',
  icon: icon(
    '<path d="M8 30 L22 20 H56 L42 30 Z"/><path d="M8 30 V44 H42 V30"/><path d="M42 44 L56 34 V20"/>' +
      '<path d="M8 39 H42 L56 29" stroke-width="2"/>',
  ),
  slots: [
    {
      id: 'lid',
      label: LID_LABEL,
      hint: 'Main artwork on the lid.',
      aspect: aspectOf(faceTemplate(DEF_DIMS.W, DEF_DIMS.H, BLEED_MM, LID_LABEL)),
      template: lidTemplate,
    },
    {
      id: 'lidSides',
      label: 'Lid – sides',
      hint: 'The four lid walls in one band: front | right | back | left.',
      aspect: aspectOf(bandTemplate(wallPanels(DEF_DIMS.W, DEF_DIMS.H), DEF_DIMS.lidH, BLEED_MM)),
      template: lidSidesTemplate,
    },
    {
      id: 'base',
      label: 'Base – sides',
      hint: 'The visible part of the base below the lid, in the same band layout.',
      aspect: aspectOf(
        bandTemplate(wallPanels(DEF_DIMS.W - 2 * DEF_DIMS.t, DEF_DIMS.H - 2 * DEF_DIMS.t), DEF_DIMS.baseVis, BLEED_MM),
      ),
      template: baseTemplate,
    },
  ],
  params: [
    widthParam(DEFAULTS.w, 20),
    heightParam(DEFAULTS.h, 20, 600, 'Length'),
    depthParam(DEFAULTS.d, 5, 200, 'Thickness'),
    lidCoverParam,
    orientationParam,
    bevelParam,
    finishParam,
    sideColorParam,
    baseColorParam,
    bleedParam,
  ],
  defaultCamera: { yaw: 30, pitch: 30 },
  build: buildSlimBox,
};
