/**
 * Bending the screenshot panel and the browser window: the bend radius from the Curvature parameter,
 * and a flat-built geometry bent onto it.
 *
 * Bending: a flat point (x, y, z) maps onto a cylinder whose axis is parallel to Y at z = rho
 * (signed radius, rho > 0 = concave – the edges come toward the viewer like a curved monitor,
 * rho < 0 = convex):  angle a = x / rho,  x' = (rho - z)·sin a,  z' = rho - (rho - z)·cos a.
 * The FRONT surface (z = 0) keeps its arc length (x' along the arc = x), and the image's u is
 * linear in x, so the artwork is not distorted along the arc. Normals are rotated by -a about Y.
 * Faces only need subdividing along X (bending is linear in Y), so every face is a single strip of
 * columns from its bottom edge to its top edge.
 */
import type * as THREE from 'three';
import { clamp } from '../../../core/math';

/** Strongest bend (curvature 100 %): the panel's front covers this much of a circle. */
const MAX_BEND = (160 * Math.PI) / 180;

const DEG = Math.PI / 180;

/** Bend radius + subdivision count from the curvature param (-100..100 %). */
export function bendOf(W: number, curvaturePct: number): { rho: number; midSegs: number } {
  const c = clamp(curvaturePct, -100, 100) / 100;
  if (Math.abs(c) < 1e-3) return { rho: Infinity, midSegs: 1 };
  const theta = Math.abs(c) * MAX_BEND;
  return { rho: Math.sign(c) * (W / theta), midSegs: clamp(Math.ceil(theta / DEG / 1.5), 4, 120) };
}

/** Bend a flat-built geometry onto the cylinder of signed radius rho (no-op when flat). */
export function bendGeometry(geo: THREE.BufferGeometry, rho: number): void {
  if (!Number.isFinite(rho)) return;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const a = x / rho;
    const rr = rho - z;
    pos.setXYZ(i, rr * Math.sin(a), pos.getY(i), rho - rr * Math.cos(a));
    if (nor) {
      const c = Math.cos(-a);
      const s = Math.sin(-a);
      const nx = nor.getX(i);
      const nz = nor.getZ(i);
      nor.setXYZ(i, nx * c + nz * s, nor.getY(i), -nx * s + nz * c);
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}
