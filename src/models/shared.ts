/**
 * Small helpers shared by all models. Model files may ADD private helpers in their own
 * files, but should not change the behaviour of these.
 */
import * as THREE from 'three';
import type { NumberParamDef, ParamValues } from '../core/types';

/** Dispose geometries and materials of a tree (and textures flagged userData.disposeWithModel). */
export function disposeObject(root: THREE.Object3D | null | undefined): void {
  if (!root) return;
  const mats = new Set<THREE.Material>();
  const geos = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      list.forEach((x) => {
        mats.add(x);
      });
    }
  });
  geos.forEach((g) => {
    g.dispose();
  });
  mats.forEach((mat) => {
    for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
      if (v instanceof THREE.Texture && v.userData?.disposeWithModel) v.dispose();
    }
    mat.dispose();
  });
}

/** Rounded rectangle centred on the origin (XY plane). r is clamped to fit. */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const rr = Math.max(0, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4));
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  if (rr <= 0) {
    s.moveTo(x, y);
    s.lineTo(x + w, y);
    s.lineTo(x + w, y + h);
    s.lineTo(x, y + h);
    s.closePath();
    return s;
  }
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

/** Remap a geometry's existing 0..1 UVs into the sub-rectangle [u0,u1] x [v0,v1] (v = 0 is the image BOTTOM). */
export function remapUVs(
  geo: THREE.BufferGeometry,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Planar UV projection: u from the vertex's `uAxis` coordinate, v from `vAxis`, normalised over
 * the given ranges, then mapped into [u0,u1] x [v0,v1]. Handy for ExtrudeGeometry caps.
 */
export function planarUVs(
  geo: THREE.BufferGeometry,
  uAxis: 'x' | 'y' | 'z',
  vAxis: 'x' | 'y' | 'z',
  uRange: [number, number],
  vRange: [number, number],
  rect: [number, number, number, number] = [0, 0, 1, 1],
): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uvs = new Float32Array(pos.count * 2);
  const get = (i: number, a: 'x' | 'y' | 'z') => (a === 'x' ? pos.getX(i) : a === 'y' ? pos.getY(i) : pos.getZ(i));
  const [u0, v0, u1, v1] = rect;
  for (let i = 0; i < pos.count; i++) {
    const nu = (get(i, uAxis) - uRange[0]) / (uRange[1] - uRange[0]);
    const nv = (get(i, vAxis) - vRange[0]) / (vRange[1] - vRange[0]);
    uvs[i * 2] = u0 + nu * (u1 - u0);
    uvs[i * 2 + 1] = v0 + nv * (v1 - v0);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

/** Printed paper/cardboard surface. */
export function printMaterial(
  map: THREE.Texture,
  opts: { roughness?: number; metalness?: number; gloss?: number } = {},
): THREE.MeshPhysicalMaterial {
  const gloss = opts.gloss ?? 0;
  return new THREE.MeshPhysicalMaterial({
    map,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0,
    clearcoat: gloss,
    clearcoatRoughness: 0.08,
  });
}

/** Opaque plastic. */
export function solidPlastic(color: THREE.ColorRepresentation, roughness = 0.35): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.2 });
}

/**
 * Clear (see-through) plastic film / case. Uses plain alpha blending (no transmission pass) so it
 * stays fast and works with transparent exports.
 */
export function clearPlastic(
  opts: { tint?: THREE.ColorRepresentation; opacity?: number; roughness?: number } = {},
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: opts.tint ?? '#ffffff',
    transparent: true,
    opacity: opts.opacity ?? 0.12,
    roughness: opts.roughness ?? 0.04,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Read a numeric param with fallback. */
export function num(params: ParamValues, id: string, fallback: number): number {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
export function bool(params: ParamValues, id: string, fallback: boolean): boolean {
  const v = params[id];
  return typeof v === 'boolean' ? v : fallback;
}
export function str(params: ParamValues, id: string, fallback: string): string {
  const v = params[id];
  return typeof v === 'string' ? v : fallback;
}

/** Rounds to one decimal place, for sizes shown in texts (129.53 → 129.5). */
export const round1 = (v: number): number => Math.round(v * 10) / 10;

export function mmParam(
  id: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step = 1,
  group?: string,
): NumberParamDef {
  return {
    id,
    label,
    type: 'number',
    min,
    max,
    step,
    default: def,
    unit: 'mm',
    ...(group === undefined ? {} : { group }),
  };
}

/** Mark every mesh in the tree as shadow-casting. */
export function castShadows(root: THREE.Object3D): THREE.Object3D {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return root;
}

/** Put the object's lowest point on y = 0 and centre it on x/z. */
export function placeOnGround(root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return root;
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y -= box.min.y;
  return root;
}
