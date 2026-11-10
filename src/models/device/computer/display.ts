/**
 * The lit display of the laptop and the monitor: the active area's size from its diagonal, the
 * screen mesh, the screen and bezel materials, the decal marking both use for thin parts lying over
 * another surface, and the Screen parameters both share.
 *
 * Screens: one image slot 'screen' per model. The screen is a separate mesh whose material uses
 * the image both as `map` and as `emissiveMap` (emissive white, "Screen brightness" param), on a dark base
 * color with a clear-coat glass layer, so it glows like a lit panel and still reflects the studio.
 * The image always fills the active screen area; with "Artwork fit: Fill" its center is cropped (via UVs –
 * the shared texture is never touched) when the image aspect differs from the screen's.
 */
import * as THREE from 'three';
import type { ModelContext, ParamDef } from '../../../core/types/model';
import { clamp } from '../../../core/math';
import { remapUVs } from '../../geometry';
import { bool, num, str } from '../../params';

/**
 * Marks a material as a thin decal lying a few hundredths of a mm over another surface: a
 * negative polygonOffset (`level` 1 = over the body, higher = stacked on top of a lower decal)
 * keeps it on top even when the depth buffer is coarse (tele lens, zoomed-out framing).
 */
export function decal<M extends THREE.Material>(mat: M, level = 1): M {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -level;
  mat.polygonOffsetUnits = -level;
  return mat;
}

const INCH = 25.4;

/** Width / height (mm) of a screen's active area from its diagonal (inches) and aspect ratio. */
export function screenSize(diagIn: number, aspect: number): [number, number] {
  const d = diagIn * INCH;
  const h = d / Math.sqrt(aspect * aspect + 1);
  return [h * aspect, h];
}

/** Pixel aspect (w / h) of a texture's image, or null when unknown. */
function imageAspect(tex: THREE.Texture): number | null {
  const img = tex.image as
    | { width?: number; height?: number; videoWidth?: number; videoHeight?: number }
    | null
    | undefined;
  if (!img) return null;
  const w = img.videoWidth || img.width || 0;
  const h = img.videoHeight || img.height || 0;
  return w > 0 && h > 0 ? w / h : null;
}

/**
 * Remaps a geometry's 0..1 UVs so the image covers a screen of aspect `screenAspect`:
 * 'fill' crops the image center (no distortion), 'stretch' maps the whole image.
 */
function fitScreenUVs(geo: THREE.BufferGeometry, tex: THREE.Texture, screenAspect: number, fit: string): void {
  const ia = imageAspect(tex);
  if (fit === 'stretch' || ia === null || Math.abs(ia - screenAspect) < 1e-3) return;
  if (ia > screenAspect) {
    const k = screenAspect / ia; // visible fraction of the image width
    remapUVs(geo, (1 - k) / 2, 0, (1 + k) / 2, 1);
  } else {
    const k = ia / screenAspect; // visible fraction of the image height
    remapUVs(geo, 0, (1 - k) / 2, 1, (1 + k) / 2);
  }
}

/** Lit display panel (image as map + emissive map) or a switched-off black panel. */
function screenMaterial(ctx: ModelContext): THREE.MeshPhysicalMaterial {
  const p = ctx.params;
  const glossy = str(p, 'screenFinish', 'glossy') !== 'matte';
  const on = bool(p, 'screenOn', true);
  const mat = new THREE.MeshPhysicalMaterial({
    color: on ? '#1c1c1e' : '#060708',
    roughness: glossy ? 0.22 : 0.62,
    metalness: 0,
    clearcoat: glossy ? 1 : 0.15,
    clearcoatRoughness: glossy ? 0.03 : 0.5,
  });
  if (on) {
    const tex = ctx.getTexture('screen');
    mat.map = tex;
    mat.emissiveMap = tex;
    mat.emissive = new THREE.Color('#ffffff');
    mat.emissiveIntensity = clamp(num(p, 'brightness', 90), 0, 200) / 100;
  }
  return decal(mat, 2);
}

/** Black cover glass / bezel around the active area (same finish as the screen). */
export function bezelMaterial(ctx: ModelContext): THREE.MeshPhysicalMaterial {
  const glossy = str(ctx.params, 'screenFinish', 'glossy') !== 'matte';
  return decal(
    new THREE.MeshPhysicalMaterial({
      color: '#08090a',
      roughness: glossy ? 0.2 : 0.6,
      metalness: 0,
      clearcoat: glossy ? 1 : 0.1,
      clearcoatRoughness: glossy ? 0.03 : 0.5,
    }),
    1,
  );
}

/**
 * The screen mesh: a w × h plane (PlaneGeometry: u 0 → 1 left → right, v 0 → 1 bottom → top as
 * seen from the front / +Z, so the image is upright and not mirrored), optionally bent.
 */
export function screenMesh(ctx: ModelContext, w: number, h: number, segX: number, R: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, h, R > 0 ? segX : 1, 1);
  const mat = screenMaterial(ctx);
  if (mat.map) fitScreenUVs(geo, mat.map, w / h, str(ctx.params, 'fit', 'fill'));
  const m = new THREE.Mesh(geo, mat);
  m.name = 'screen';
  return m;
}

const G_SCREEN = 'Screen';

/** The Screen parameters of the laptop and the monitor. */
export const SCREEN_PARAMS: ParamDef[] = [
  {
    id: 'screenOn',
    type: 'boolean',
    label: 'Screen on',
    group: G_SCREEN,
    default: true,
  },
  {
    id: 'brightness',
    type: 'number',
    label: 'Screen brightness',
    group: G_SCREEN,
    min: 0,
    max: 200,
    step: 5,
    default: 90,
    unit: '%',
  },
  {
    id: 'screenFinish',
    type: 'select',
    label: 'Screen finish',
    group: G_SCREEN,
    options: [
      { value: 'glossy', label: 'Glossy (glass)' },
      { value: 'matte', label: 'Matte (anti-glare)' },
    ],
    default: 'glossy',
  },
  {
    id: 'fit',
    type: 'select',
    label: 'Artwork fit',
    group: G_SCREEN,
    options: [
      { value: 'fill', label: 'Fill (crop the excess)' },
      { value: 'stretch', label: 'Stretch' },
    ],
    default: 'fill',
  },
];
