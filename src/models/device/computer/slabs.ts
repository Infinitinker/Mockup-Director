/**
 * The rounded solids the laptop and the monitor are made of: rounded-rectangle outlines, extruded
 * slabs with round edges and smooth caps, and the bendable top-view section of a display.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../../../core/math';
import { bendXZ } from './bend';

/**
 * Rounded rectangle Shape centered on (cx, cy) in the XY plane (counter-clockwise).
 * `rBottom` (default = r) sets a different radius for the two bottom corners.
 */
export function rrShape(cx: number, cy: number, w: number, h: number, r: number, rBottom = r): THREE.Shape {
  const lim = Math.min(w, h) / 2 - 1e-3;
  const rr = clamp(r, 0, lim);
  const rb = clamp(rBottom, 0, lim);
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + rb, y0);
  s.lineTo(x1 - rb, y0);
  if (rb > 0) s.absarc(x1 - rb, y0 + rb, rb, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - rr);
  if (rr > 0) s.absarc(x1 - rr, y1 - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x0 + rr, y1);
  if (rr > 0) s.absarc(x0 + rr, y1 - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rb);
  if (rb > 0) s.absarc(x0 + rb, y0 + rb, rb, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * Turns a beveled ExtrudeGeometry (extruded from zLo to zHi, bevel b) into a smooth indexed mesh.
 * The quarter-circle bevel is tangent to the caps and to the walls, so after merging vertices the
 * normals on the cap rings are set exactly to ±Z and on the wall rings exactly horizontal – this
 * avoids the shading gradient that plain vertex-normal averaging smears over large flat caps.
 */
function finishSlab(ext: THREE.ExtrudeGeometry, zLo: number, zHi: number, b: number): THREE.BufferGeometry {
  ext.deleteAttribute('uv');
  ext.deleteAttribute('normal');
  const geo = mergeVertices(ext, 1e-4);
  ext.dispose();
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const eps = 1e-3;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (Math.abs(z - zLo) < eps) nor.setXYZ(i, 0, 0, -1);
    else if (Math.abs(z - zHi) < eps) nor.setXYZ(i, 0, 0, 1);
    else if (Math.abs(z - (zLo + b)) < eps || Math.abs(z - (zHi - b)) < eps) {
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const l = Math.hypot(nx, ny) || 1;
      nor.setXYZ(i, nx / l, ny / l, 0);
    }
  }
  nor.needsUpdate = true;
  return geo;
}

/**
 * Rounded slab: the XY outline `shape` (already shrunk by the bevel on every side) extruded from
 * z0 to z1 with a round bevel of radius `b` – so the finished part reaches the un-shrunk outline.
 */
export function slab(
  shape: THREE.Shape,
  z0: number,
  z1: number,
  b: number,
  curveSegments = 8,
  bevelSegments = 3,
): THREE.BufferGeometry {
  const depth = Math.max(0.01, z1 - z0 - 2 * b);
  const ext = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments,
    curveSegments,
  });
  ext.translate(0, 0, z0 + b);
  return finishSlab(ext, z0, z0 + depth + 2 * b, b);
}

/** Rounded-rectangle slab of OUTER size w × h (XY), from z0 to z1, corner radius r, edge bevel b. */
export function rrSlab(
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
  z0: number,
  z1: number,
  bevel: number,
  curveSegments = 8,
): THREE.BufferGeometry {
  const b = clamp(bevel, 0.1, Math.min((z1 - z0) / 2 - 0.02, w / 4, h / 4));
  return slab(rrShape(cx, cy, w - 2 * b, h - 2 * b, r - b), z0, z1, b, curveSegments);
}

/**
 * Densely sampled rounded-rectangle outline (counter-clockwise) in a 2D (a, c) plane. The two
 * long edges (constant c) get `nLong` segments so the outline can be bent afterwards.
 */
function rrOutline(w: number, h: number, r: number, cc: number, nLong: number, arcSegs = 6): [number, number][] {
  const rr = clamp(r, 0.05, Math.min(w, h) / 2 - 1e-3);
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = cc - h / 2;
  const y1 = cc + h / 2;
  const out: [number, number][] = [];
  const line = (ax: number, ay: number, bx: number, by: number, n: number) => {
    for (let i = 0; i < n; i++) out.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
  };
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i < arcSegs; i++) {
      const t = a0 + ((Math.PI / 2) * i) / arcSegs;
      out.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
    }
  };
  line(x0 + rr, y0, x1 - rr, y0, nLong);
  arc(x1 - rr, y0 + rr, -Math.PI / 2);
  line(x1, y0 + rr, x1, y1 - rr, 1);
  arc(x1 - rr, y1 - rr, 0);
  line(x1 - rr, y1, x0 + rr, y1, nLong);
  arc(x0 + rr, y1 - rr, Math.PI / 2);
  line(x0, y1 - rr, x0, y0 + rr, 1);
  arc(x0 + rr, y0 + rr, Math.PI);
  return out;
}

/**
 * Vertical slab whose TOP-VIEW cross-section is a rounded rectangle (x: width, z: from zBack to
 * zFront) – optionally bent – extruded from y0 to y1 with round top / bottom edges (bevel b).
 * Bending the 2D section before extrusion keeps the curved front exact with few triangles.
 */
export function sectionSlab(
  w: number,
  zBack: number,
  zFront: number,
  r: number,
  y0: number,
  y1: number,
  bevel: number,
  R: number,
  nLong: number,
): THREE.BufferGeometry {
  const t = zFront - zBack;
  const b = clamp(bevel, 0.1, Math.min(t / 2 - 0.05, (y1 - y0) / 2 - 0.05));
  const pts = rrOutline(w - 2 * b, t - 2 * b, r - b, (zBack + zFront) / 2, R > 0 ? nLong : 1);
  // rotateX(-90°) below maps (x, y, z) -> (x, z, -y): world y = extrusion depth and
  // world z = -shape y, hence the shape is drawn with y = -z.
  const shape = new THREE.Shape(
    pts.map(([x, z]) => {
      const [bx, bz] = bendXZ(x, z, R);
      return new THREE.Vector2(bx, -bz);
    }),
  );
  const geo = slab(shape, y0, y1, b, 1);
  geo.rotateX(-Math.PI / 2);
  return geo;
}
