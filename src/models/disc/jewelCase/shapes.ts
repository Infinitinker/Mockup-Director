/**
 * Geometry helpers of the CD jewel case: boxes spanning ranges, rectangles with a radius per
 * corner, profiles extruded along Y, the UVs of one box face, planes facing an axis, and template
 * rectangles as UV rectangles.
 */
import * as THREE from 'three';

/** Axis-aligned box geometry spanning the given ranges. */
export function boxGeo(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Rectangle shape with individual corner radii [bottom-left, bottom-right, top-right, top-left]. */
export function cornerShape(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  r: [number, number, number, number],
): THREE.Shape {
  const [bl, br, tr, tl] = r;
  const s = new THREE.Shape();
  s.moveTo(x0 + bl, y0);
  s.lineTo(x1 - br, y0);
  if (br > 0) s.quadraticCurveTo(x1, y0, x1, y0 + br);
  s.lineTo(x1, y1 - tr);
  if (tr > 0) s.quadraticCurveTo(x1, y1, x1 - tr, y1);
  s.lineTo(x0 + tl, y1);
  if (tl > 0) s.quadraticCurveTo(x0, y1, x0, y1 - tl);
  s.lineTo(x0, y0 + bl);
  if (bl > 0) s.quadraticCurveTo(x0, y0, x0 + bl, y0);
  return s;
}

/**
 * Extrude a profile drawn in the XZ plane (shape x = world x, shape y = world z) along +Y
 * from y0 to y1. Groups: 0 = end caps, 1 = profile walls.
 */
export function extrudeXZ(shape: THREE.Shape, y0: number, y1: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 8 });
  // rotateX(+90°): shape y → world z, extrusion (+local z) → world -y.
  g.rotateX(Math.PI / 2);
  g.translate(0, y1, 0);
  return g;
}

/** Remap the UVs of one BoxGeometry face (0 px, 1 nx, 2 py, 3 ny, 4 pz, 5 nz; 1 segment). */
export function remapBoxFace(g: THREE.BoxGeometry, face: number, u0: number, v0: number, u1: number, v1: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = face * 4; i < face * 4 + 4; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
}

/** Plane facing the given axis whose UVs read correctly when viewed from that side, mapped into a template rect. */
export function facingPlane(
  w: number,
  h: number,
  facing: '-z' | '+z' | '+x' | '-x',
  rect: [number, number, number, number] = [0, 0, 1, 1],
): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (facing === '-z') g.rotateY(Math.PI);
  else if (facing === '+x') g.rotateY(Math.PI / 2);
  else if (facing === '-x') g.rotateY(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = rect;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true;
  return g;
}

/** Template rect (mm from the top-left, incl. bleed) → UV rect [u0, v0, u1, v1] (v = 0 bottom). */
export function uvRect(
  xMm: number,
  yMm: number,
  wMm: number,
  hMm: number,
  tw: number,
  th: number,
): [number, number, number, number] {
  return [xMm / tw, 1 - (yMm + hMm) / th, (xMm + wMm) / tw, 1 - yMm / th];
}
