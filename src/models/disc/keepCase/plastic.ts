/**
 * The keep case's molded plastic: rounded slab geometry for the body and the Blu-ray band, and the
 * plastic and parting-line materials.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../../../core/math';
import type { PlasticDef } from './specs';

/** Rectangle with circular corners (separate radius for top and bottom corners). */
export function roundedRect(x0: number, y0: number, x1: number, y1: number, rTop: number, rBot: number): THREE.Shape {
  const lim = Math.min(x1 - x0, y1 - y0) / 2 - 1e-3;
  const rt = clamp(rTop, 0, lim);
  const rb = clamp(rBot, 0, lim);
  const s = new THREE.Shape();
  s.moveTo(x0 + rb, y0);
  s.lineTo(x1 - rb, y0);
  if (rb > 0) s.absarc(x1 - rb, y0 + rb, rb, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - rt);
  if (rt > 0) s.absarc(x1 - rt, y1 - rt, rt, 0, Math.PI / 2, false);
  s.lineTo(x0 + rt, y1);
  if (rt > 0) s.absarc(x0 + rt, y1 - rt, rt, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rb);
  if (rb > 0) s.absarc(x0 + rb, y0 + rb, rb, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * Smooth rounded slab: the front-view `base` shape grown by `bevel` on every side and extruded to
 * a total depth `thickness` centered on z = 0. The bevel profile is a quarter circle that is tangent
 * to both faces, so merging vertices + recomputing normals gives a seamless smooth surface.
 */
export function roundedSlab(base: THREE.Shape, thickness: number, bevel: number): THREE.BufferGeometry {
  const depth = Math.max(0.01, thickness - 2 * bevel);
  const ext = new THREE.ExtrudeGeometry(base, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 5,
    curveSegments: 6,
  });
  ext.translate(0, 0, -depth / 2);
  ext.deleteAttribute('uv');
  ext.deleteAttribute('normal');
  const geo = mergeVertices(ext, 1e-4);
  ext.dispose();
  geo.computeVertexNormals();
  return geo;
}

export function plasticMaterial(def: PlasticDef): THREE.MeshPhysicalMaterial {
  if (def.opacity !== undefined) {
    return new THREE.MeshPhysicalMaterial({
      color: def.color,
      roughness: def.roughness,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: def.opacity,
      depthWrite: false,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: def.color,
    roughness: def.roughness,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
  });
}

/** Dark mold parting line between the two halves of the case. */
export function seamMaterial(def: PlasticDef): THREE.MeshStandardMaterial {
  const c = new THREE.Color(def.color).multiplyScalar(0.25);
  const translucent = def.opacity !== undefined;
  return new THREE.MeshStandardMaterial({
    color: c,
    roughness: 0.7,
    metalness: 0,
    transparent: translucent,
    opacity: translucent ? Math.min(1, (def.opacity ?? 1) + 0.25) : 1,
    depthWrite: !translucent,
  });
}
