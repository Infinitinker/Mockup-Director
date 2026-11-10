/**
 * Shared pieces of the box models: parameter definitions, surface finishes and print-template
 * helpers. The UV mapping of every model is derived FROM its print template (regionMapper), so the
 * downloadable template and the 3D mapping can never drift apart.
 */
import * as THREE from 'three';
import type {
  BooleanParamDef,
  ColorParamDef,
  NumberParamDef,
  ParamValues,
  PrintTemplate,
  SelectParamDef,
  TemplateGuide,
  TemplateRegion,
} from '../../core/types/model';
import { bool, mmParam, num, str } from '../params';
import { rectMapper, type FaceUVMapper } from './roundedBox';

/* ------------------------------------------------------------------ */
/* Parameters                                                          */
/* ------------------------------------------------------------------ */

export const G_DIM = 'Dimensions';
const G_MAT = 'Material';
const G_ART = 'Artwork';

/** Standard print bleed. */
export const BLEED_MM = 3;

export function widthParam(def: number, min = 10, max = 600): NumberParamDef {
  return mmParam('width', 'Width', def, min, max, 1, G_DIM);
}
export function heightParam(def: number, min = 10, max = 600, label = 'Height'): NumberParamDef {
  return mmParam('height', label, def, min, max, 1, G_DIM);
}
export function depthParam(def: number, min = 10, max = 600, label = 'Depth'): NumberParamDef {
  return mmParam('depth', label, def, min, max, 1, G_DIM);
}

export const bevelParam: NumberParamDef = {
  id: 'bevel',
  label: 'Edge rounding',
  type: 'number',
  min: 0,
  max: 6,
  step: 0.1,
  default: 0.8,
  unit: 'mm',
  group: G_MAT,
};

/**
 * Effective edge radius: the 'bevel' param, limited to 20 % of the smallest of the given dimensions
 * so tiny boxes stay boxes (a real carton fold never rounds more than that).
 */
export function edgeRadius(params: ParamValues, ...dims: number[]): number {
  return Math.max(0, Math.min(num(params, 'bevel', bevelParam.default), 0.2 * Math.min(...dims)));
}

export type Finish = 'matte' | 'satin' | 'glossy';
export const finishParam: SelectParamDef = {
  id: 'finish',
  label: 'Finish',
  type: 'select',
  options: [
    { value: 'matte', label: 'Matte (paper / matte laminate)' },
    { value: 'satin', label: 'Satin' },
    { value: 'glossy', label: 'Gloss laminate' },
  ],
  default: 'satin',
  group: G_MAT,
};

export function colorParam(id: string, label: string, def: string, group: string = G_MAT): ColorParamDef {
  return { id, label, type: 'color', default: def, group };
}

export const sideColorParam = colorParam('sideColor', 'Color of faces without artwork', '#f2f1ee');

export const bleedParam: BooleanParamDef = {
  id: 'bleed',
  label: 'Artwork includes 3 mm bleed',
  type: 'boolean',
  default: true,
  group: G_ART,
};

/** Bleed in mm actually present in the artwork (depends on the 'bleed' switch). */
export function bleedOf(params: ParamValues): number {
  return bool(params, 'bleed', true) ? BLEED_MM : 0;
}

export function finishOf(params: ParamValues): Finish {
  const f = str(params, 'finish', 'satin');
  return f === 'matte' || f === 'glossy' ? f : 'satin';
}

export function colorOf(params: ParamValues, id: string, fallback: string): string {
  const c = str(params, id, fallback);
  return /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
}

/** Box outer dimensions (mm) from the standard width/height/depth params. */
export function boxDims(
  params: ParamValues,
  def: { w: number; h: number; d: number },
): { W: number; H: number; D: number } {
  return {
    W: Math.max(1, num(params, 'width', def.w)),
    H: Math.max(1, num(params, 'height', def.h)),
    D: Math.max(1, num(params, 'depth', def.d)),
  };
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

/**
 * Printed carton surface. Matte = uncoated/matte-laminated board, satin = coated board with a soft
 * sheen, glossy = gloss laminate (a sharp clear-coat reflection over the print).
 */
export function surfaceMaterial(
  finish: Finish,
  src: { map: THREE.Texture } | { color: string },
): THREE.MeshPhysicalMaterial {
  const look =
    finish === 'matte'
      ? { roughness: 0.82, clearcoat: 0, clearcoatRoughness: 0.5 }
      : finish === 'glossy'
        ? { roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.05 }
        : { roughness: 0.58, clearcoat: 0.35, clearcoatRoughness: 0.28 };
  const mat = new THREE.MeshPhysicalMaterial({ ...look, metalness: 0 });
  if ('map' in src) mat.map = src.map;
  else mat.color.set(src.color);
  return mat;
}

/* ------------------------------------------------------------------ */
/* Print templates                                                     */
/* ------------------------------------------------------------------ */

export const FOLD = 'Fold';

/** Template for a single face: trim w x h plus bleed on every side. */
export function faceTemplate(w: number, h: number, b: number, label: string): PrintTemplate {
  return {
    widthMm: w + 2 * b,
    heightMm: h + 2 * b,
    bleedMm: b,
    regions: [{ xMm: b, yMm: b, wMm: w, hMm: h, label }],
  };
}

/**
 * Horizontal band of panels side by side (e.g. the four walls of a lid), all of height h, with
 * fold guides between neighbors and bleed around the whole band.
 */
export function bandTemplate(panels: { w: number; label: string }[], h: number, b: number): PrintTemplate {
  const regions: TemplateRegion[] = [];
  const guides: TemplateGuide[] = [];
  let x = b;
  panels.forEach((p, i) => {
    if (i > 0) guides.push({ orientation: 'v', posMm: x, label: FOLD });
    regions.push({ xMm: x, yMm: b, wMm: p.w, hMm: h, label: p.label });
    x += p.w;
  });
  return { widthMm: x + b, heightMm: h + 2 * b, bleedMm: b, regions, guides };
}

/**
 * UV mapper for a template region: the region's trim rectangle (measured from the template's
 * top-left, bleed included) is mapped edge-to-edge onto a face.
 */
export function regionMapper(tpl: PrintTemplate, index: number): FaceUVMapper {
  const region = tpl.regions?.[index];
  if (!region) throw new Error(`The print template has no region ${index}.`);
  const u0 = region.xMm / tpl.widthMm;
  const u1 = (region.xMm + region.wMm) / tpl.widthMm;
  const v1 = 1 - region.yMm / tpl.heightMm; // image top = v 1
  const v0 = 1 - (region.yMm + region.hMm) / tpl.heightMm;
  return rectMapper(u0, v0, u1, v1);
}

/** Aspect ratio (w / h) of a template – used for ImageSlotDef.aspect. */
export function aspectOf(tpl: PrintTemplate): number {
  return tpl.widthMm / tpl.heightMm;
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/** Wrap icon paths in the common SVG frame (64x64, line art, currentColor). */
export function icon(body: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" ' +
    'stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' +
    body +
    '</svg>'
  );
}
