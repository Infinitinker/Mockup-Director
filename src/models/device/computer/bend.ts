/**
 * Bending a display around a vertical axis for the curved monitor: a point, and a whole geometry with
 * its normals, wrapped onto a cylinder so the front surface keeps its arc length. A radius of 0 means
 * flat.
 */
import type * as THREE from 'three';

/**
 * Bends a point of a display (front surface at z = 0, facing +Z) around a vertical axis at
 * (x = 0, z = R) – a concave screen whose edges come toward the viewer. Arc length along the
 * front surface is preserved (x = R·φ). R = 0 means flat.
 */
export function bendXZ(x: number, z: number, R: number): [number, number] {
  if (R <= 0) return [x, z];
  const phi = x / R;
  const rr = R - z;
  return [rr * Math.sin(phi), R - rr * Math.cos(phi)];
}

/** Applies bendXZ() to a geometry's positions and rotates its normals by the local bend angle. */
export function bendGeometry(geo: THREE.BufferGeometry, R: number): THREE.BufferGeometry {
  if (R <= 0) return geo;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const [bx, bz] = bendXZ(x, pos.getZ(i), R);
    pos.setX(i, bx);
    pos.setZ(i, bz);
    if (nor) {
      const phi = x / R;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const nx = nor.getX(i);
      const nz = nor.getZ(i);
      nor.setX(i, nx * c - nz * s);
      nor.setZ(i, nx * s + nz * c);
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
